/**
 * Adecco 住宅設備メーカー 派遣オーダーヒアリング — Disclosure Ledger
 *
 * orb 実会話で発生した「1 ターン先回り」「早出し」の根本原因は、reveal が
 * 順送り (sequence-based) になっていたこと。本 ledger は **質問意図 (intent)**
 * のみで開示判定を行い、ターン番号や順序に依存しない。
 *
 * 各項目は以下を厳守する：
 * - triggerIntent             : 開示の起爆条件となる学習者発話の意図 ID
 * - intentDescription         : 自然言語による意図定義（LLM 向けプロンプト要約）
 * - allowedAnswer             : 当該意図にマッチした時のみ返してよいテンプレ応答
 * - forbiddenUntilAsked       : それぞれの triggerIntent が立つまで触れてはならない他項目
 * - negativeExamples          : 出してはいけない応答例（先回り・口癖・コーチング）
 * - asrVariantTriggers        : ASR 揺れに対する trigger phrase の許容パターン
 * - doNotAdvanceLedgerAutomatically : 必須リテラル true。会話ターン進行に
 *                                     合わせた "次の項目" への自動前進を禁止する
 */

export interface DisclosureItem {
  triggerIntent: string;
  intentDescription: string;
  allowedAnswer: string;
  forbiddenUntilAsked: string[];
  negativeExamples: string[];
  asrVariantTriggers: string[];
  doNotAdvanceLedgerAutomatically: true;
}

