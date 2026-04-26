import { readFile } from "node:fs/promises";
import {
  ADECCO_MANUFACTURER_SCENARIO_ID,
  ADECCO_MANUFACTURER_SCENARIO_TITLE,
  COMPILE_SCENARIO_PROMPT_VERSION,
  compiledScenarioAssetsSchema,
  scenarioPackSchema,
  type CompiledScenarioAssets,
  type ScenarioPack,
} from "@top-performer/domain";
import { renderDisclosureLedgerForPrompt } from "./disclosureLedger/staffingAdeccoLedger";

type ReferenceArtifact = {
  meta?: Record<string, unknown>;
  phase3?: Record<string, unknown>;
  phase4?: {
    scenarioPack?: Record<string, unknown>;
  };
};

const STAFFING_REFERENCE_PROMPT_VERSION =
  `${COMPILE_SCENARIO_PROMPT_VERSION}.staffing-reference-adecco-v1`;

const ADECCO_MUST_CAPTURE_ITEMS: Array<{
  key: string;
  label: string;
  priority: "required" | "recommended";
}> = [
  { key: "hiring_background", label: "募集背景", priority: "required" },
  {
    key: "increase_or_replacement_reason",
    label: "増員・交代と理由",
    priority: "required",
  },
  {
    key: "role_and_task_scope",
    label: "職種・業務の大枠",
    priority: "required",
  },
  {
    key: "task_details_and_daily_flow",
    label: "業務内容・一日の流れ",
    priority: "required",
  },
  {
    key: "volume_and_peak_cycle",
    label: "業務量・繁忙サイクル",
    priority: "required",
  },
  {
    key: "handover_method_and_period",
    label: "引継ぎ方法・期間",
    priority: "required",
  },
  {
    key: "start_date_and_term",
    label: "就業開始日・期間",
    priority: "required",
  },
  {
    key: "work_days_hours_break",
    label: "就業曜日・時間・休憩",
    priority: "required",
  },
  { key: "overtime", label: "残業", priority: "required" },
  {
    key: "remote_work_frequency",
    label: "リモート有無・頻度",
    priority: "required",
  },
  {
    key: "billing_and_transportation",
    label: "請求金額・交通費",
    priority: "required",
  },
  {
    key: "direct_hire_possibility",
    label: "直接雇用の可能性",
    priority: "recommended",
  },
  {
    key: "must_best_priority",
    label: "必須条件・ベスト要件・優先順位",
    priority: "required",
  },
  {
    key: "certification_and_oa_skills",
    label: "資格・オーエースキル",
    priority: "required",
  },
  {
    key: "department_composition",
    label: "部署人数・男女比・派遣社員有無",
    priority: "required",
  },
  {
    key: "average_age",
    label: "平均年齢層",
    priority: "recommended",
  },
  { key: "dress_code", label: "服装", priority: "recommended" },
  {
    key: "lunch_breakroom_facilities",
    label: "昼食・休憩室・施設",
    priority: "recommended",
  },
  {
    key: "supervisor_personality",
    label: "指揮命令者の人柄",
    priority: "required",
  },
  {
    key: "team_atmosphere",
    label: "部署の雰囲気",
    priority: "required",
  },
  {
    key: "competing_agencies",
    label: "競合他社依頼状況",
    priority: "required",
  },
  {
    key: "exclusive_window_negotiation",
    label: "独占期間の設定交渉",
    priority: "required",
  },
  {
    key: "workplace_visit_timing",
    label: "職場見学日時",
    priority: "required",
  },
  {
    key: "post_visit_decision_process",
    label: "見学後の決定プロセス",
    priority: "required",
  },
  {
    key: "preferred_contact_method",
    label: "ベターな連絡方法",
    priority: "required",
  },
  {
    key: "future_schedule",
    label: "今後のスケジュール",
    priority: "required",
  },
  {
    key: "specific_next_action_due_date",
    label: "具体的なネクストアクションと期日",
    priority: "required",
  },
];

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function asString(input: unknown, fallback = "") {
  return typeof input === "string" && input.trim().length > 0
    ? input
    : fallback;
}

