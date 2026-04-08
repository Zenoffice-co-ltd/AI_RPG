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

  if (/(accounting|phase 3|phase 4|transcript|playbook|scenario compile|must-capture|enterprise ap)/.test(prompt)) {
    suggestions.push(
      "For accounting pipeline work, prefer the repo skill `.agents/skills/ai-rpg-accounting-phase34/SKILL.md` and preserve the corpus SoT versus acceptance-reference split.",
    );
  }

  if (/(acceptance|release|publish readiness|smoke|e2e|scorecard|verify:acceptance)/.test(prompt)) {
    suggestions.push(
      "For release and evidence work, prefer `.agents/skills/ai-rpg-acceptance-verification/SKILL.md` and end on the canonical acceptance gate when feasible.",
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