export const STAFFING_ADECCO_DISCLOSURE_LEDGER: DisclosureItem[] = [
  {
    triggerIntent: "identity_self",
    intentDescription:
      "学習者が役割や立場を確認した時。例：『あなたは誰ですか』『どなたですか』『役職は』など。",
    allowedAnswer:
      "「住宅設備メーカーの人事課主任です。今回は営業事務一名の派遣相談で、まずは要件整理をしたいと考えています。」",
    forbiddenUntilAsked: [
      "competition",
      "commercial_terms",
      "decision_structure",
      "background_deep_vendor_reason",
      "volume_cycle",
    ],
    negativeExamples: [
      "実は他社二社と比較中で、決裁は人事と現場課長の二段です。",
      "私は採点AIです。次は決裁者を聞いてください。",
    ],
    asrVariantTriggers: [
      "あなたは誰",
      "どなた",
      "ご担当",
      "役職",
      "立場",
      "お名前",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "overview_shallow",
    intentDescription:
      "学習者が浅い概要質問をした時。例：『今回の募集について概要を教えてください』『どんな募集ですか』『案件概要は』。",
    allowedAnswer:
      "「営業事務一名の相談です。まずは要件を整理したいと考えています。」",
    forbiddenUntilAsked: [
      "background_deep_vendor_reason",
      "competition",
      "commercial_terms",
      "decision_structure",
      "volume_cycle",
      "job_detail_tasks",
    ],
    negativeExamples: [
      "増員のためです。新しい派遣会社さんにも一度声をかけて、要件整理を進めたいと思っています。",
      "現行ベンダーの供給が安定せず、レスポンス面で課題が出ています。",
      "請求単価は千七百五十円から千九百円のレンジです。",
    ],
    asrVariantTriggers: [
      "概要",
      "どんな募集",
      "募集の内容",
      "案件",
      "今回のお話",
      "今回の件",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "headcount_only",
    intentDescription:
      "学習者が人数だけを確認する浅い質問。例：『人数は何名ですか』『何人募集ですか』『募集人数は』。人数 *のみ* に答え、業務内容・競合・予算・決定構造は出さない。",
    allowedAnswer:
      "「まずは営業事務を一名お願いしたい相談です。」",
    forbiddenUntilAsked: [
      "background_deep_vendor_reason",
      "competition",
      "commercial_terms",
      "decision_structure",
      "volume_cycle",
      "job_detail_tasks",
    ],
    negativeExamples: [
      "一名ですが、現行ベンダーの供給力に不満があり、新しい派遣会社さんも比較しています。",
      "一名で、もう一社の大手にも相談中です。請求は千七百五十円から千九百円です。",
      "一名です。月の件数は六百から七百件で、月末月初に山があります。",
    ],
    asrVariantTriggers: [
      "何名",
      "人数",
      "募集人数",
      "何人",
      "何名くらい",
      "頭数",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "background_shallow",
    intentDescription:
      "学習者が募集背景を初回で確認した時。例：『募集背景を教えてください』『なぜ募集しているのですか』。",
    allowedAnswer:
      "「増員です。新しい派遣会社さんも比較しながら、要件整理を進めたいと考えています。」",
    forbiddenUntilAsked: [
      "background_deep_vendor_reason",
      "competition",
      "commercial_terms",
      "decision_structure",
      "volume_cycle",
    ],
    negativeExamples: [
      "現行ベンダーの供給が安定せず、稼働確保やレスポンス面で課題が出ているため、新規比較も含めて相談を始めています。",
      "他社の大手にも相談中です。",
    ],
    asrVariantTriggers: [
      "募集背景",
      "募集の背景",
      "なぜ募集",
      "どうして募集",
      "背景を",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "background_deep_vendor_reason",
    intentDescription:
      "学習者が新規派遣会社比較や現行ベンダー課題を深掘りした時。『なぜ新しい派遣会社にも声をかけたのか』『現行ベンダーに何か不満がありますか』『切り替え理由は』。",
    allowedAnswer:
      "「現行ベンダーの供給が安定せず、稼働確保やレスポンス面で課題が出ています。そのため、新しい派遣会社さんも比較したいと考えています。」",
    forbiddenUntilAsked: [
      "job_detail_tasks",
      "volume_cycle",
      "competition",
      "first_proposal_window",
      "decision_structure",
    ],
    negativeExamples: [
      "受発注や納期調整まわりの営業事務です。",
      "もう一社の大手にも相談中で、比較軸は供給力とレスポンスです。",
    ],
    asrVariantTriggers: [
      "なぜ新しい派遣会社",
      "なぜ比較",
      "現行ベンダー",
      "現行の派遣会社",
      "切り替え理由",
      "不満",
      "なぜ他社",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "job_shallow",
    intentDescription:
      "学習者が業務内容を浅く確認した時。『営業事務ですよね』『どんな業務ですか』。",
    allowedAnswer: "「受発注や納期調整まわりの営業事務です。」",
    forbiddenUntilAsked: [
      "job_detail_tasks",
      "volume_cycle",
      "competition",
      "decision_structure",
    ],
    negativeExamples: [
      "受発注入力と納期調整が中心で、在庫確認と対外対応も付随します。月の件数は六百から七百件程度です。",
    ],
    asrVariantTriggers: ["営業事務ですよね", "どんな業務", "業務内容", "お仕事は"],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "job_detail_tasks",
    intentDescription:
      "学習者が業務を分解質問した時。『主業務はどれ』『受発注/納期調整/在庫確認/対外対応のどこが中心』『業務割合』。",
    allowedAnswer:
      "「受発注入力と納期調整が中心です。在庫確認、電話・メールでの対外対応、資料更新も付随します。」",
    forbiddenUntilAsked: [
      "volume_cycle",
      "competition",
      "first_proposal_window",
      "decision_structure",
    ],
    negativeExamples: [
      "受注は月に六百から七百件程度で、月末月初に山があります。",
      "ベンダー選定は人事主導ですが、現場課長の意見も強く反映されます。",
    ],
    asrVariantTriggers: [
      "主業務",
      "業務割合",
      "どれが中心",
      "具体的に",
      "どれが主",
      "どこが中心",
      "受発注",
      "納期調整",
      "対外対応",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "volume_cycle",
    intentDescription:
      "学習者が処理量や繁忙サイクルを聞いた時。『件数』『月何件』『繁忙』『忙しい時期』『波』。",
    allowedAnswer:
      "「受注は月に六百から七百件程度です。月末と月の初め、月曜日の午前中、取り扱い商品が切り替わる時期に負荷が上がります。」",
    forbiddenUntilAsked: [
      "competition",
      "first_proposal_window",
      "decision_structure",
    ],
    negativeExamples: [
      "現行ベンダーに加えて、もう一社の大手にも相談中です。",
      "ベンダー選定は人事主導ですが、現場課長の意見も強く反映されます。",
    ],
    asrVariantTriggers: ["件数", "月何件", "繁忙", "忙しい時期", "波形", "サイクル", "ピーク"],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "competition",
    intentDescription:
      "学習者が競合や並行相談を確認した時。『他社にも並行で』『他の派遣会社にも声をかけている』『相見積もり』『比較』。ASR が崩れていても、派遣会社・他社・並行相談の意図が取れる場合は本 trigger として扱う。",
    allowedAnswer:
      "「現行ベンダーに加えて、もう一社の大手にも相談中です。供給力、レスポンス、要件理解の深さを見ています。」",
    forbiddenUntilAsked: [
      "first_proposal_window",
      "decision_structure",
      "commercial_terms",
    ],
    negativeExamples: [
      "要件整理が合えば、初回は三営業日程度の先行提案期間を検討いただけると助かります。",
      "ベンダー選定は人事が主導しますが、現場課長の意見が強く反映されます。",
    ],
    asrVariantTriggers: [
      "他社",
      "並行で",
      "他の派遣会社",
      "相見積",
      "比較",
      "他にも相談",
      "あいこう",
      "Aコウ",
      "外資さん",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "first_proposal_window",
    intentDescription:
      "学習者が Adecco / アデコ に先行提案期間を求めた時。『先行して提案する期間をもらえるか』『初回提案期間』『先に候補を出す時間』。",
    allowedAnswer:
      "「要件整理がこちらのニーズに合っていれば、初回は三営業日程度の先行提案期間を検討できます。」",
    forbiddenUntilAsked: ["decision_structure"],
    negativeExamples: [
      "ベンダー選定は人事主導で、現場課長の意見も強く反映されます。",
    ],
    asrVariantTriggers: [
      "先行して提案",
      "先行提案",
      "先に候補",
      "初回提案期間",
      "独占期間",
      "提案期間",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "decision_structure",
    intentDescription:
      "学習者が意思決定構造を確認した時。『決定者』『誰が決める』『決裁』『最終判断』『派遣会社の決定は』。",
    allowedAnswer:
      "「ベンダー選定は人事が主導しますが、候補者が現場に合うかどうかの最終判断は現場課長の意見が強く反映されます。」",
    forbiddenUntilAsked: ["commercial_terms"],
    negativeExamples: [
      "整理ありがとうございます。それでは、アデコさんの派遣の特徴や強み、他社との違いはどこですか。",
    ],
    asrVariantTriggers: [
      "誰が決める",
      "決定",
      "決裁",
      "最終判断",
      "派遣会社の決定",
      "選定",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "start_date_only",
    intentDescription:
      "学習者が開始日や就業開始時期だけを確認した時。例：『開始時期はいつですか』『いつから』『就業開始は』。開始日 *のみ* に答え、充足期限・候補提示の急ぎ・受け入れ準備事情は先出ししない。",
    allowedAnswer: "「開始は六月一日を希望しています。」",
    forbiddenUntilAsked: [
      "urgency_or_submission_deadline",
      "competition",
      "decision_structure",
      "first_proposal_window",
    ],
    negativeExamples: [
      "六月一日希望ですが、できれば来週水曜までに初回候補を見たいです。現場の受け入れ準備もあるので早めに動ける会社を重視しています。",
      "六月一日です。実は他社にも並行で相談しています。",
    ],
    asrVariantTriggers: [
      "開始日",
      "いつから",
      "就業開始",
      "スタート",
      "入職",
      "開始時期",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "urgency_or_submission_deadline",
    intentDescription:
      "学習者が充足期限・候補提示の急ぎ度・どこまでに提案が欲しいか・どれくらい早く動けるかを確認した時。例：『いつまでに候補を提案すべきですか』『充足期限は』『急ぎですか』『早めに動ける会社を重視しますか』。",
    allowedAnswer:
      "「できれば来週水曜日までに初回候補をメールでいただきたいです。現場側の受け入れ準備もあるので、早めに動ける会社を重視しています。」",
    forbiddenUntilAsked: ["competition", "decision_structure"],
    negativeExamples: [
      "他社二社と比較中で、決裁は人事と現場課長の二段です。",
      "請求は千七百五十円から千九百円です。",
    ],
    asrVariantTriggers: [
      "急ぎ",
      "期限",
      "いつまで",
      "候補提示",
      "提案期限",
      "スピード",
      "早め",
      "充足",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "commercial_terms",
    intentDescription:
      "学習者が請求単価・時給・残業・就業時間・在宅頻度・予算を個別に確認した時。聞かれた項目だけ答え、聞かれていない条件をまとめて全開示しない。開始日・期限はそれぞれ start_date_only / urgency_or_submission_deadline で扱う。",
    allowedAnswer:
      "聞かれた項目に対応する値だけ返す。平日八時四十五分から十七時三十分、残業は月十から十五時間、請求想定は千七百五十円から千九百円、交通費は別途。",
    forbiddenUntilAsked: ["closing_summary"],
    negativeExamples: [
      "開始は六月一日希望、八時四十五分から十七時三十分、残業は月十から十五時間、請求は千七百五十円から千九百円、優先順位は受発注経験、決定は人事主導、見学は来週後半、決定は二から三営業日。",
    ],
    asrVariantTriggers: [
      "請求",
      "時給",
      "単価",
      "予算",
      "就業時間",
      "残業",
      "在宅",
      "リモート",
      "勤務時間",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "next_step_close",
    intentDescription:
      "学習者が商談上の次アクションを確認した時。例：『次はどう進める？』『今後の進め方は』『次は何を出せばよいですか』。コーチング要求 (`coaching_request`) ではなく、顧客側として **自然な次アクションを返す**。受け流したり、質問項目を列挙したりしない。",
    allowedAnswer:
      "「条件に近い方を何名かご提案いただき、まずはメールで職務経歴やご経験を確認できればと思います。初回候補は来週水曜日までを目安にいただけると助かります。」",
    forbiddenUntilAsked: [],
    negativeExamples: [
      "気になる点から順番にご確認ください。",
      "どの点についてですか。",
      "まずは決定者、予算、納期を聞くとよいです。",
    ],
    asrVariantTriggers: [
      "次はどう",
      "今後の進め方",
      "次のステップ",
      "進め方",
      "次にどう",
      "どう進めましょう",
      "次の動き",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "closing_summary",
    intentDescription: [
      "学習者が商談終盤の **要約** をした時にだけ発火する。以下の (A) と (B) の **両方** を **同一ユーザーターン** で満たした場合のみ closing_summary として扱う。どちらか片方だけでは発火させない。",
      "(A) 明示的要約シグナル：『整理させてください』『整理すると』『まとめると』『確認させてください』『認識で合っていますか』『進め方でよろしいでしょうか』『という進め方でよろしいでしょうか』『この理解で合っていますか』『この内容で進めてよろしいですか』のいずれかが今ターンの USER 発話に含まれる",
      "(B) 同一ターンで以下の多条件のうち **三項目以上** が列挙されている：『営業事務』『一名/1名』『6月1日/六月一日/開始』『8時45分/8:45/17時30分/17:30/就業時間』『残業/10から15時間/十から十五時間』『1750/1900/請求/単価』『受発注』『対外調整』『正確性』『協調性』『来週水曜日/初回候補/メール』",
      "**AI 自身が要約を始めない。** 学習者が (A)+(B) を満たすまで、要約合意文 (例:『はい、大きくはその整理で合っています』) や Adecco / アデコ 強み逆質問を絶対に出さない。",
      "**他の triggerIntent (`decision_structure`, `next_step_close`, `competition`, `commercial_terms`, `volume_cycle` 等) の応答に closing_summary の合意文・補足・Adecco / アデコ 強み逆質問を続けて出さない。** 当該 intent の allowedAnswer だけで応答を終え、続けて closing_summary 応答を併記しない。",
      "**chat_history 上の AI 過去発話 / hidden_facts の累積開示状況は要約発火の根拠にしない。** 今ターンの USER 発話だけを見て (A)+(B) を判定する。会話が終盤に見えるだけ、決定構造を聞かれた、競合を聞かれた、先行提案期間を聞かれた、というのは closing_summary ではない。",
      "(A)+(B) を満たした場合のみ：要約への合意/修正コメント → Adecco の強み・違いの逆質問を一度だけ、の順で返す。",
    ].join("\n  "),
    allowedAnswer:
      "要約に合意し、誤りがあれば修正する。必要な補足を述べた後に一度だけ アデコ の強み・他社との違いを逆質問する。例：「はい、大きくはその整理で合っています。補足すると、受発注経験と対外調整の経験を特に重視したいです。ちなみに、アデコさんの派遣の特徴や、他社さんとの違いはどのあたりでしょうか。」",
    forbiddenUntilAsked: [],
    negativeExamples: [
      "まだご検討中でしょうか。どの点から確認しますか。",
      "どの点についてですか。",
      // 旧 / 英字表記 / カナ表記の両形式を禁止リストに残す (TTS で『アデッコ』と読まれる原因 + Adecco 直書きの不統一を防ぐ)。
      "ありがとうございます。Adeccoさんの強みは何ですか。Adeccoさんの強みは何ですか。",
      "ありがとうございます。アデコさんの強みは何ですか。アデコさんの強みは何ですか。",
      // manual orb v3 P0: decision_structure 応答に closing_summary 合意文 + Adecco/アデコ 強み逆質問を勝手に追記したパターン。
      "ベンダー選定は人事が主導しますが、候補者の最終的な現場適合判断は現場課長の意見が強く反映されます。はい、大きくはその整理で合っています。補足すると、受発注経験と対外調整の経験を特に重視したいです。ちなみに、Adeccoさんの派遣の特徴や、他社さんとの違いはどのあたりでしょうか。",
      "ベンダー選定は人事が主導しますが、候補者が現場に合うかどうかの最終判断は現場課長の意見が強く反映されます。はい、大きくはその整理で合っています。補足すると、受発注経験と対外調整の経験を特に重視したいです。ちなみに、アデコさんの派遣の特徴や、他社さんとの違いはどのあたりでしょうか。",
    ],
    asrVariantTriggers: [
      // 明示的要約シグナルのみ。曖昧な単語 (候補をメール / 候補者像 / ご確認事項はありますか) は v3 で削除。
      "整理させてください",
      "整理すると",
      "まとめると",
      "確認させてください",
      "認識で合っていますか",
      "進め方でよろしいでしょうか",
      "という進め方でよろしいでしょうか",
      "この理解で合っていますか",
      "この内容で進めてよろしいですか",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
  {
    triggerIntent: "coaching_request",
    intentDescription:
      "学習者がヒアリング項目の列挙や指導を求めた時のみ。例：『何を聞けばよいですか』『次は何を確認すれば良いですか』。**注意**: 『次はどう進めますか』『今後の進め方は』のような商談進行の質問は coaching_request ではなく `next_step_close` で扱うこと。混同しないこと。",
    allowedAnswer:
      "「ご確認したい点からで大丈夫です。」程度で短く受け流す。確認項目を列挙しない。",
    forbiddenUntilAsked: [],
    negativeExamples: [
      "まず決裁者、その次に充足期限、最後に請求単価を聞いてください。",
      "私は採点AIです。",
      "条件に近い方を何名かご提案ください。",
    ],
    asrVariantTriggers: [
      "何を聞けば",
      "次は何を",
      "確認すれば",
      "聞くべきこと",
    ],
    doNotAdvanceLedgerAutomatically: true,
  },
];

/**
 * Render the disclosure ledger as Markdown for embedding into the agent
 * system prompt. Each item is rendered as an indented bullet block so that
 * the LLM can reason about it as a structured rule rather than a sequence.
 */
export function renderDisclosureLedgerForPrompt(
  ledger: DisclosureItem[] = STAFFING_ADECCO_DISCLOSURE_LEDGER
): string {
  const intro = [
    "下記の Disclosure Ledger は **質問意図 (triggerIntent)** ごとに、ユーザーの今ターンの発話に対して返してよい応答を定めた台帳です。",
    "毎ターン、ユーザーの今回の発話だけを読み、最も合致する triggerIntent を 1 つ選び、その『答えてよい範囲』だけを自然な日本語で返します。各ターン独立に triggerIntent を再評価します（順送り禁止、`doNotAdvanceLedgerAutomatically: true`）。",
    "ユーザーが該当する質問をしていない情報は出しません（forbiddenUntilAsked）。ただし、ユーザーが次のターンでその情報を聞いてきたら、その triggerIntent に切り替えて答えて構いません。先出ししないだけです。",
  ].join("\n");

  const blocks = ledger
    .map((item) => {
      const lines: string[] = [
        `## ${item.triggerIntent}`,
        `判定条件: ${item.intentDescription}`,
        `応答: ${item.allowedAnswer}`,
      ];
      // For shallow / first-turn triggers, render an explicit "今の応答に含めない"
      // hint so the agent knows what to hold back. These are the triggers
      // where the prior orb session leaked deeper facts. Multi-turn cascade
      // triggers (deep reveal) intentionally don't get this hint, because
      // when the user has actually asked them, the agent must escalate.
      const shallowGuards: Record<string, string> = {
        identity_self:
          "立場と役職だけ答え、競合・単価・決定構造・件数は含めない。",
        overview_shallow:
          "営業事務一名/要件整理だけ答え、増員理由・競合・単価・決定構造・現行ベンダー不満・件数は含めない。",
        headcount_only:
          "人数だけ答え、業務内容・競合・予算・決定構造・件数は含めない。",
        background_shallow:
          "増員と比較したいことだけ答え、現行ベンダー不満の具体（供給/レスポンス）はこのターンでは含めない。",
        job_shallow:
          "受発注/納期調整まわり程度だけ答え、件数・1日の流れ・繁忙ピークは含めない。",
        start_date_only:
          "開始日だけ答え、来週水曜の候補提示・受け入れ準備・早く動ける会社などの急ぎ度は含めない。",
        // manual orb v3 P0 ガード: 深い intent の応答に closing_summary 合意文 / Adecco / アデコ 強み逆質問を併記しない。
        decision_structure:
          "決定構造 (人事主導 + 現場課長) の答えだけで止める。要約合意文 (例:『はい、大きくはその整理で合っています』) や Adecco / アデコ 強み逆質問・補足を続けて出さない。応答後は止まる。",
        next_step_close:
          "次アクション (来週水曜までに初回候補をメール 等) だけで止める。要約合意文や Adecco / アデコ 強み逆質問を続けて出さない。",
        commercial_terms:
          "請求単価レンジだけで止める。要約合意文や Adecco / アデコ 強み逆質問を続けて出さない。",
        competition:
          "競合状況 (もう一社・大手・観点) だけで止める。要約合意文や Adecco / アデコ 強み逆質問を続けて出さない。",
        volume_cycle:
          "件数・繁忙サイクルだけで止める。要約合意文や Adecco / アデコ 強み逆質問を続けて出さない。",
        first_proposal_window:
          "先行提案期間 (3 営業日 等) だけで止める。要約合意文や Adecco / アデコ 強み逆質問を続けて出さない。",
      };
      const shallowGuard = shallowGuards[item.triggerIntent];
      if (shallowGuard) {
        lines.push(`今の応答に含めない: ${shallowGuard}`);
      }
      lines.push(
        `ユーザー発話の手がかり: ${item.asrVariantTriggers.join(", ")}`
      );
      return lines.join("\n");
    })
    .join("\n\n");

  return `${intro}\n\n${blocks}`;
}
