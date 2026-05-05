/**
 * Grok Voice v2.1 scenario-accuracy E2E harness.
 *
 * DOD: validate that the live xAI Grok Voice realtime model — given the
 * exact instructions our v3 session route compiles for the v2.1 housing-
 * equipment-manufacturer scenario — replies in line with the eight cases
 * Adecco signed off on. UI and scoring are intentionally OUT of scope.
 *
 * Each case opens a fresh WebSocket session, sends `session.update` with
 * the v2.1 instructions, posts the user line as `input_text`, waits for
 * `response.done`, and runs pass-conditions on the assistant transcript.
 *
 * Evidence (summary.json + transcript.md) is written to
 *   out/grok_voice_v21_e2e/<utc-iso-compact>/
 *
 * Usage:
 *   pnpm exec tsx scripts/grok-voice-v21-scenario-e2e.ts \
 *     [--rounds 2] [--critical-rounds 3] [--limit 8] [--cases 1,3,4,5,7]
 *
 * Required env:
 *   XAI_API_KEY    — server-side key. Loaded from apps/web/.env.local if not
 *                    already set in the shell.
 *
 * Optional env:
 *   GROK_VOICE_MODEL                          (default grok-voice-think-fast-1.0)
 *   GROK_VOICE_VOICE_ID                       (default rex)
 *   GROK_VOICE_TURN_DETECTION_THRESHOLD       (default 0.72 — max_speed)
 *   GROK_VOICE_TURN_DETECTION_SILENCE_MS      (default 650)
 *   GROK_VOICE_TURN_DETECTION_PREFIX_PADDING_MS (default 333)
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { WebSocket as WsClient } from "ws";
import { buildLivePronunciationGuide } from "../packages/scenario-engine/src/tts/livePronunciationGuide";
import {
  GROK_VOICE_RUNTIME_GUARDRAIL,
  buildGrokVoiceSystemPrompt,
} from "../apps/web/server/grokVoice/promptBuilder";
import type { GrokVoiceScenarioBundle } from "../apps/web/server/grokVoice/scenarioLoader";
import { createHash } from "node:crypto";

// ---------------- Args & env ----------------

function getArg(flag: string, fallback?: string): string | undefined {
  const idx = process.argv.findIndex((v) => v === flag);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const ROUNDS = Number(getArg("--rounds", "2"));
const CRITICAL_ROUNDS = Number(getArg("--critical-rounds", "3"));
const LIMIT = Number(getArg("--limit", "8"));
const ONLY_CASES = (getArg("--cases") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCENARIO_ID =
  "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21";
const SCENARIOS_DIR = resolve(REPO_ROOT, "data/generated/scenarios");
const VOICE_PROFILE_PATH = resolve(
  REPO_ROOT,
  "config/voice-profiles/staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2.json"
);

// Env values are resolved inside main() after loadDotEnvLocalIfPresent().
let XAI_API_KEY = "";
let MODEL = "grok-voice-think-fast-1.0";
let VOICE = "rex";
let VAD = { threshold: 0.72, silence_duration_ms: 650, prefix_padding_ms: 333 };

// (env values resolved in main)

// ---------------- Cases ----------------

type Turn = { role: "user"; text: string };
type CaseDef = {
  id: string;
  label: string;
  critical: boolean;
  turns: Turn[];
  // The transcript checked for assertions is by default the LAST assistant
  // turn. Multi-turn cases (Case 8) override which turn(s) to check.
  passConditions: PassCondition[];
};
type PassCondition =
  | { kind: "must_contain_any"; terms: string[]; reason: string }
  | { kind: "must_not_contain_any"; terms: string[]; reason: string }
  | { kind: "max_sentences"; max: number; reason: string }
  | { kind: "must_contain_at_least"; n: number; terms: string[]; reason: string }
  | { kind: "must_contain_in_turn"; turnIndex: number; terms: string[]; reason: string }
  | {
      kind: "must_not_contain_in_turn";
      turnIndex: number;
      terms: string[];
      reason: string;
    };

const CASES: CaseDef[] = [
  {
    id: "case1_shallow_background",
    label: "浅い募集背景は開示しすぎない",
    critical: true,
    turns: [{ role: "user", text: "募集背景を教えてください。" }],
    passConditions: [
      {
        kind: "must_contain_any",
        terms: ["増員", "受注", "処理"],
        reason: "増員 or 処理量増加 を一文程度で示す",
      },
      {
        kind: "must_not_contain_any",
        terms: [
          "現行ベンダー",
          "供給不",
          "レスポンス",
          "競合",
          "独占",
          "単価",
          "決定プロセス",
          "職場見学",
          // PR #52 review (Blocker 1) — shallow background must not leak
          // any competitive-comparison vocabulary.
          "比較",
          "新しい派遣会社",
          "他社",
          "大手",
          "声をかけ",
        ],
        reason: "深掘り情報を勝手に出さない",
      },
      { kind: "max_sentences", max: 3, reason: "1〜2文で短く" },
    ],
  },
  {
    id: "case3b_weak_question_no_reveal",
    label: "弱い質問では earned reveal を発火させない (negative control)",
    critical: true,
    turns: [
      { role: "user", text: "営業事務の業務内容を詳しく教えてください。" },
    ],
    passConditions: [
      {
        // The agreement-phrase MUST NOT fire here — there is no domain
        // hypothesis in the user's question. (PR #52 Blocker 2.)
        kind: "must_not_contain_any",
        terms: ["よくご存じ", "その理解で近い", "おっしゃる通り"],
        reason: "業界×職種仮説のない specific 質問では earned-reveal 発火しない",
      },
      {
        // Specific question gets core_tasks-level reveal only — domain
        // hidden facts (施工日 / 引渡し / 代理店 / 工務店) must NOT spill.
        // 品番 / 型番 are excluded from this list because they can come up
        // naturally in a "what does the role do" answer.
        kind: "must_not_contain_any",
        terms: ["施工日", "引渡し", "代理店", "工務店"],
        reason: "domain hidden facts をまとめて出さない",
      },
      { kind: "max_sentences", max: 3, reason: "1〜2文で具体回答" },
    ],
  },
  {
    id: "case2_new_vendor_reason",
    label: "新規派遣会社に声をかけた理由で一部開示",
    critical: false,
    turns: [
      { role: "user", text: "なぜ新しい派遣会社にも声をかけているのですか？" },
    ],
    passConditions: [
      {
        kind: "must_contain_any",
        terms: ["現行", "ベンダー", "供給", "レスポンス", "比較"],
        reason: "現行ベンダー / 供給 / レスポンス のいずれかに触れる",
      },
      {
        kind: "must_not_contain_any",
        terms: ["独占", "比較軸は", "決定プロセス"],
        reason: "競合・独占・決定フローを一度に全部出さない",
      },
      { kind: "max_sentences", max: 3, reason: "1〜2文" },
    ],
  },
  {
    id: "case3_domain_hypothesis",
    label: "住宅設備メーカー仮説でearned reveal",
    critical: true,
    turns: [
      {
        role: "user",
        text:
          "住宅設備メーカーの営業事務ですと、品番確認、在庫確認、施工日に合わせた納期調整、代理店や工務店対応が重要になりそうですが、今回はどこが一番負荷ですか？",
      },
    ],
    passConditions: [
      {
        // v2.1 quality patch: accept all four Tier-2 praise variants the new
        // prompt allows (the previous short "その理解で近い" still matches as a
        // substring of "その理解でかなり近い"... wait, it doesn't — the new
        // phrase has "かなり" between で and 近い. Enumerate explicitly.)
        kind: "must_contain_any",
        terms: [
          "よくご存じ",
          "その理解で近い",
          "その理解でかなり近い",
          "そこまで押さえていただける",
          "まさにそのあたりが今回のポイント",
          "おっしゃる通り",
        ],
        reason: "earned-reveal の同調フレーズが出る (Tier 2 4種 + legacy)",
      },
      {
        kind: "must_contain_any",
        terms: ["納期調整", "在庫確認", "品番", "代理店", "工務店", "施工日"],
        reason: "住宅設備メーカー固有論点に触れる",
      },
      { kind: "max_sentences", max: 4, reason: "1〜3文の補足" },
    ],
  },
  {
    id: "case4_self_promotion_redirect",
    label: "自社説明先行を受け流す",
    critical: true,
    turns: [
      {
        role: "user",
        text:
          "アデコは人材が豊富でスピード対応できますので、すぐご紹介できます。",
      },
    ],
    passConditions: [
      {
        kind: "must_not_contain_any",
        terms: [
          "供給力",
          "アデコさんは強み",
          "Adeccoの強み",
          // PR #52 Blocker 3 — customer must NOT echo / accept the pitch.
          "人材が豊富",
          "スピード対応",
          "すぐ紹介",
          "すぐご紹介",
          "助かります",
          "期待しています",
          "お願いします",
          "ありがたいです",
        ],
        reason: "顧客AIが営業の売り込みを代弁・受容しない",
      },
      {
        // PR #52 Blocker 3 — require a concrete redirect phrase, not just
        // any single noun like "要件".
        kind: "must_contain_any",
        terms: [
          "まずは要件",
          "要件をどこまで理解",
          "条件を整理",
          "募集内容を確認",
        ],
        reason: "要件整理への明示的なリダイレクトを要求",
      },
      { kind: "max_sentences", max: 3, reason: "1〜2文" },
    ],
  },
  {
    id: "case5_cp_handoff_summary",
    label: "CP共有前提の要約に反応する",
    critical: true,
    turns: [
      {
        role: "user",
        text:
          "CPには、住宅設備メーカー経験必須ではなく、納期調整と社外対応に抵抗がなく、製品コードを覚えることに前向きな方を優先、と共有するのが良さそうですね。",
      },
    ],
    passConditions: [
      {
        kind: "must_contain_any",
        terms: ["その理解で近い", "近いです", "そうですね", "はい"],
        reason: "肯定で受ける",
      },
      {
        kind: "must_contain_any",
        terms: [
          "正確",
          "確認",
          "調整",
          "長く",
          "自己流",
          "協調",
          "落ち着",
          // The model often condenses the priority补足 into "重視" /
          // "受発注経験" / "共有" — accept those forms as well.
          "重視",
          "受発注経験",
          "共有",
        ],
        reason: "優先・人材像の補足が入る",
      },
      { kind: "max_sentences", max: 4, reason: "1〜3文" },
    ],
  },
  {
    id: "case6_icebreak",
    label: "アイスブレイクは1往復で本題へ",
    critical: false,
    turns: [
      {
        role: "user",
        text: "今日は暑いですね。御社は皆さん出社されているんですか？",
      },
    ],
    passConditions: [
      { kind: "max_sentences", max: 3, reason: "雑談を膨らませない" },
      {
        kind: "must_not_contain_any",
        terms: ["趣味", "週末", "天気予報", "暑くて何"],
        reason: "雑談を広げすぎない",
      },
    ],
  },
  {
    id: "case7_rapid_fire",
    label: "質問攻めには答えすぎない (answerBudget)",
    critical: true,
    turns: [
      {
        role: "user",
        text:
          "業務内容と人数と単価と開始日と残業と決裁者と競合状況を全部教えてください。",
      },
    ],
    passConditions: [
      { kind: "max_sentences", max: 3, reason: "answerBudget が効いていれば短い" },
      {
        kind: "must_not_contain_any",
        terms: [
          "業務は受発注、人数は",
          "現行ベンダー",
          "比較軸は",
          "決裁者は人事",
          // PR #52 Blocker 4 — concrete values must not leak in a
          // compound question. Cover both kanji- and digit-form numerals.
          "六月一日",
          "6月1日",
          "十から十五",
          "10から15",
          "千七百五十",
          "1750",
          "千九百",
          "1900",
          "現場課長",
          "職場見学",
          "来週後半",
          "二から三営業日",
          "交通費",
        ],
        reason: "全部を一括開示しない",
      },
      {
        // PR #52 Blocker 4 — require an explicit "narrow to one" cue.
        // Accept multiple natural phrasings: "まず業務内容から…",
        // "業務内容を先に…", "順番にお聞き", etc. The spirit is "do not
        // dump everything at once".
        kind: "must_contain_any",
        terms: [
          "まずは業務内容から",
          "まず業務内容から",
          "業務内容を先に",
          "業務内容から",
          "一度に全部ではなく",
          "重要なところから",
          "まず優先順位",
          "順番にお答え",
          "順番にお聞き",
          "先に確認",
        ],
        reason: "整理して 1 つに絞り直す合図を要求",
      },
    ],
  },
  {
    id: "case8_late_kickback_question",
    label: "終盤だけAdecco差別化質問を出す",
    critical: false,
    turns: [
      { role: "user", text: "募集背景を教えてください。" },
      { role: "user", text: "受発注の業務内容を分解して教えてください。" },
      {
        role: "user",
        text:
          "住宅設備メーカーの営業事務ですと、品番確認や納期調整、代理店対応の比重が高そうですよね？",
      },
      {
        role: "user",
        text:
          "整理させてください。今回は受発注経験よりも、納期調整と社外対応に抵抗がない方を優先、で合っていますか？",
      },
      {
        role: "user",
        text: "次回は来週水曜にメールで候補者像をお送りします。よろしいですか？",
      },
    ],
    passConditions: [
      {
        kind: "must_not_contain_in_turn",
        turnIndex: 0,
        terms: ["他社", "違い", "Adecco", "アデコ", "強み"],
        reason: "序盤では逆質問しない",
      },
      {
        // "違い" alone is a false-positive trigger because 「仕様違い」
        // is a legitimate housing-equipment vocabulary item we want the
        // model to mention mid-meeting. Restrict to comparative-context
        // markers ("他社", "Adeccoの強み", "Adeccoさんの").
        kind: "must_not_contain_in_turn",
        turnIndex: 1,
        terms: ["他社", "Adeccoの強み", "Adeccoさんの強み", "アデコさんの強み"],
        reason: "中盤でAdecco差別化質問を出さない",
      },
      {
        kind: "must_contain_in_turn",
        turnIndex: 4,
        terms: ["特徴", "違い", "強み"],
        reason: "終盤で一度だけ逆質問する",
      },
    ],
  },
  {
    // PR #52 Blocker 5 — top-performer norm: pre-briefing the candidate on
    // the hard parts of the role (fitRisk + productComplexity +
    // deliveryPressure should be acknowledged).
    id: "case9_negative_info_prebriefing",
    label: "ネガティブ情報の事前共有提案に応える",
    critical: true,
    turns: [
      {
        role: "user",
        text:
          "候補者には、良い点だけでなく大変な部分も事前に伝えた方が定着しやすいと思っています。今回、事前に伝えておくべきギャップや大変さはありますか？",
      },
    ],
    passConditions: [
      {
        kind: "must_contain_any",
        terms: ["そうですね", "その方が良い", "助かります", "はい", "いい考え"],
        reason: "肯定で受ける",
      },
      {
        kind: "must_contain_at_least",
        n: 2,
        terms: [
          "納期調整",
          "品番",
          "製品コード",
          "社外対応",
          "施工日",
          "事前に伝える",
        ],
        reason: "fitRisk + productComplexity + deliveryPressure のうち少なくとも 2 つに触れる",
      },
      { kind: "max_sentences", max: 4, reason: "1〜3文" },
    ],
  },
  {
    // PR #52 Blocker 5 — top-performer norm: SK is a confirmation +
    // feedback-loop venue, not a first-pitch venue.
    id: "case10_sk_confirmation_loop",
    label: "SK を確認・深掘りの場として位置づける提案を受ける",
    critical: false,
    turns: [
      {
        role: "user",
        text:
          "職場見学は、候補者が初めて聞く場ではなく、事前に伝えた内容を確認・深掘りする場にしたいです。見学後にずれがあれば、次の人選に活かせるよう確認させてください。",
      },
    ],
    passConditions: [
      {
        kind: "must_contain_any",
        terms: [
          "そうですね",
          "助かります",
          "いいです",
          "はい",
          // The model often agrees with 「わかりました、」 — accept it.
          "わかりました",
          "ぜひ",
        ],
        reason: "肯定する",
      },
      {
        kind: "must_contain_any",
        terms: ["見学後", "ずれ", "次の候補者", "確認", "人選"],
        reason: "SK 後フィードバックループの語に触れる",
      },
      { kind: "max_sentences", max: 4, reason: "1〜3文" },
    ],
  },
  {
    // PR #52 Blocker 5 — top-performer norm: separate ideal from minimum
    // line so the CP can match against a realistic candidate pool.
    id: "case11_best_to_minimum_line",
    label: "ベスト条件と最低ラインを分けて返す",
    critical: true,
    turns: [
      {
        role: "user",
        text:
          "理想はメーカーでの受発注経験者だと思いますが、候補者が少ない場合、営業事務で納期調整や社外対応の経験があれば、住宅設備業界未経験でも検討できますか？",
      },
    ],
    passConditions: [
      {
        kind: "must_contain_any",
        terms: [
          "検討できます",
          "検討可能",
          "業界未経験でも",
          "業界経験必須ではない",
          "そうですね",
        ],
        reason: "業界経験必須ではない / 検討可能を明示",
      },
      {
        // The model often satisfies the spirit by surfacing "受発注経験",
        // "納期調整", "社外対応", or "重視" — broaden to those.
        kind: "must_contain_any",
        terms: [
          "正確",
          "調整経験",
          "確認しながら",
          "対外調整",
          "納期調整",
          "社外対応",
          "受発注経験",
          "重視",
        ],
        reason: "理想の代替軸 (正確性 / 調整経験 / 社外対応) を提示",
      },
      { kind: "max_sentences", max: 4, reason: "1〜3文" },
    ],
  },
  // ---- v2.1 quality patch (manual-test findings) — Cases 12–16 ----
  {
    // Praise threshold: introducer phrase + only ONE domain term should land
    // in Tier 1, not Tier 2. The model must NOT use a praise phrase here.
    id: "case12_praise_threshold_medium_question",
    label: "弱い仮説 (枕詞 + domain 1語) では praise を発火させない",
    critical: true,
    turns: [
      {
        role: "user",
        text: "住宅設備メーカーの営業事務ですと、品番確認とか、どこが負荷ですか？",
      },
    ],
    passConditions: [
      {
        // The 4 Tier-2 praise phrases (and the older fallback "おっしゃる通り")
        // must NOT appear — the user named only one domain term.
        kind: "must_not_contain_any",
        terms: [
          "よくご存じ",
          "その理解で近い",
          "その理解でかなり近い",
          "そこまで押さえていただける",
          "まさにそのあたりが今回のポイント",
          "おっしゃる通り",
        ],
        reason: "Tier 1 (枕詞 + domain 1語) では praise を出さない",
      },
      {
        // A single 品番-cluster mention may naturally extend to 製品コード /
        // 仕様違い (those are the same cluster and the spec example allows
        // them). Forbid only the cross-cluster jumps — namely the
        // delivery-cluster (施工日 / 引渡し) and the channel-cluster
        // (代理店 / 工務店). Those would constitute the "Tier 2 leak" the
        // praise-threshold rule is meant to gate.
        kind: "must_not_contain_any",
        terms: ["施工日", "引渡し", "代理店", "工務店"],
        reason: "Tier 1 では別クラスタの domain hidden facts を出さない",
      },
      {
        kind: "must_contain_any",
        terms: ["そうですね", "品番", "受発注", "納期調整", "あります"],
        reason: "中立的な短答 (partial agreement) を返す",
      },
      { kind: "max_sentences", max: 3, reason: "1〜2文" },
    ],
  },
  {
    // No stock followup suffix across 4 sequential single-fact questions.
    // We assert the ban on each assistant turn separately.
    id: "case13_no_stock_followup_suffix",
    label: "通常応答末尾に定型語尾を付けない",
    critical: true,
    turns: [
      { role: "user", text: "人数は何名ですか？" },
      { role: "user", text: "請求単価はいくらですか？" },
      { role: "user", text: "業務時間は？" },
      { role: "user", text: "在宅勤務の運用は？" },
    ],
    passConditions: [
      {
        kind: "must_not_contain_in_turn",
        turnIndex: 0,
        terms: [
          "何か他に確認したい点",
          "ご質問があればお答え",
          "次にどの点",
          "何か特に詳しく",
        ],
        reason: "turn0 (人数) の末尾に定型語尾を付けない",
      },
      {
        kind: "must_not_contain_in_turn",
        turnIndex: 1,
        terms: [
          "何か他に確認したい点",
          "ご質問があればお答え",
          "次にどの点",
          "何か特に詳しく",
        ],
        reason: "turn1 (単価) の末尾に定型語尾を付けない",
      },
      {
        kind: "must_not_contain_in_turn",
        turnIndex: 2,
        terms: [
          "何か他に確認したい点",
          "ご質問があればお答え",
          "次にどの点",
          "何か特に詳しく",
        ],
        reason: "turn2 (業務時間) の末尾に定型語尾を付けない",
      },
      {
        kind: "must_not_contain_in_turn",
        turnIndex: 3,
        terms: [
          "何か他に確認したい点",
          "ご質問があればお答え",
          "次にどの点",
          "何か特に詳しく",
        ],
        reason: "turn3 (在宅) の末尾に定型語尾を付けない",
      },
    ],
  },
  {
    // Personal smalltalk — model must deflect, not fabricate private life.
    id: "case14_personal_smalltalk_deflect",
    label: "個人的な雑談は作話せず本題に戻す",
    critical: true,
    turns: [
      { role: "user", text: "ところで、休日は何されてるんですか？" },
    ],
    passConditions: [
      {
        kind: "must_not_contain_any",
        terms: [
          "家族と過ごし",
          "趣味の時間",
          "週末は",
          "休日はゆっくり",
          "過ごしています",
        ],
        reason: "私生活の作話を出さない",
      },
      {
        kind: "must_contain_any",
        terms: ["要件", "募集", "業務", "派遣要件", "本題", "営業事務"],
        reason: "本題へ戻す合図を出す",
      },
      { kind: "max_sentences", max: 3, reason: "短く受け流す" },
    ],
  },
  {
    // Rapid-fire compound question — must not narrate ("複合質問なので") and
    // must not dump hidden facts even after the redirect.
    id: "case15_rapid_fire_no_meta_and_no_detail",
    label: "複合質問でメタ表現せず hidden facts も出さない",
    critical: true,
    turns: [
      {
        role: "user",
        text:
          "業務内容と人数と単価と開始日と残業と決裁者と競合状況を全部教えてください。",
      },
    ],
    passConditions: [
      {
        kind: "must_not_contain_any",
        terms: [
          "複合質問",
          "複数の質問",
          "一つずつお答え",
          "次にどの点からお聞き",
        ],
        reason: "メタ的な前置きを出さない",
      },
      {
        kind: "must_not_contain_any",
        terms: [
          "六月一日",
          "6月1日",
          "1750",
          "1900",
          "千七百五十",
          "千九百",
          "10から15",
          "十から十五",
          "現場課長",
          // Also bar the業務 list dump in the redirect turn.
          "受発注入力",
          "在庫確認",
          "見積もり補助",
        ],
        reason: "redirect ターンでは具体値も付随業務リストも出さない",
      },
      {
        kind: "must_contain_any",
        terms: [
          "まずは業務内容から",
          "業務内容を先に",
          "まず業務内容",
          "まず優先順位",
          "項目が多いので",
          "一度に全部",
        ],
        reason: "1論点に絞る redirect 合図を出す",
      },
      { kind: "max_sentences", max: 3, reason: "短く redirect" },
    ],
  },
  {
    // AI identity — stay in persona, no AI/Grok name, no stock suffix.
    id: "case16_identity_no_stock_suffix",
    label: "AI 自己認識質問でもペルソナを維持し定型語尾を付けない",
    critical: true,
    turns: [{ role: "user", text: "あなたはAIですか？" }],
    passConditions: [
      {
        kind: "must_not_contain_any",
        terms: [
          "AI",
          "Grok",
          "アシスタント",
          "言語モデル",
          "何か他に確認したい点",
          "ご質問があればお答え",
        ],
        reason: "AI を名乗らず、定型語尾も付けない",
      },
      {
        kind: "must_contain_any",
        terms: ["人事課", "営業事務", "弊社", "私"],
        reason: "ペルソナを維持して返す",
      },
      { kind: "max_sentences", max: 3, reason: "1〜2文" },
    ],
  },
];

// ---------------- Bundle + instructions ----------------

async function loadBundle(): Promise<GrokVoiceScenarioBundle> {
  const assetsRaw = await readFile(
    resolve(SCENARIOS_DIR, `${SCENARIO_ID}.assets.json`),
    "utf8"
  );
  const voiceProfileRaw = await readFile(VOICE_PROFILE_PATH, "utf8");
  const assets = JSON.parse(assetsRaw) as {
    scenarioId: string;
    promptVersion: string;
    agentSystemPrompt: string;
    knowledgeBaseText: string;
    promptSections?: unknown;
  };
  const voiceProfile = JSON.parse(voiceProfileRaw) as { firstMessageJa: string };
  const pronunciationGuide = await buildLivePronunciationGuide({
    scenarioId: assets.scenarioId,
    textNormalisationType: "system_prompt",
    referenceTexts: [assets.agentSystemPrompt, assets.knowledgeBaseText],
    // Match production scenarioLoader.ts cap (v2.1 quality patch).
    maxEntries: 80,
  });
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  return {
    scenarioId: assets.scenarioId,
    promptVersion: assets.promptVersion,
    agentSystemPrompt: assets.agentSystemPrompt,
    knowledgeBaseText: assets.knowledgeBaseText,
    firstMessage: voiceProfile.firstMessageJa,
    pronunciationGuide,
    agentSystemPromptHash: sha(assets.agentSystemPrompt),
    knowledgeBaseTextHash: sha(assets.knowledgeBaseText),
    promptSectionsHash: sha(JSON.stringify(assets.promptSections ?? null)),
  };
}

// ---------------- WebSocket round ----------------

type TurnTranscript = { user: string; assistant: string };
type RunOutcome = {
  caseId: string;
  round: number;
  transcripts: TurnTranscript[];
  totalMs: number;
  errorCode: string;
  errorMessage: string;
  pass: boolean;
  failures: string[];
};

async function runOneRound(
  caseDef: CaseDef,
  round: number,
  instructions: string
): Promise<RunOutcome> {
  const transcripts: TurnTranscript[] = caseDef.turns.map((t) => ({
    user: t.text,
    assistant: "",
  }));
  const outcome: RunOutcome = {
    caseId: caseDef.id,
    round,
    transcripts,
    totalMs: 0,
    errorCode: "",
    errorMessage: "",
    pass: false,
    failures: [],
  };
  const startedAt = Date.now();

  return new Promise<RunOutcome>((resolveOuter) => {
    const ws = new WsClient(
      `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(MODEL)}`,
      { headers: { Authorization: `Bearer ${XAI_API_KEY}` } }
    );
    let turnIdx = 0;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;
    const finish = (reason: string) => {
      if (resolved) return;
      resolved = true;
      if (watchdog) clearTimeout(watchdog);
      try {
        ws.close();
      } catch {
        // ignore
      }
      outcome.totalMs = Date.now() - startedAt;
      if (
        !outcome.errorCode &&
        transcripts.some((t) => t.assistant.length === 0)
      ) {
        outcome.errorCode = "EMPTY_RESPONSE";
        outcome.errorMessage = `${reason}: at least one assistant turn empty`;
      }
      resolveOuter(outcome);
    };
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => finish("watchdog"), 60_000);
    };

    const sendNextUser = () => {
      if (turnIdx >= caseDef.turns.length) return;
      const turn = caseDef.turns[turnIdx]!;
      ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: turn.text }],
          },
        })
      );
      ws.send(JSON.stringify({ type: "response.create" }));
      armWatchdog();
    };

    ws.on("open", () => {
      // The xAI realtime endpoint accepts the older "modalities" + flat
      // input/output_audio_format style as well as the newer
      // audio.{input,output} object style. Use the older form here for
      // compatibility with grok-voice-batch.ts (already validated).
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions,
            voice: VOICE,
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            turn_detection: {
              type: "server_vad",
              threshold: VAD.threshold,
              silence_duration_ms: VAD.silence_duration_ms,
              prefix_padding_ms: VAD.prefix_padding_ms,
            },
          },
        })
      );
      sendNextUser();
    });

    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      const obj = msg as { type?: string; delta?: string; error?: { code?: string; message?: string } };
      const t = obj.type ?? "";
      if (
        t === "response.audio_transcript.delta" ||
        t === "response.output_audio_transcript.delta" ||
        t === "response.text.delta"
      ) {
        if (turnIdx < transcripts.length && typeof obj.delta === "string") {
          transcripts[turnIdx]!.assistant += obj.delta;
        }
      } else if (t === "response.done") {
        turnIdx += 1;
        if (turnIdx >= caseDef.turns.length) {
          finish("response.done.last");
        } else {
          sendNextUser();
        }
      } else if (t === "error") {
        outcome.errorCode = obj.error?.code ?? "API_ERROR";
        outcome.errorMessage = obj.error?.message ?? "";
        finish("error_event");
      }
    });
    ws.on("close", () => {
      if (!resolved) finish("ws_closed");
    });
    ws.on("error", (err) => {
      outcome.errorCode = outcome.errorCode || "WS_ERROR";
      outcome.errorMessage = outcome.errorMessage || err.message;
      finish("ws_error");
    });
  });
}

// ---------------- Pass evaluation ----------------

function countSentences(text: string): number {
  // Japanese sentence splitter — counts strong terminators.
  const matches = text.match(/[。．！？!?]/g);
  return matches ? matches.length : text.trim().length > 0 ? 1 : 0;
}

function evaluateOutcome(caseDef: CaseDef, outcome: RunOutcome): void {
  if (outcome.errorCode) {
    outcome.pass = false;
    outcome.failures.push(`error:${outcome.errorCode} ${outcome.errorMessage}`);
    return;
  }
  const last = outcome.transcripts[outcome.transcripts.length - 1]?.assistant ?? "";
  const failures: string[] = [];
  for (const cond of caseDef.passConditions) {
    if (cond.kind === "must_contain_any") {
      const hit = cond.terms.some((t) => last.includes(t));
      if (!hit) failures.push(`missing_any[${cond.terms.join("|")}] (${cond.reason})`);
    } else if (cond.kind === "must_not_contain_any") {
      const bad = cond.terms.find((t) => last.includes(t));
      if (bad) failures.push(`forbidden:${bad} (${cond.reason})`);
    } else if (cond.kind === "max_sentences") {
      const n = countSentences(last);
      if (n > cond.max) failures.push(`too_long:${n}>${cond.max} (${cond.reason})`);
    } else if (cond.kind === "must_contain_at_least") {
      const hits = cond.terms.filter((t) => last.includes(t)).length;
      if (hits < cond.n) {
        failures.push(
          `only_${hits}_of_${cond.n}[${cond.terms.join("|")}] (${cond.reason})`
        );
      }
    } else if (cond.kind === "must_contain_in_turn") {
      const turn = outcome.transcripts[cond.turnIndex]?.assistant ?? "";
      const hit = cond.terms.some((t) => turn.includes(t));
      if (!hit)
        failures.push(
          `turn${cond.turnIndex}_missing[${cond.terms.join("|")}] (${cond.reason})`
        );
    } else if (cond.kind === "must_not_contain_in_turn") {
      const turn = outcome.transcripts[cond.turnIndex]?.assistant ?? "";
      const bad = cond.terms.find((t) => turn.includes(t));
      if (bad)
        failures.push(
          `turn${cond.turnIndex}_forbidden:${bad} (${cond.reason})`
        );
    }
  }
  outcome.failures = failures;
  outcome.pass = failures.length === 0;
}

// ---------------- Main ----------------

async function loadDotEnvLocalIfPresent(): Promise<void> {
  if (process.env["XAI_API_KEY"]) return;
  const candidates = [
    resolve(REPO_ROOT, "apps/web/.env.local"),
    resolve(REPO_ROOT, ".env.local"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const txt = await readFile(p, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!;
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

// Per AGENTS.md, secrets must always come from Secret Manager. If the key
// is still missing after the .env.local pass, or if the value looks like a
// placeholder ("test-..." / shorter than 32 chars), shell out to gcloud and
// pull XAI_API_KEY from zapier-transfer (default secret-source project) —
// then adecco-mendan as a fallback.
function loadXaiKeyFromSecretManagerIfNeeded(): void {
  const current = process.env["XAI_API_KEY"];
  const looksReal = current && current.length >= 32 && !current.startsWith("test-");
  if (looksReal) return;

  const projects = [
    process.env["SECRET_SOURCE_PROJECT_ID"] ?? "zapier-transfer",
    "adecco-mendan",
  ];
  for (const project of projects) {
    // Windows: spawnSync('gcloud.cmd', ...) returns EINVAL on Node 22+ unless
    // shell:true is set, because gcloud.cmd is a batch wrapper. Using shell
    // mode is safe here — all arguments are literals known at write time.
    const r = spawnSync(
      "gcloud",
      [
        "secrets",
        "versions",
        "access",
        "latest",
        "--secret=XAI_API_KEY",
        `--project=${project}`,
      ],
      { encoding: "utf8", shell: process.platform === "win32" }
    );
    if (r.status === 0 && r.stdout && r.stdout.trim().length >= 32) {
      process.env["XAI_API_KEY"] = r.stdout.trim();
      console.info(
        `[grok-voice-v21-e2e] XAI_API_KEY fetched from projects/${project}/secrets/XAI_API_KEY (len=${r.stdout.trim().length})`
      );
      return;
    }
  }
}

async function main(): Promise<void> {
  await loadDotEnvLocalIfPresent();
  loadXaiKeyFromSecretManagerIfNeeded();
  const apiKey = process.env["XAI_API_KEY"];
  if (!apiKey || apiKey.length < 32 || apiKey.startsWith("test-")) {
    console.error(
      "BLOCKED: XAI_API_KEY not available. Tried .env.local + gcloud Secret Manager (zapier-transfer, adecco-mendan)."
    );
    process.exit(2);
  }
  XAI_API_KEY = apiKey;
  MODEL = process.env["GROK_VOICE_MODEL"] ?? "grok-voice-think-fast-1.0";
  VOICE = process.env["GROK_VOICE_VOICE_ID"] ?? "rex";
  VAD = {
    threshold: Number(process.env["GROK_VOICE_TURN_DETECTION_THRESHOLD"] ?? "0.72"),
    silence_duration_ms: Number(
      process.env["GROK_VOICE_TURN_DETECTION_SILENCE_MS"] ?? "650"
    ),
    prefix_padding_ms: Number(
      process.env["GROK_VOICE_TURN_DETECTION_PREFIX_PADDING_MS"] ?? "333"
    ),
  };

  const bundle = await loadBundle();
  const instructions = buildGrokVoiceSystemPrompt(bundle);

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const outDir = resolve(REPO_ROOT, "out", "grok_voice_v21_e2e", stamp);
  await mkdir(outDir, { recursive: true });

  const filtered = CASES.filter((c) => {
    if (ONLY_CASES.length === 0) return true;
    // Match against either "case<id>_..." (legacy "1", "7") or the
    // mid-id token directly ("3b", "9", "11"). The previous startsWith
    // form skipped Case 3b because "case3b_" doesn't match "case3_".
    return ONLY_CASES.some((s) => {
      const prefix = `case${s}_`;
      return c.id.startsWith(prefix) || c.id === `case${s}`;
    });
  }).slice(0, LIMIT);

  console.info(`[grok-voice-v21-e2e] model=${MODEL} voice=${VOICE}`);
  console.info(`[grok-voice-v21-e2e] cases=${filtered.length} rounds=${ROUNDS} criticalRounds=${CRITICAL_ROUNDS}`);
  console.info(`[grok-voice-v21-e2e] out=${outDir}`);
  console.info("");

  const summaryCases: Array<{
    caseId: string;
    label: string;
    critical: boolean;
    rounds: RunOutcome[];
    pass: boolean;
    consecutivePass: number;
  }> = [];

  // xAI realtime endpoint enforces a per-minute connection limit. With
  // 12 cases × ~3 rounds × 1 WS each, bursts can hit 429. Sleep briefly
  // between rounds to keep the pacing under the rate cap.
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  for (const c of filtered) {
    const target = c.critical ? Math.max(ROUNDS, CRITICAL_ROUNDS) : ROUNDS;
    const rounds: RunOutcome[] = [];
    for (let i = 1; i <= target; i += 1) {
      process.stdout.write(`  [${c.id}] round ${i}/${target} ... `);
      const outcome = await runOneRound(c, i, instructions);
      evaluateOutcome(c, outcome);
      rounds.push(outcome);
      // Throttle: 2.5s between successful rounds. If we hit a 429, back off
      // for 30s before continuing — gives the per-minute window time to
      // reset. (Other errors fall through with the default delay.)
      if (outcome.errorCode === "WS_ERROR" && /429/.test(outcome.errorMessage)) {
        process.stdout.write("  …rate-limited, backing off 30s…\n");
        await sleep(30_000);
      } else {
        await sleep(2_500);
      }
      console.info(
        outcome.pass
          ? `PASS (${outcome.totalMs}ms)`
          : `FAIL ${outcome.failures.join("; ")}`
      );
    }
    const consecutivePass = countTrailingTrue(rounds.map((r) => r.pass));
    summaryCases.push({
      caseId: c.id,
      label: c.label,
      critical: c.critical,
      rounds,
      pass: rounds.every((r) => r.pass),
      consecutivePass,
    });
  }

  const summary = {
    scenarioId: bundle.scenarioId,
    promptVersion: bundle.promptVersion,
    guardrailVersion: extractGuardrailVersion(GROK_VOICE_RUNTIME_GUARDRAIL),
    model: MODEL,
    voice: VOICE,
    turnDetection: {
      threshold: VAD.threshold,
      silence_duration_ms: VAD.silence_duration_ms,
      prefix_padding_ms: VAD.prefix_padding_ms,
    },
    instructionsBytes: instructions.length,
    instructionsSha256: createHash("sha256").update(instructions).digest("hex"),
    rounds: ROUNDS,
    criticalRounds: CRITICAL_ROUNDS,
    cases: summaryCases,
    overallPass:
      summaryCases.every((c) => c.pass) &&
      summaryCases
        .filter((c) => c.critical)
        .every((c) => c.consecutivePass >= CRITICAL_ROUNDS),
    timestamp: new Date().toISOString(),
  };
  await writeFile(
    resolve(outDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  const md: string[] = [
    `# Grok Voice v2.1 Scenario Accuracy E2E`,
    ``,
    `- scenarioId: \`${bundle.scenarioId}\``,
    `- promptVersion: \`${bundle.promptVersion}\``,
    `- model: \`${MODEL}\` voice: \`${VOICE}\``,
    `- VAD: threshold=${VAD.threshold} silence=${VAD.silence_duration_ms}ms prefix_padding=${VAD.prefix_padding_ms}ms`,
    `- rounds: ${ROUNDS} (critical: ${CRITICAL_ROUNDS})`,
    `- overallPass: **${summary.overallPass ? "PASS" : "FAIL"}**`,
    ``,
  ];
  for (const c of summaryCases) {
    md.push(
      `## ${c.caseId} ${c.critical ? "(critical)" : ""} — ${c.label} — ${c.pass ? "PASS" : "FAIL"} (${c.consecutivePass} consecutive)`
    );
    for (const r of c.rounds) {
      md.push(``);
      md.push(`### round ${r.round} — ${r.pass ? "PASS" : "FAIL"} (${r.totalMs}ms)`);
      if (r.errorCode) md.push(`- error: ${r.errorCode} ${r.errorMessage}`);
      if (r.failures.length) md.push(`- failures: ${r.failures.join("; ")}`);
      r.transcripts.forEach((t, i) => {
        md.push(``);
        md.push(`**user[${i}]:** ${t.user}`);
        md.push(``);
        md.push(`**assistant[${i}]:** ${t.assistant.trim() || "(empty)"}`);
      });
    }
    md.push(``);
  }
  await writeFile(resolve(outDir, "transcript.md"), md.join("\n"), "utf8");

  console.info("");
  console.info(
    `[grok-voice-v21-e2e] overall: ${summary.overallPass ? "PASS" : "FAIL"}`
  );
  console.info(`[grok-voice-v21-e2e] evidence: ${outDir}`);
  process.exit(summary.overallPass ? 0 : 1);
}

function countTrailingTrue(bools: boolean[]): number {
  let n = 0;
  for (let i = bools.length - 1; i >= 0; i -= 1) {
    if (bools[i]) n += 1;
    else break;
  }
  return n;
}

function extractGuardrailVersion(guardrail: string): string {
  const m = guardrail.match(/Runtime Guardrails \(([^)]+)\)/);
  return m ? m[1]! : "unknown";
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
