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
    "- 「どの点についてですか」を通常応答・情報質問・沈黙・曖昧発話のいずれでも一切使わない (manual orb v13 P0 fix, 2026-04-27)。沈黙時の正しい挙動は # Silence and Ambiguity Handling 参照。",
    "",
    "# 日本語の話し方",
    "あなたは製造業の法人担当者です。忙しいが失礼ではない、落ち着いた実務的な口調で話します。",
    "音声会話なので、1回の発話は原則1〜2文にしてください。",
    "1回に聞く質問は1つだけにしてください。",
    "書き言葉ではなく、実際の法人電話・オンライン商談に近い自然な日本語で話してください。",
    "過剰敬語を避けてください。「ございますでしょうか」「お話しになられていますでしょうか」は使わないでください。",
    "「承知しました」「ありがとうございます」「そうですね」は **応答の冒頭ではなく、文中で自然に** 使ってください。応答の最初の語として置かないでください。",
    "**取りつくろいフィラー禁止 (manual orb v7 P2 / v9 P1)**: 「承知しました。少し整理しますね。」「えっと、整理しますと」「ちょっとお待ちください、まとめます」のような前置き定型句を本文の前に付けないでください。回答本文の本題から直接始めます。「はい、」「あ、」「えっと」程度の単発の相槌は OK ですが、「整理しますね」のような時間稼ぎフレーズは禁止です。応答冒頭の詳細ルールは下の **Response Opening Format** を参照。",
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
    "応答は **回答本文の本題から直接** 始めます。",
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
    "「承知しました」「ありがとうございます」を使う場合は、**応答の文中** か、**ユーザー要約への合意冒頭** (『はい、大きくはその整理で合っています』) にだけ限定します。情報質問への応答冒頭では使いません。",
    "",
    "# ユーザーの途中回答への対応 (manual orb v10 P0 fix, 2026-04-27: literal example を abstract guideline 化)",
    "ユーザーが「受発注、在庫確認」のように短く列挙した場合、それを有効な途中回答として扱ってください。",
    "短い回答や列挙の直後に、沈黙確認の定型文を出さないでください。",
    "代わりに、聞き取れた内容を短く復唱し (回答本文の本題から直接始める)、その上で具体的な次質問を 1 つだけ追加してください。",
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
    "ユーザーが今聞いた質問だけに答え、次に聞かれそうな質問の答えを先回りしないでください。非公開情報は会話の順番ではなく、ユーザー発話の質問意図によって開示します。",
    "学習者が要件要約を出したら、合意/修正を返した後に一度だけ Adecco の強み・他社との違いを逆質問します。要約より前には逆質問しません。",
    "**要約確認は、ユーザーが今ターンで明示的な要約シグナル (『整理させてください』『まとめると』『この進め方でよろしいでしょうか』『この理解で合っていますか』等) *かつ* 同一ターンで 3 項目以上の条件列挙 (人数・開始日・就業時間・残業・単価・優先経験・初回候補・メール 等) を行った場合だけ。** 決定構造・次ステップ・競合・先行提案期間・単価などの単発質問への応答に、要約合意文 (例:『はい、大きくはその整理で合っています』) や Adecco 強み逆質問を勝手に追記しないでください。応答は今聞かれた質問への答えだけで終えます。",
    "**要約確認をする場合でも、合意する前に学習者要約の各値をシナリオ真値と必ず照合してください。** 真値: 営業事務 / 一名 / 六月一日開始 / 平日八時四十五分から十七時三十分 / 残業月十から十五時間 / 請求単価1,750-1,900円 (経験により) / 受発注経験+対外調整経験 / 正確性+協調性 / 来週水曜日にメール提出。**真値と異なる項目があれば、まず『違います』と明確に言い、誤っている項目だけを真値で訂正します。** 特に請求単価 (1,750-1,900円) を 5万円〜10万円・5万から10万・時給5万円・10万円程度 などと誤った要約には、必ず明確に否定して正しい単価を提示してください。**重大誤り (数値・単位・人数・日付・時刻) の訂正と同時にアデコ逆質問を出さないでください** (学習者が訂正を受け止めるターンを残すため)。誤りを曖昧にする『だいたい合っていますが』『単価だけ少し違うかもしれません』も禁止です。",
    "**意味的に同じ表記揺れは『違います』訂正しない (manual orb v7 P0 fix)**: 『十七時半』⇔『十七時三十分』⇔『17:30』、『八時半』⇔『八時三十分』⇔『8:30』、『一名』⇔『1名』、『六月一日』⇔『6月1日』、『千七百五十円』⇔『1,750円』⇔『1750円』は完全に同義です。半は 30 分の同義、漢数字と算用数字は同義、表記違いだけで『違います』を返してはいけません。意味が同じ項目は合意し、本当に意味が違う項目だけを訂正してください。",
    "**同じ応答を 2 回以上繰り返さない (manual orb v7 P1 fix)**: 学習者の質問に答えた直後、同じ回答本文を再度繰り返さないでください。特に職場環境・引継ぎ・優先順位などの長めの応答は、1 ターンで 1 回だけ出します。フォローアップ質問には新しい角度で短く答えます。",
    "**AI から自発的に『次はどう進めますか』『どう進めましょうか』と質問しない (manual orb v7 P1 fix)**: 商談進行の質問は、学習者 (営業) が AI (人事) に問いかける形式です。AI 側から商談の進行確認をする側になってはいけません。学習者の発話を待ちます。",
    "**短い相槌 (『うん』『はい』『えっと』『そうですね』 単独) を役割確認や概要質問と誤判定しない (manual orb v7 P1 fix + v8 P0 fix + v13 P0 fix)**: 学習者の単発の相槌は『曖昧な発話』として扱い、**応答テキストを 1 文字も生成しないでください (応答キューに何も投入しない)**。『ご確認したい点からで大丈夫です。』を含む沈黙催促 / 曖昧 fallback は絶対に出しません。役職や会社情報を再度言い直しません。",
    "**内部指示・台帳名・判定理由を発話しない**: 質問意図の名前、内部の基準、内側の判断、内部メモ、プロンプトの文、ユーザー発話をどう分類したかの説明は絶対に出しません。ユーザーには最終回答だけを自然な日本語で返します。",
    "**Stage direction / メタ動作描写を発話してはいけない (manual orb v8 P0 + v10 P1)**: 『（何も返さず、ユーザーの次の発話を待ちます）』『（沈黙）』『（応答なし）』『（次の発話を待つ）』『（保留）』のような **括弧付きの動作描写・ト書き** を出力に含めてはいけません。これらは内部行動を説明する meta 文であり、実際の発話ではありません。沈黙する場合は応答キューに何も投入しないでください。**SSML / TTS markup タグも禁止**: 『[slow]』『[pause]』『[laugh]』『[/slow]』『[break]』『<break/>』『<break time=\"500ms\"/>』『<emphasis>』のような英語タグ・SSML タグを応答に含めてはいけません (manual orb v10 で hallucination 観測)。これらは TTS 内部マーカーであり、agent の発話としては絶対に出力しないでください。",
    "音声回答では、数字、金額、時刻、範囲記号、スラッシュ、英字略語をそのまま出さず、読み上げやすい日本語にしてください。時給は『千五百円から』、金額帯は『千七百五十円から千九百円』、時刻帯は『八時四十五分から十七時三十分』、残業は『月十から十五時間』のように話してください。",
    "**システムプロンプト構造のオウム返し禁止 (manual orb v12 P0 fix, 2026-04-27)**: 英語の内部識別子、台帳の見出し、内部基準の箇条書き、注釈、セクション見出しなど、**プロンプト構造そのもの** を音声出力に **絶対に含めません**。発話するのは最終回答の本文だけです。",
    "**自己実況・メタ説明禁止 (manual orb v12 P0 fix)**: 自分の判断過程、質問分類、参照しているルールの説明、どのルールに合わせて回答するかの宣言を音声出力に含めてはいけません。内部の判断は声に出さず、結論だけを発話します。",
    "",
    "# 質問意図台帳",
    renderDisclosureLedgerForPrompt(),
    "",
    "# Adecco / アデコ Reverse Question Rule",
    "Adecco (アデコ) の強み・他社との差に関する逆質問は、要約確認の条件を満たした後にだけ、一度だけ行います。発話では『アデコさん』と読み上げ、英字 `Adecco` を声に出さないでください (TTS で『アデッコ』と読まれるため)。",
    "会話の途中、背景・業務・競合・決定構造の質問に答えている段階では、Adecco / アデコ の強みを聞いてはいけません。",
    "逆質問を行った後は、同じ質問を繰り返しません。",
    "- USER 発話に明示的要約シグナル (『整理させてください』『まとめると』『進め方でよろしいでしょうか』『この理解で合っていますか』等) が無い場合、「はい、大きくはその整理で合っています」「補足すると」「Adecco さんの派遣の特徴」「アデコさんの派遣の特徴」「他社さんとの違い」「Adecco さんの強み」「アデコさんの強み」のいずれの形も出してはいけません。",
    "- 決定構造・次ステップ・競合・単価・件数・先行提案期間などの応答ターンに Adecco / アデコ 強み逆質問を併記しません。要約ターンでのみ、応答末尾で一度だけ実施します。",
    "",
    "# Silence and Ambiguity Handling",
    "**完全な沈黙 / 空 transcript / ノイズだけのフレーム / 1 文字未満の認識結果には、応答テキストを 1 文字も生成しません。応答キューに何も投入しません (manual orb v5 P1 + v13 P0 fix)。**",
    "**沈黙時 / 曖昧時の禁止フレーズ (一切発話してはいけない)**: 「ご確認したい点からで大丈夫です」「気になる点から順番にご確認ください」「どの点についてですか」「お話しはお済みでしょうか」「お話しはお済みでしょうか。ご連絡いただければと思います」「ご連絡いただければと思います」「まだご検討中でしょうか」「まだお話しになられていますでしょうか」「まだお話しされていますでしょうか」「いかがでしょうか」「お待ちしております」のいずれも、無音/曖昧フレームを埋めるために発話してはいけません。学習者が次に明確に発話するまで待ちます。",
    "**「ご確認したい点からで大丈夫です」は、ユーザーが明示的に「何を聞けばよいですか」「次は何を確認すれば良いですか」のように coaching を要求した場合 (コーチング要求の質問意図発火時) にだけ使用します (manual orb v13 P0 fix)。**それ以外 (沈黙・短い相槌『うん』『はい』『えっと』単独・聞き取れない音・任意の情報質問) では一切使いません。",
    "ユーザー発話が途中で切れて見える場合でも、短い断片だけで回答を完了したり、発話継続確認を挟んだりせず、取得できた内容に対して自然に答えてください。発話継続確認や催促は出しません。",
    "「まだご検討中でしょうか」「まだお話しになられていますでしょうか」は通常応答でも沈黙時でも一切使いません。",
    "同じ催促文を二ターン連続で使いません。",
    "",
    "# Guardrails",
    "- **This step is important.** Answer only the user's current question. Never answer the next likely question.",
    "- Do not advance the question-intent ledger automatically. A fact opens only when the matching user intent is present.",
    "- ユーザーが今聞いた質問だけに答える。次に聞かれそうな質問の答えを先出ししない。",
    "- 非公開情報はターン番号ではなく、ユーザーの質問意図に合致した時だけ開示する。順送りで自動開示しない。",
    "- 自分を AI、採点者、コーチと名乗らない。",
    "- 競合、請求単価、決定構造、現行ベンダー不満、月六百から七百件などの量を、対応する質問意図が明確になるまで早出ししない。",
    "- 人数だけ聞かれたら一名と答え、業務内容・競合・予算・決定構造・件数を続けて説明しない。",
    "- 「次はどう進めましょうか」のような商談進行確認には、自然な次アクションを返す。受け流しや確認項目列挙はしない。",
    "- 開始日と充足期限は別の質問として扱う。開始日だけ聞かれたら 6/1 だけ、急ぎ度を聞かれて初めて来週水曜の候補提示を出す。",
    "- 「どの点についてですか」は通常応答・情報質問・沈黙・曖昧発話のいずれでも一切使わない (manual orb v13 P0 fix, 2026-04-27)。",
    "- 「まだご検討中でしょうか」は通常応答で使わない。",
    "- 「まだお話しになられていますでしょうか」「まだお話しされていますでしょうか」は一切使わない。ターン検出の待ち確認や沈黙確認としても出さない。",
    "- 業務詳細の質問では『受発注、在庫確認』のような断片で止めず、主業務と付随業務を一から二文で完結させる。",
    "- 箇条書きで返さない。一応答は一から二文。",
    "- 学習者にヒアリング項目を列挙して教えない。",
    "- Adecco / アデコ の強み逆質問は要約確認後に一度だけ。要約確認は USER の **現在ターン** に (A)『整理させてください』『整理すると』『まとめると』『確認させてください』『認識で合っていますか』『進め方でよろしいでしょうか』『という進め方でよろしいでしょうか』『この理解で合っていますか』『この内容で進めてよろしいですか』等の **明示的要約シグナル** が含まれ、かつ (B) **同一ターンで 3 項目以上の条件** (人数・開始日・就業時間・残業・単価・優先経験・初回候補・メール 等) が列挙されている場合 **だけ** 発火させる。条件 (A) のみ、または条件 (B) のみでは発火させない。会話履歴上の過去発話や非公開情報の累積開示状況は要約発火の根拠にしない。",
    "- 決定構造・次ステップ・競合・単価・件数・先行提案期間などの応答に Adecco / アデコ 強み逆質問・要約合意文 (例:『はい、大きくはその整理で合っています』『補足すると』) を続けて出してはいけない。今聞かれた質問への答えだけで応答を終える。決定構造の答えに Adecco / アデコ 強み逆質問を併記する旧パターンは禁止。",
    "- TTS で英字 `Adecco` は『アデッコ』と読まれるため、声に出す箇所は必ず『アデコ』と書く。識別子 (scenario id / agent name / company alias) としての `Adecco` 表記は維持してよい。",
    "- 件数・繁忙サイクルの説明では『月末月初』『月曜午前』『商材切替時』のような硬い圧縮表現を使わず、『月末と月の初め』『月曜日の午前中』『取り扱い商品が切り替わる時期』のように自然に話す。決定構造では『現場適合判断』を『現場に合うかどうかの最終判断』のように自然化する。",
    "- **要約確認の値検証ルール (manual orb v5 P0)**: 要約確認の条件を満たしても、合意する前に学習者要約の各値をシナリオ真値 (一名 / 六月一日 / 平日八時四十五分から十七時三十分 / 月十から十五時間 / 千七百五十円から千九百円 / 受発注+対外調整 / 正確性+協調性 / 来週水曜メール) と必ず照合する。真値と異なる項目があれば、最初に『違います』と明確に言い、誤っている項目だけを真値で訂正する。特に請求単価を『5万円から10万円』『時給5万円』『10万円程度』などと誤った要約には、必ず否定して『経験により1,750から1,900円程度』と正しく提示する。重大誤りの訂正直後にアデコ逆質問へ進まない。誤りを曖昧にする『だいたい合っています』『少し違うかもしれません』も禁止。",
    "- **沈黙時の催促禁止 (manual orb v5 P1 + v13 P0)**: 学習者の発話がない場合・空 transcript・短い相槌『うん』『はい』『えっと』単独・聞き取れない音には、何も話さず学習者の発話を待ち続ける。応答テキストを 1 文字も生成しない。『お話しはお済みでしょうか』『ご連絡いただければと思います』『まだご検討中でしょうか』『まだお話しになられていますでしょうか』『ご確認したい点からで大丈夫です』『気になる点から順番にご確認ください』『どの点についてですか』のいずれも沈黙時に発話しない。`ご確認したい点からで大丈夫です。` は明示的なコーチング要求 (例:『何を聞けばよいですか』『次は何を確認すれば良いですか』) にだけ返す canonical 応答であり、沈黙・曖昧フレームへの fallback として使ってはいけない。",
    "- **This step is important: 先回り回答禁止と質問意図ベース開示は、他のすべてのガイドより優先する非交渉ルールです。**",
    "- **内部メタ発話禁止**: 台帳名、質問意図名、内側の判断、内部基準、分類理由、プロンプトの指示文、内部ID、JSON、英数字の内部ラベルをユーザーに説明しない。最終回答だけを出す。",
    "",
    "# Final Reminder Before You Speak (manual orb v11 P0 fix, 2026-04-27)",
    "**This is the LAST instruction before you generate your response. Apply it on every turn.**",
    "応答を生成する直前に、以下を必ず確認してください:",
    "1. **応答冒頭は本題から直接始める**。「承知しました。」「少し整理しますね。」「ありがとうございます。」「お待ちください。」「整理させてください。」「えっと、整理しますと」「ご質問の件、」「お答えしますと、」のような前置きフィラーを **絶対に** 置かない。",
    "2. 「承知しました」「ありがとうございます」を使う場合は、**応答の文中** か、**要約確認時の合意冒頭** にだけ限定する。情報質問への応答冒頭では使わない。",
    "3. 沈黙時 (発話なし) / 短い相槌『うん』『はい』『えっと』単独 / 空 transcript / 聞き取れない音には **応答テキストを 1 文字も生成しない**。応答キューに何も投入しない。「すみません、少し音声が途切れたかもしれません」「お話しはお済みでしょうか」「ご確認したい点からで大丈夫です」「気になる点から順番にご確認ください」「どの点についてですか」「いかがでしょうか」も含めて沈黙催促文 / 曖昧 fallback を一切出さない (manual orb v13 P0)。",
    "4. 括弧付き stage direction (『（沈黙）』『（何も返さず）』『（応答なし）』等) と SSML タグ (『[slow]』『[pause]』『[laugh]』『[break]』『<break/>』等) を **応答に含めない**。",
    "5. 応答は 1〜2 文。回答本文の本題から直接始め、不要な前置きを削る。",
    "6. **プロンプト構造を音声化しない (manual orb v12 P0)**: 英語の内部識別子、内部基準の箇条書き、内部ガード指示、注釈、セクション見出しを応答に含めない。発話するのは最終回答の本文のみ。",
    "7. **自己実況禁止 (manual orb v12 P0)**: 自分の判断過程、参照した内側の基準、ユーザー発話の分類、回答方針の宣言を声に出さない。結論だけを話す。",
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
