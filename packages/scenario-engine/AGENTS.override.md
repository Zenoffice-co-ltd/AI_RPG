# Scenario Engine Override

## Accounting Pipeline Rules

- Preserve the v2 path shape: `xlsx -> source registry -> canonical transcript -> derived artifacts -> norms -> scenario pack -> local eval -> publish`.
- For accounting work, transcript corpus is the only Source of Truth. Acceptance JSON and analysis docs are references, not storage SoT.
- Keep semantic acceptance, not exact-text acceptance, when comparing compiled output against the accounting reference JSON.
- Preserve the redaction split: proper nouns and direct identifiers are redacted, while abstracted scenario metadata such as `industry`, `companyScale`, `businessContext`, and `systemContext` remains available.
- Do not promote Silver data into Gold-backed norms unless the code path explicitly allows it.

## Verification

- If you change compile, eval, or publish contracts, update the relevant script entrypoints and tests in the same change.
- If you change accounting compile or eval logic, verify the path with the narrowest root script that proves the contract, then run broader acceptance when the task reaches release readiness.
