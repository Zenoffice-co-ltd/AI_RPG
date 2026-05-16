import { stdin, stdout } from "node:process";

const readStdin = async () => {
  let input = "";
  for await (const chunk of stdin) {
    input += chunk;
  }
  return input.trim();
};

const main = async () => {
  const raw = await readStdin();
  if (!raw) {
    return;
  }

  const payload = JSON.parse(raw);
  const prompt = typeof payload?.prompt === "string" ? payload.prompt.toLowerCase() : "";
  if (!prompt) {
    return;
  }

  const suggestions = [];
  const isBrowserEvaluationPrompt =
    /(browser evaluation|評価画面|評価結果|改善アクション|next training actions|scorecard|model_raw_output|adecco_browser_eval|v50-7.*result|v51.*result|grok-first-v51|adecco-roleplay-v51|customer criteria|評価基準v2|must_capture_groups|sales_compliance_flags|modality_limitations|result page|ブラウザで.*評価)/.test(
      prompt,
    );

  if (/(accounting|phase 3|phase 4|transcript|playbook|scenario compile|must-capture|enterprise ap)/.test(prompt)) {
    suggestions.push(
      "For accounting pipeline work, prefer the repo skill `.agents/skills/ai-rpg-accounting-phase34/SKILL.md` and preserve the corpus SoT versus acceptance-reference split.",
    );
  }

  if (isBrowserEvaluationPrompt) {
    suggestions.push(
      "For v50/v51 Adecco browser evaluation result pages and scoring result APIs, prefer `.agents/skills/ai-rpg-v50-browser-evaluation/SKILL.md`. Keep scoring separate from Gmail delivery, treat the shared Adecco scoring bundle as customer-criteria v2 unless an explicit evaluationProfile split exists, use the mock result route for browser-use confirmation, and avoid production Gmail smoke unless explicitly requested.",
    );
  }

  if (!isBrowserEvaluationPrompt && /(acceptance|release|publish readiness|smoke|e2e|scorecard|verify:acceptance)/.test(prompt)) {
    suggestions.push(
      "For release and evidence work, prefer `.agents/skills/ai-rpg-acceptance-verification/SKILL.md` and end on the canonical acceptance gate when feasible.",
    );
  }

  if (/(deploy|app hosting|cloud run|relay|production e2e|cloud logging|iam|secret manager|セッションの開始に失敗|回答がない|無応答|レイテンシ)/.test(prompt)) {
    suggestions.push(
      "For production deploy, relay, and Cloud Logging diagnosis, follow AGENTS.md's shortest diagnostic ladder and prefer `.agents/skills/ai-rpg-adecco-roleplay-ab-backends/SKILL.md` plus `.agents/skills/ai-rpg-acceptance-verification/SKILL.md` before redeploying.",
    );
  }

  if (!isBrowserEvaluationPrompt && /(v50|grok-first|fixed guard|guard smoke|assistant-only drain|drain|guard e2e|excel test plan|spreadsheet.*dod)/.test(prompt)) {
    suggestions.push(
      "For Grok-first v50 fixed guard verification, prefer `.agents/skills/ai-rpg-grok-first-v50-guard-verification/SKILL.md`; map the requested case-set denominator to an executable runner before running long E2E.",
    );
  }
  if (/(elevenlabs|voice|pronunciation|dictionary locator|scenario-map|shared voice)/.test(prompt)) {
    suggestions.push(
      "For voice-profile work, prefer `.agents/skills/ai-rpg-repo-elevenlabs-voice/SKILL.md` and treat dictionary readiness as part of publish readiness.",
    );
  }

  if (suggestions.length === 0) {
    return;
  }

  stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: suggestions.join(" "),
      },
    }),
  );
};

await main();