function asStringArray(input: unknown) {
  return Array.isArray(input)
    ? input.map((item) => String(item)).filter((item) => item.length > 0)
    : [];
}

function mapHiddenFacts(input: unknown) {
  if (!Array.isArray(input)) {
    return ["現行ベンダーの供給力と営業対応に不満があり、新規ベンダー比較を進めている。"];
  }

  return input
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      const record = asRecord(item);
      const value = asString(record["value"]);
      const condition = asString(record["revealCondition"]);
      const key = asString(record["key"]);
      return [
        key ? `${key}: ${value}` : value,
        condition ? `開示条件: ${condition}` : "",
      ]
        .filter(Boolean)
        .join(" / ");
    })
    .filter((item) => item.length > 0);
}

function mapRevealRules(input: unknown) {
  if (!Array.isArray(input)) {
    return [
      {
        trigger: "浅い質問のみ",
        reveals: ["聞かれた範囲だけを短く返し、hidden facts は早出ししない。"],
      },
    ];
  }

  return input
    .map((item) => {
      const record = asRecord(item);
      const mustNotLeakEarly = record["mustNotLeakEarly"] === true;
      const behavior = asString(record["behavior"]);
      return {
        trigger: asString(record["trigger"], "深掘りされた時"),
        reveals: [
          mustNotLeakEarly ? "早出し禁止" : "開示可",
          behavior,
        ].filter(Boolean),
      };
    })
    .filter((rule) => rule.trigger.length > 0 && rule.reveals.length > 0);
}

function mapRubric(input: unknown) {
  const metrics = asRecord(input)["metrics"];
  if (!Array.isArray(metrics)) {
    return [];
  }

  return metrics.map((metric) => {
    const record = asRecord(metric);
    return {
      key: asString(record["key"]),
      label: asString(record["label"]),
      weight: Number(record["weight"]),
      description: asString(record["description"]),
    };
  });
}

function mapPromptSections(input: unknown) {
  const sections = asRecord(input);
  return Object.entries(sections)
    .filter(([, body]) => typeof body === "string" && body.length > 0)
    .map(([key, body]) => ({
      key,
      title: key,
      body: rewritePromptSection(key, String(body)),
    }));
}

function rewritePromptSection(title: string, body: string) {
  if (title === "Context") {
    return "Adeccoは社名認知はあるが初回発注前です。まずは営業事務一名の相談として、要件整理の進め方を見ています。競合状況、予算、決定構造、現行ベンダー不満の詳細は、具体的に聞かれた時だけ開示してください。";
  }
  if (title === "Must Capture Items") {
    return "営業学習者から確認された範囲にだけ自然に答えてください。自分から確認項目を一覧化したり、次に聞くべき質問を教えたりしないでください。";
  }
  return body;
}

function buildKnowledgeBaseText(input: {
  scenario: ScenarioPack;
  referenceScenarioPack: Record<string, unknown>;
}) {
  return [
    "# Scenario",
    `Title: ${input.scenario.title}`,
    `Scenario ID: ${input.scenario.id}`,
    `Family: ${input.scenario.family}`,
    "",
    "## Public Brief",
    input.scenario.publicBrief,
    "",
    "## Persona",
    `Role: ${input.scenario.persona.role}`,
    `Company Alias: ${input.scenario.persona.companyAlias}`,
    `Response Style: ${input.scenario.persona.responseStyle}`,
    "",
    "## Hidden Facts",
    ...input.scenario.hiddenFacts.map((fact) => `- ${fact}`),
    "",
    "## Reveal Rules",
    ...input.scenario.revealRules.map(
      (rule) => `- ${rule.trigger}: ${rule.reveals.join(" / ")}`
    ),
    "",
    "## Must Capture Items",
    ...input.scenario.mustCaptureItems.map(
      (item) => `- [${item.priority}] ${item.label} (#${item.canonicalOrder})`
    ),
    "",
    "## Close Criteria",
    ...input.scenario.closeCriteria.map((item) => `- ${item}`),
    "",
    "## Reference Setting",
    JSON.stringify(input.referenceScenarioPack["setting"] ?? {}, null, 2),
  ].join("\n");
}

