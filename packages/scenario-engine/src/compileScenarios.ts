import {
  COMPILE_SCENARIO_PROMPT_VERSION,
  DEFAULT_RUBRIC_WEIGHTS,
  DEFAULT_SCENARIO_IDS,
  SCENARIO_VARIANT_TITLES,
  type CompiledScenarioAssets,
  type PlaybookNorms,
  type ScenarioPack,
  type ScenarioVariant,
} from "@top-performer/domain";

type VariantConfig = {
  difficulty: ScenarioPack["difficulty"];
  persona: ScenarioPack["persona"];
  publicBrief: string;
  hiddenFacts: string[];
  openingLine: string;
};

const VARIANT_CONFIGS: Record<ScenarioVariant, VariantConfig> = {
  friendly_manager_easy: {
    difficulty: "easy",
    persona: {
      role: "現場責任者",
      companyAlias: "Company_A",
      demeanor: "cooperative",
      responseStyle: "丁寧で協力的。質問に対して前向きに応じる。",
    },
    publicBrief:
      "新規ライン立ち上げに向けて、派遣スタッフの採用を進めたい。現場目線では早めに動きたいが、情報は聞かれた範囲から順に伝える。",
    hiddenFacts: [
      "開始希望日は来月頭だが、実際は前倒しで今月末でも受け入れたい。",
      "現場責任者としては柔軟だが、最終承認は部門長が持っている。",
      "歓迎条件は広めに見たいが、必須条件は夜勤対応と立ち上がりスピード。",
    ],
    openingLine:
      "本日はありがとうございます。まず、今回お願いしたいポジションの相談からさせてください。",
  },
  busy_manager_medium: {
    difficulty: "medium",
    persona: {
      role: "物流センター責任者",
      companyAlias: "Company_B",
      demeanor: "busy",
      responseStyle: "要点だけを短く返す。聞かれない情報は広げない。",
    },
    publicBrief:
      "繁忙期前に人員確保を進めたい。会話時間は限られているため、論点が整理されている相手にだけ追加情報を出す。",
    hiddenFacts: [
      "表向きの開始時期よりも実際の充足期限のほうが厳しい。",
      "他社エージェントにも並行で相談しているが、まだ決め切れていない。",
      "時給上限は厳しめだが、開始を早められるなら少し相談余地がある。",
    ],
    openingLine:
      "時間があまり取れないので、要点だけ確認しながら進めてもらえると助かります。",
  },
  skeptical_manager_hard: {
    difficulty: "hard",
    persona: {
      role: "事業部マネージャー",
      companyAlias: "Company_C",
      demeanor: "skeptical",
      responseStyle: "慎重で少し距離がある。浅い質問には表面的にしか答えない。",
    },
    publicBrief:
      "過去に紹介品質で苦い経験があり、今回も派遣依頼は慎重に見極めたい。こちらから本音や制約はあまり先に出さない。",
    hiddenFacts: [
      "現場責任者ではなく、部門長承認と購買確認が必要な二段階決裁になっている。",
      "競合2社がすでに候補提案に動いており、比較の軸は立ち上がり速度と定着性。",
      "予算はタイトだが、欠員による現場影響が大きく、即戦力なら相談余地がある。",
    ],
    openingLine:
      "今日は状況共有をしつつ、こちらがどこまでお願いできそうかを見極めたいと思っています。",
  },
};

function buildRevealRules() {
  return [
    {
      trigger: "decision_maker を自然に確認されたら、実際の決裁構造を明かす",
      reveals: ["実際の決裁者", "承認ステップ数"],
    },
    {
      trigger: "competing_agencies を確認されたら、競合提案の存在を明かす",
      reveals: ["競合社数", "比較軸"],
    },
    {
      trigger: "urgency と start_date を両方押さえたら、本当の緊急度を明かす",
      reveals: ["本当の充足期限", "現場への影響度"],
    },
    {
      trigger: "budget_flexibility まで踏み込んだら、条件調整余地を明かす",
      reveals: ["時給の相談余地", "譲れない条件"],
    },
  ];
}

