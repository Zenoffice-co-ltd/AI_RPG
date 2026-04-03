# Prompt Assets

## Files

- [extract-behaviors.md](/C:/AI_RPG/packages/scoring/src/prompts/extract-behaviors.md)
- [aggregate-playbook.md](/C:/AI_RPG/packages/scoring/src/prompts/aggregate-playbook.md)
- [compile-scenario.md](/C:/AI_RPG/packages/scoring/src/prompts/compile-scenario.md)
- [grade-session.md](/C:/AI_RPG/packages/scoring/src/prompts/grade-session.md)

## Current Versions

- `PLAYBOOK_PROMPT_VERSION = extract-behaviors@2026-04-02.v1`
- `AGGREGATE_PLAYBOOK_PROMPT_VERSION = aggregate-playbook@2026-04-02.v1`
- `COMPILE_SCENARIO_PROMPT_VERSION = compile-scenario@2026-04-02.v1`
- `GRADE_SESSION_PROMPT_VERSION = grade-session@2026-04-02.v1`

## Coupling Rules

- transcript mining uses `TranscriptBehaviorExtraction`
- grading uses `Scorecard`
- JSON schema is generated from zod and passed to OpenAI Responses API with `strict: true`
- `Scorecard.promptVersion` is stored with every analysis result