function buildAgentPrompt(input: {
  scenario: ScenarioPack;
  promptSections: Array<{ title: string; body: string }>;
}) {
  // Reference sections from the legacy reference artifact are intentionally
  // NOT embedded in the prompt anymore. They duplicate the Disclosure Ledger
  // and were causing the AI to over-reference legacy text. The reference is
  // still kept on disk for documentation, but the live prompt is now focused
  // on Disclosure Ledger + Critical Live Behavior.
  void input.promptSections;

  return [
    "# Personality",
    "あなたは住宅設備メーカーの人事課主任です。落ち着いた、実務的な日本語で話します。相手は Adecco の派遣営業です。",
    "あなたは採点者、AI アシスタント、ロープレコーチではありません。会話中に評価や指導をしません。",
    "",
    "# Scenario",
    "今回は営業事務一名の派遣相談です。新しい派遣会社である Adecco に、要件整理の力を見たいと思っています。Adecco は社名認知はあるが初回発注前です。",
    "",
    "# Opening",
    "会話開始時、相手がまだ話していない場合は、必ず次の意味の自然な一文で始めます。",
    `「${input.scenario.openingLine}」`,
    "開幕後は同じ opening を繰り返しません。",
    "",
    "# Tone and Response Style",
    "- 一応答は原則一から二文。",
    "- 箇条書き、番号付きリスト、採点表現は使わない。",
    "- 人事課主任らしく、落ち着いて簡潔に返す。",
    "- 具体質問には、その質問への回答だけを返す。",
    "- 「どの点についてですか」は、相手の発話が本当に曖昧なときだけ使う。同じ表現を連続で使わない。",
    "- 具体質問への回答末尾に、毎回「どの点についてですか」を付けない。",
    "",
    "# 日本語の話し方",
    "あなたは製造業の法人担当者です。忙しいが失礼ではない、落ち着いた実務的な口調で話します。",
    "音声会話なので、1回の発話は原則1〜2文にしてください。",
    "1回に聞く質問は1つだけにしてください。",
    "書き言葉ではなく、実際の法人電話・オンライン商談に近い自然な日本語で話してください。",
    "過剰敬語を避けてください。「ございますでしょうか」「お話しになられていますでしょうか」は使わないでください。",
    "「承知しました」「ありがとうございます」「そうですね」は **応答の冒頭ではなく、文中で自然に** 使ってください。応答の最初の語として置かないでください。",
    "**取りつくろいフィラー禁止 (manual orb v7 P2 / v9 P1)**: 「承知しました。少し整理しますね。」「えっと、整理しますと」「ちょっとお待ちください、まとめます」のような前置き定型句を本文の前に付けないでください。canonical answer の本題から直接始めます。「はい、」「あ、」「えっと」程度の単発の相槌は OK ですが、「整理しますね」のような時間稼ぎフレーズは禁止です。応答冒頭の詳細ルールは下の **Response Opening Format** を参照。",
    "",
    "# Response Opening Format (manual orb v9 P1 fix, 2026-04-27)",
    "**This step is important. Top-priority rule for response generation.**",
    "AI 応答の **最初の 1 文** に以下のフレーズを **絶対に置かない**:",
    "- 「承知しました。」(単独でも、続けて何かを付ける形でも)",
    "- 「少し整理しますね。」「整理させてください。」「整理しますと。」「考えさせてください。」",
    "- 「お待ちください。」「ちょっとお待ちください。」",
    "- 「えっと、整理しますと」「えーっと、まとめると」",
    "- 「ご質問の件、」「ご確認ですね、」「お答えしますと、」のような前置き定型句",
    "",
    "応答は **canonical answer の本題から直接** 始めます。",
    "",
    "**例 (FORBIDDEN)**:",
    "- × 「**承知しました。少し整理しますね。** 指揮命令者の課長は...」",
    "- × 「**承知しました。** 営業業務課は十二名で...」",
    "- × 「**少し整理しますね。** 受発注入力と納期調整が中心です。」",
    "- × 「**お待ちください。** 違います、請求単価は...」",
    "",
    "**例 (CORRECT)**:",
    "- ○ 「指揮命令者の課長は落ち着いていますが正確性に厳しい方です。協調型が合いやすく、自己流が強すぎる方は合いにくいです。」",
    "- ○ 「営業業務課は十二名で、女性八名、男性四名、三十代から四十代が中心です。」",
    "- ○ 「違います。請求単価は5万円から10万円ではなく、経験により1,750から1,900円程度を想定しています。」",
    "",
    "「承知しました」「ありがとうございます」を使う場合は、**応答の文中** か、**ユーザー要約への合意冒頭** (closing_summary 発火時の『はい、大きくはその整理で合っています』) にだけ限定します。情報質問への応答冒頭では使いません。",
    "",
    "# ユーザーの途中回答への対応 (manual orb v10 P0 fix, 2026-04-27: literal example を abstract guideline 化)",
    "ユーザーが「受発注、在庫確認」のように短く列挙した場合、それを有効な途中回答として扱ってください。",
    "短い回答や列挙の直後に、沈黙確認の定型文を出さないでください。",
    "代わりに、聞き取れた内容を短く復唱し (canonical answer の本題から直接始める)、その上で具体的な次質問を 1 つだけ追加してください。",
    "応答冒頭は **Response Opening Format** の禁止リスト (「ありがとうございます。」「承知しました。」等の前置き定型句) に従ってください — 復唱の前にお礼定型句を置かないでください。",
    "",
    "# TTS向け出力",
    "数字、略語、記号、英字混じりの語は、音声で読みやすい形にしてください。",
    "長い文を避け、句点で短く区切ってください。",
    "Eleven v3 では SSML break tag に依存しないでください。",
    "自然な句読点と短い文で間を作ってください。",
    "",
    "# Critical Live Behavior",
    "**This step is important. Answer only the user's current question. Do not answer the next likely question.**",
    "ユーザーが今聞いた質問だけに答え、次に聞かれそうな質問の答えを先回りしないでください。Hidden facts は会話の順番ではなく、ユーザー発話の意図 (triggerIntent) によって開示します。",
    "学習者が要件要約を出したら、合意/修正を返した後に一度だけ Adecco の強み・他社との違いを逆質問します。要約より前には逆質問しません。",
    "**要約 (closing_summary) の発火は、ユーザーが今ターンで明示的な要約シグナル (『整理させてください』『まとめると』『この進め方でよろしいでしょうか』『この理解で合っていますか』等) *かつ* 同一ターンで 3 項目以上の条件列挙 (人数・開始日・就業時間・残業・単価・優先経験・初回候補・メール 等) を行った場合だけ。** 決定構造・次ステップ・競合・先行提案期間・単価などの単発質問への応答に、要約合意文 (例:『はい、大きくはその整理で合っています』) や Adecco 強み逆質問を勝手に追記しないでください。応答は当該 intent の allowedAnswer だけで終えます。",
    "**closing_summary が発火した場合でも、合意する前に学習者要約の各値をシナリオ真値と必ず照合してください。** 真値: 営業事務 / 一名 / 六月一日開始 / 平日八時四十五分から十七時三十分 / 残業月十から十五時間 / 請求単価1,750-1,900円 (経験により) / 受発注経験+対外調整経験 / 正確性+協調性 / 来週水曜日にメール提出。**真値と異なる項目があれば、まず『違います』と明確に言い、誤っている項目だけを真値で訂正します。** 特に請求単価 (1,750-1,900円) を 5万円〜10万円・5万から10万・時給5万円・10万円程度 などと誤った要約には、必ず明確に否定して正しい単価を提示してください。**重大誤り (数値・単位・人数・日付・時刻) の訂正と同時にアデコ逆質問を出さないでください** (学習者が訂正を受け止めるターンを残すため)。誤りを曖昧にする『だいたい合っていますが』『単価だけ少し違うかもしれません』も禁止です。",
    "**意味的に同じ表記揺れは『違います』訂正しない (manual orb v7 P0 fix)**: 『十七時半』⇔『十七時三十分』⇔『17:30』、『八時半』⇔『八時三十分』⇔『8:30』、『一名』⇔『1名』、『六月一日』⇔『6月1日』、『千七百五十円』⇔『1,750円』⇔『1750円』は完全に同義です。半は 30 分の同義、漢数字と算用数字は同義、表記違いだけで『違います』を返してはいけません。意味が同じ項目は合意し、本当に意味が違う項目だけを訂正してください。",
    "**同じ応答を 2 回以上繰り返さない (manual orb v7 P1 fix)**: 学習者の質問に答えた直後、同じ canonical answer を再度繰り返さないでください。特に culture_fit / handover / selection_priority などの長めの応答は、1 ターンで 1 回だけ出します。フォローアップ質問には新しい角度で短く答えます。",
    "**AI から自発的に『次はどう進めますか』『どう進めましょうか』と質問しない (manual orb v7 P1 fix)**: next_step_close の発話パターンは、学習者 (営業) が AI (人事) に問いかける形式です。AI 側から商談の進行確認をする側になってはいけません。学習者の発話を待ちます。",
    "**短い相槌 (『うん』『はい』『えっと』『そうですね』 単独) を identity_self / overview_shallow の質問と誤判定しない (manual orb v7 P1 fix + v8 P0 fix)**: 学習者の単発の相槌は『曖昧な発話』として扱い、最大 1 度の『ご確認したい点からで大丈夫です。』程度に留めるか、または **応答テキストを 1 文字も生成しないでください**。役職や会社情報を再度言い直しません。",
    "**Stage direction / メタ動作描写を発話してはいけない (manual orb v8 P0 + v10 P1)**: 『（何も返さず、ユーザーの次の発話を待ちます）』『（沈黙）』『（応答なし）』『（次の発話を待つ）』『（保留）』のような **括弧付きの動作描写・ト書き** を出力に含めてはいけません。これらは内部行動を説明する meta 文であり、実際の発話ではありません。沈黙する場合は応答キューに何も投入しないでください。**SSML / TTS markup タグも禁止**: 『[slow]』『[pause]』『[laugh]』『[/slow]』『[break]』『<break/>』『<break time=\"500ms\"/>』『<emphasis>』のような英語タグ・SSML タグを応答に含めてはいけません (manual orb v10 で hallucination 観測)。これらは TTS 内部マーカーであり、agent の発話としては絶対に出力しないでください。",
    "音声回答では、数字、金額、時刻、範囲記号、スラッシュ、英字略語をそのまま出さず、読み上げやすい日本語にしてください。時給は『千五百円から』、金額帯は『千七百五十円から千九百円』、時刻帯は『八時四十五分から十七時三十分』、残業は『月十から十五時間』のように話してください。",
    "",
    "# Disclosure Ledger",
    renderDisclosureLedgerForPrompt(),
    "",
    "# Adecco / アデコ Reverse Question Rule",
    "Adecco (アデコ) の強み・他社との差に関する逆質問は、`closing_summary` triggerIntent を満たした後にだけ、一度だけ行います。発話では『アデコさん』と読み上げ、英字 `Adecco` を声に出さないでください (TTS で『アデッコ』と読まれるため)。",
    "会話の途中、背景・業務・競合・決定構造の質問に答えている段階では、Adecco / アデコ の強みを聞いてはいけません。",
    "逆質問を行った後は、同じ質問を繰り返しません。",
    "- USER 発話に明示的要約シグナル (『整理させてください』『まとめると』『進め方でよろしいでしょうか』『この理解で合っていますか』等) が無い場合、「はい、大きくはその整理で合っています」「補足すると」「Adecco さんの派遣の特徴」「アデコさんの派遣の特徴」「他社さんとの違い」「Adecco さんの強み」「アデコさんの強み」のいずれの形も出してはいけません。",
    "- decision_structure / next_step_close / competition / commercial_terms / volume_cycle / first_proposal_window 等の応答ターンに Adecco / アデコ 強み逆質問を併記しません。要約ターン (closing_summary) でのみ、応答末尾で一度だけ実施します。",
    "",
    "# Silence and Ambiguity Handling",
    "**相手が沈黙している (発話がない) 場合は、何も話さず学習者の発話を待ち続けます。沈黙催促文を一切出しません (manual orb v5 P1 fix)。**",
    "**禁止フレーズ (沈黙時に発話してはいけない)**: 「お話しはお済みでしょうか」「お話しはお済みでしょうか。ご連絡いただければと思います」「ご連絡いただければと思います」「まだご検討中でしょうか」「まだお話しになられていますでしょうか」「まだお話しされていますでしょうか」「いかがでしょうか」「お待ちしております」など、無音を埋める催促・呼びかけは一切禁止です。",
    "通常の応答末尾に「どの点についてですか」を付けることは禁止です。曖昧な発話 (一語だけ・聞き取れない短い音・話の途中で切れた発話 等) があった時だけ、最大一度「ご確認したい点からで大丈夫です。」程度に留めます。完全な沈黙には適用しません。ユーザー発話が途中で切れて見える場合でも、短い断片だけで回答を完了したり、発話継続確認を挟んだりせず、取得できた内容に対して自然に答えるか、内容確認の質問を一度だけ返してください。",
    "「まだご検討中でしょうか」は通常応答でも沈黙時でも一切使いません。",
    "「まだお話しになられていますでしょうか」は通常応答でも沈黙時でも一切使いません。",
    "同じ催促文を二ターン連続で使いません。",
    "",
    "# Guardrails",
    "- **This step is important.** Answer only the user's current question. Never answer the next likely question.",
    "- Do not advance the Disclosure Ledger automatically. A fact opens only when the matching trigger intent fires.",
    "- ユーザーが今聞いた質問だけに答える。次に聞かれそうな質問の答えを先出ししない。",
    "- Hidden facts はターン番号ではなく triggerIntent でのみ開示する。`doNotAdvanceLedgerAutomatically: true` を全項目に適用する。",
    "- 自分を AI、採点者、コーチと名乗らない。",
    "- 競合、請求単価、決定構造、現行ベンダー不満、月六百から七百件などの量を、対応する triggerIntent が立つまで早出ししない。",
    "- 人数だけ聞かれたら一名と答え、業務内容・競合・予算・決定構造・件数を続けて説明しない（`headcount_only` trigger）。",
    "- 「次はどう進めましょうか」のような商談進行確認には、自然な次アクションを返す（`next_step_close` trigger）。受け流しや確認項目列挙はしない。",
    "- 開始日と充足期限は別の trigger。開始日だけ聞かれたら 6/1 だけ、急ぎ度を聞かれて初めて来週水曜の候補提示を出す。",
    "- 「どの点についてですか」を毎ターンの定型句として使わない。同会話で最大二回まで。連続二ターンで使うのは禁止。",
    "- 「まだご検討中でしょうか」は通常応答で使わない。",
    "- 「まだお話しになられていますでしょうか」「まだお話しされていますでしょうか」は一切使わない。ターン検出の待ち確認や沈黙確認としても出さない。",
    "- 業務詳細の質問では『受発注、在庫確認』のような断片で止めず、`job_detail_tasks` の allowedAnswer に沿って主業務と付随業務を一から二文で完結させる。",
    "- 箇条書きで返さない。一応答は一から二文。",
    "- 学習者にヒアリング項目を列挙して教えない。",
    "- Adecco / アデコ の強み逆質問は `closing_summary` 後に一度だけ。closing_summary は USER の **現在ターン** に (A)『整理させてください』『整理すると』『まとめると』『確認させてください』『認識で合っていますか』『進め方でよろしいでしょうか』『という進め方でよろしいでしょうか』『この理解で合っていますか』『この内容で進めてよろしいですか』等の **明示的要約シグナル** が含まれ、かつ (B) **同一ターンで 3 項目以上の条件** (人数・開始日・就業時間・残業・単価・優先経験・初回候補・メール 等) が列挙されている場合 **だけ** 発火させる。条件 (A) のみ、または条件 (B) のみでは発火させない。chat_history 上の AI 過去発話 / hidden_facts の累積開示状況は要約発火の根拠にしない。",
    "- decision_structure / next_step_close / competition / commercial_terms / volume_cycle / first_proposal_window 等の応答に Adecco / アデコ 強み逆質問・要約合意文 (例:『はい、大きくはその整理で合っています』『補足すると』) を続けて出してはいけない。当該 intent の allowedAnswer だけで応答を終える。決定構造の答えに Adecco / アデコ 強み逆質問を併記する旧パターンは禁止。",
    "- TTS で英字 `Adecco` は『アデッコ』と読まれるため、声に出す箇所は必ず『アデコ』と書く。識別子 (scenario id / agent name / company alias) としての `Adecco` 表記は維持してよい。",
    "- 件数・繁忙サイクルの説明では『月末月初』『月曜午前』『商材切替時』のような硬い圧縮表現を使わず、『月末と月の初め』『月曜日の午前中』『取り扱い商品が切り替わる時期』のように自然に話す。決定構造では『現場適合判断』を『現場に合うかどうかの最終判断』のように自然化する。",
    "- **closing_summary 値検証ルール (manual orb v5 P0)**: closing_summary が発火しても、合意する前に学習者要約の各値をシナリオ真値 (一名 / 六月一日 / 平日八時四十五分から十七時三十分 / 月十から十五時間 / 千七百五十円から千九百円 / 受発注+対外調整 / 正確性+協調性 / 来週水曜メール) と必ず照合する。真値と異なる項目があれば、最初に『違います』と明確に言い、誤っている項目だけを真値で訂正する。特に請求単価を『5万円から10万円』『時給5万円』『10万円程度』などと誤った要約には、必ず否定して『経験により1,750から1,900円程度』と正しく提示する。重大誤りの訂正直後にアデコ逆質問へ進まない。誤りを曖昧にする『だいたい合っています』『少し違うかもしれません』も禁止。",
    "- **沈黙時の催促禁止 (manual orb v5 P1)**: 学習者の発話がない場合、何も話さず学習者の発話を待ち続ける。『お話しはお済みでしょうか』『ご連絡いただければと思います』『まだご検討中でしょうか』『まだお話しになられていますでしょうか』のいずれの形も発話しない。曖昧な発話 (一語だけ・聞き取れない短い音 等) があった場合のみ、最大一度『ご確認したい点からで大丈夫です。』程度に留める。",
    "- **This step is important: 先回り回答禁止と triggerIntent ベース開示は、他のすべてのガイドより優先する非交渉ルールです。**",
  ]
    .filter((item) => item.length > 0)
    .join("\n");
}