function buildKnowledgeBaseText(scenario: ScenarioPack) {
  return [
    `# Scenario`,
    `Title: ${scenario.title}`,
    `Difficulty: ${scenario.difficulty}`,
    `Persona: ${scenario.persona.role} / ${scenario.persona.companyAlias}`,
    "",
    "## Public Brief",
    scenario.publicBrief,
    "",
    "## Hidden Facts",
    ...scenario.hiddenFacts.map((fact) => `- ${fact}`),
    "",
    "## Reveal Rules",
    ...scenario.revealRules.map(
      (rule) => `- Trigger: ${rule.trigger} => ${rule.reveals.join(" / ")}`
    ),
    "",
    "## Must Capture Items",
    ...scenario.mustCaptureItems.map(
      (item) => `- [${item.priority}] ${item.label} (#${item.canonicalOrder})`
    ),
  ].join("\n");
}

function buildAgentPrompt(scenario: ScenarioPack) {
  return [
    "あなたは派遣営業のオーダーヒアリングに登場する顧客担当者です。",
    "あなたの役割は trainee を評価することではなく、自然な会話相手として振る舞うことです。",
    "",
    "# 役割",
    `- 役職: ${scenario.persona.role}`,
    `- 企業: ${scenario.persona.companyAlias}`,
    `- 態度: ${scenario.persona.demeanor}`,
    `- 口調: ${scenario.persona.responseStyle}`,
    "",
    "# 会話ルール",
    "- こちらから情報を全部並べない",
    "- trainee が適切に聞いた情報だけを明かす",
    "- 質問が浅い場合は浅く返す",
    "- 質問が深い場合は本音や制約も返す",
    "- trainee を直接コーチしない",
    "- 評価基準や hidden facts を自分から言わない",
    "- 会話を壊さず自然に受け答えする",
    "",
    "# 明かしてよい公開情報",
    scenario.publicBrief,
    "",
    "# hidden facts",
    ...scenario.hiddenFacts.map((fact) => `- ${fact}`),
    "",
    "# reveal rules",
    ...scenario.revealRules.map(
      (rule) => `- ${rule.trigger}: ${rule.reveals.join(" / ")}`
    ),
    "",
    "# NG",
    "- 採点者のように振る舞わない",
    "- 「この質問をしたほうがいい」と助言しない",
    "- 一問一答の箇条書きにならない",
  ].join("\n");
}

export function compileScenarios(playbook: PlaybookNorms): Array<{
  scenario: ScenarioPack;
  assets: CompiledScenarioAssets;
}> {
  const mustCaptureItems = [
    ...playbook.requiredItems.map((item) => ({
      key: item.key,
      label: item.label,
      priority: "required" as const,
      canonicalOrder: playbook.canonicalOrder.indexOf(item.key),
    })),
    ...playbook.recommendedItems.map((item) => ({
      key: item.key,
      label: item.label,
      priority: "recommended" as const,
      canonicalOrder: playbook.canonicalOrder.indexOf(item.key),
    })),
  ].sort((left, right) => left.canonicalOrder - right.canonicalOrder);

  return (Object.keys(VARIANT_CONFIGS) as ScenarioVariant[]).map((variant) => {
    const config = VARIANT_CONFIGS[variant];
    const scenarioId = DEFAULT_SCENARIO_IDS[variant];
    const scenario: ScenarioPack = {
      id: scenarioId,
      family: "staffing_order_hearing",
      version: `${playbook.version}_${variant}_v1`,
      title: SCENARIO_VARIANT_TITLES[variant],
      language: "ja",
      difficulty: config.difficulty,
      persona: config.persona,
      publicBrief: config.publicBrief,
      hiddenFacts: config.hiddenFacts,
      revealRules: buildRevealRules(),
      mustCaptureItems,
      rubric: [...DEFAULT_RUBRIC_WEIGHTS],
      closeCriteria: [
        "必要確認事項を整理して要約している",
        "次回提案または社内確認のアクションが合意されている",
      ],
      openingLine: config.openingLine,
      generatedFromPlaybookVersion: playbook.version,
      status: "draft",
    };

    const assets: CompiledScenarioAssets = {
      scenarioId,
      promptVersion: COMPILE_SCENARIO_PROMPT_VERSION,
      knowledgeBaseText: buildKnowledgeBaseText(scenario),
      agentSystemPrompt: buildAgentPrompt(scenario),
      generatedAt: new Date().toISOString(),
    };

    return { scenario, assets };
  });
}
