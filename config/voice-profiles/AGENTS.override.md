# Voice Profile Override

## Publish Readiness Rules

- An approved voice is not publish-ready until `pronunciationDictionaryLocators` is configured where required.
- Keep profile JSON and `scenario-map.json` aligned in the same change when the active mapping changes.
- Prefer a stable baseline profile when a workspace or environment lacks the entitlement for a newer model tier.
- Keep scenario IDs stable. Change the mapping or profile payload before introducing a new profile ID.

## Verification

- When you change active voice mapping, verify the publish path and any affected smoke or acceptance checks.
- Treat missing dictionary locators, missing shared voice promotion, or entitlement mismatches as fail-closed blockers.