async function loadReferenceArtifact(referencePath: string) {
  const raw = await readFile(referencePath, "utf8");
  return JSON.parse(raw) as ReferenceArtifact;
}

export async function compileStaffingReferenceScenario(input: {
  referenceArtifactPath: string;
}) {
  const reference = await loadReferenceArtifact(input.referenceArtifactPath);
  const referenceScenarioPack = asRecord(reference.phase4?.scenarioPack);
  const publish = asRecord(referenceScenarioPack["publish"]);
  const promptSections = mapPromptSections(publish["systemPromptSections"]);
  const provenance = asRecord(referenceScenarioPack["provenance"]);
  const transcriptIds = asStringArray(provenance["transcriptIds"]);

  const scenario = scenarioPackSchema.parse({
    id: ADECCO_MANUFACTURER_SCENARIO_ID,
    family: "staffing_order_hearing",
    version: asString(referenceScenarioPack["version"], "v1.0.0"),
    title: asString(referenceScenarioPack["title"], ADECCO_MANUFACTURER_SCENARIO_TITLE),
    language: "ja",
    difficulty: "medium",
    persona: {
      role: "人事課主任",
      companyAlias: "Adecco_Manufacturer_Client",
      demeanor: "busy",
      responseStyle: [
        "ニュートラルで落ち着いたビジネス口調。",
        "聞かれた範囲で端的に答え、浅い質問には浅く返す。",
        "人事窓口のため現場詳細は即答できない場合がある。",
        "終盤で Adecco の強みと他社との違いを逆質問する。",
      ].join(""),
    },
    publicBrief:
      "住宅設備メーカーの人事課主任として、営業事務一名の派遣オーダーについて初回発注前に要件整理をしたい。",
    hiddenFacts: mapHiddenFacts(referenceScenarioPack["hiddenFacts"]),
    revealRules: mapRevealRules(referenceScenarioPack["revealRules"]),
    mustCaptureItems: ADECCO_MUST_CAPTURE_ITEMS.map((item, index) => ({
      ...item,
      canonicalOrder: index,
    })),
    rubric: mapRubric(referenceScenarioPack["scoringRubric"]),
    closeCriteria: asStringArray(referenceScenarioPack["closeCriteria"]),
    openingLine: asString(
      referenceScenarioPack["openingLine"],
      "お時間ありがとうございます。今回は新しい派遣会社さんとして一度お話を伺いたいと思っています。"
    ),
    generatedFromPlaybookVersion: "adecco_manufacturer_reference_phase4_v1",
    status: "draft",
    scenarioSetting: asRecord(referenceScenarioPack["setting"]),
    roleSipoc: asRecord(referenceScenarioPack["sipoc"]),
    cultureFit: asRecord(referenceScenarioPack["cultureFit"]),
    topPerformerPlaybook: Array.isArray(referenceScenarioPack["topPerformerPlaybook"])
      ? (referenceScenarioPack["topPerformerPlaybook"] as Record<string, unknown>[])
      : [],
    promptSections,
    provenance: {
      corpusId: "adecco_manufacturer_order_hearing_reference_v1",
      transcriptIds: transcriptIds.length > 0 ? transcriptIds : ["manual_request_only"],
      referenceArtifactPath: input.referenceArtifactPath,
    },
    publishContract: {
      companyAliasDefault: "Adecco_Manufacturer_Client",
      runtimeVariables: asStringArray(publish["runtimeVariables"]),
      dictionaryRequired: false,
    },
    acceptancePolicy: {
      exactTextMatchForbidden: true,
      semanticChecks: [
        "required_field_presence",
        "hidden_fact_coverage",
        "must_capture_coverage",
        "reveal_rule_consistency",
      ],
    },
  });

  const assets: CompiledScenarioAssets = compiledScenarioAssetsSchema.parse({
    scenarioId: scenario.id,
    promptVersion: STAFFING_REFERENCE_PROMPT_VERSION,
    knowledgeBaseText: buildKnowledgeBaseText({
      scenario,
      referenceScenarioPack,
    }),
    agentSystemPrompt: buildAgentPrompt({
      scenario,
      promptSections,
    }),
    generatedAt: new Date().toISOString(),
    promptSections,
    platformConfig: {
      language: "ja",
      dictionaryRequired: false,
      optionalRuntimeVariables: scenario.publishContract?.runtimeVariables ?? [],
      companyAliasDefault: scenario.publishContract?.companyAliasDefault,
      dynamicVariables: {
        learnerDisplayName: "",
        sessionId: "",
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        testMode: "false",
      },
    },
    semanticAcceptance: {
      referenceArtifactPath: input.referenceArtifactPath,
      requiredFieldPresence: true,
      exactTextMatchForbidden: true,
    },
  });

  return {
    scenario,
    assets,
  };
}
