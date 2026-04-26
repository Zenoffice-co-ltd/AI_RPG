# Manual Orb v4 — Phase 2C+D Operator Handoff

## Why this is a handoff (not auto-executed)

Phase 2C requires uploading a NEW pronunciation dictionary version to the ElevenLabs workspace. This is an **irreversible side effect on shared infrastructure** (the dictionary persists in the Adecco ElevenLabs account, consumes a slot, and may be referenced by other agents). The agent that produced this handoff (manual-orb-v4 implementation session) chose to defer the upload to operator action rather than create a new ElevenLabs resource autonomously.

Phase 2D (DoD 3 voice mirror test loosening) is **already done** in [packages/scenario-engine/src/voiceProfiles.test.ts](../../packages/scenario-engine/src/voiceProfiles.test.ts) (the test now permits per-profile locator divergence and asserts a documented rationale in `metadata.notes` when divergence exists). Until Phase 2C runs, the test still passes because both profiles point to the original locator (`0GxlLMOqlBr3dvEhX6Ji` / `GGzWcurA2ogrgciNu7u5`).

## Current state at handoff

- Local PLS dictionary [data/pronunciation/adecco-ja-business-v1.pls](../pronunciation/adecco-ja-business-v1.pls) updated with three Adecco brand-name lexemes (`Adecco`, `ADECCO`, `adecco` → `アデコ`).
- The dictionary's existing remote version is **not yet aware of the new lexemes** — only `Adecco → アデコ` was already there; uppercase/lowercase variants are missing remotely.
- Adecco staffing voice profile [config/voice-profiles/staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v1.json](../../config/voice-profiles/staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v1.json) still points to the old locator (`pronunciationDictionaryId=0GxlLMOqlBr3dvEhX6Ji`, `versionId=GGzWcurA2ogrgciNu7u5`).

## What Phase 2C achieves (if executed)

1. Adecco-only pronunciation dictionary on ElevenLabs that includes all three casing variants and any future Adecco-specific lexemes.
2. Adecco voice profile pointing at the new dictionary; accounting voice profile unchanged.
3. Live orb correctly reads `Adecco`/`ADECCO`/`adecco` as **アデコ** even when the prompt source happens to leak the English form.

## What Phase 2C does NOT achieve

The live orb still relies primarily on prompt source for naturalness (the manual-orb-v4 Phase 1 work). The dictionary is a **defense-in-depth** layer — it catches stray English `Adecco` mentions that slip past prompt source (e.g., user-spoken英字, or a prompt update that forgets to use カナ). It is NOT a substitute for the Phase 1 source rewrites.

## Operator runbook

### Step 1 — Verify ElevenLabs API access

```bash
# Confirm secrets are loaded (should not error)
pnpm tsx -e "import('./apps/web/server/appContext').then(({ getAppContext }) => { const c = getAppContext(); console.log('ok:', !!c.vendors.elevenLabs); })"
```

### Step 2 — Upload new dictionary version

```bash
pnpm tsx scripts/elevenlabs/upload-pronunciation-dictionary.ts \
  --file ./data/pronunciation/adecco-ja-business-v1.pls \
  --name "adecco-ja-business-v2-manual-orb-v4" \
  --description "Manual orb v4 (2026-04-26): adds ADECCO/adecco casing variants for アデコ pronunciation. Adecco staffing scenario only — do NOT bind to accounting profiles."
```

Expected output:
```json
{
  "reused": false,
  "id": "<NEW_PRONUNCIATION_DICTIONARY_ID>",
  "name": "adecco-ja-business-v2-manual-orb-v4",
  "versionId": "<NEW_VERSION_ID>",
  "description": "Manual orb v4 ..."
}
```

If the output shows `"reused": true`, a dictionary with this name already exists — pick a different `--name` (e.g., append today's date suffix).

### Step 3 — Update the Adecco voice profile JSON

Edit [config/voice-profiles/staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v1.json](../../config/voice-profiles/staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v1.json):

```json
"pronunciationDictionaryLocators": [
  {
    "pronunciationDictionaryId": "<NEW_PRONUNCIATION_DICTIONARY_ID>",
    "versionId": "<NEW_VERSION_ID>"
  }
],
"metadata": {
  "sourceVoiceProfileId": "accounting_clerk_enterprise_ap_ja_v3_candidate_v1",
  "voiceReuseReason": "Use the same published accounting roleplay voice per product requirement.",
  "notes": "VoiceId / model / voiceSettings / textNormalisationType remain mirrored from accounting_clerk_enterprise_ap_ja_v3_candidate_v1. pronunciationDictionaryLocators diverges per Phase 2C (manual orb v4 2026-04-26): Adecco scenario uses adecco-ja-business-v2-manual-orb-v4 with ADECCO/adecco casing variants for アデコ pronunciation. Accounting profile is unchanged.",
  "scenarioIds": ["staffing_order_hearing_adecco_manufacturer_busy_manager_medium"]
}
```

The DoD 3 mirror test ([packages/scenario-engine/src/voiceProfiles.test.ts](../../packages/scenario-engine/src/voiceProfiles.test.ts)) already permits this divergence and asserts that `metadata.notes` mentions `Adecco|アデコ` when the locator diverges. Both conditions are satisfied above.

### Step 4 — Verify

```bash
pnpm typecheck
pnpm test
pnpm compile:scenarios -- --family staffing_order_hearing --reference ./docs/references/adecco_manufacturer_order_hearing_reference.json
pnpm publish:scenario -- --scenario staffing_order_hearing_adecco_manufacturer_busy_manager_medium
pnpm smoke:eleven
```

The publish snapshot under `data/generated/publish/staffing_order_hearing_adecco_manufacturer_busy_manager_medium.json` should now show:

```json
"voiceSelection": {
  "voiceProfileId": "staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v1",
  "voiceId": "g6xIsTj2HwM6VR4iXFCw",
  "ttsModel": "eleven_v3",
  "textNormalisationType": "elevenlabs",
  "pronunciationDictionaryLocators": [
    {
      "pronunciationDictionaryId": "<NEW_PRONUNCIATION_DICTIONARY_ID>",
      "versionId": "<NEW_VERSION_ID>"
    }
  ]
}
```

### Step 5 — Manual orb re-verification

Open `https://elevenlabs.io/app/talk-to?agent_id=agent_2801kpj49tj1f43sr840cvy17zcc` and confirm:

- Test 6 closing turn: agent says **アデコさん** (not アデッコさん)
- Test 4 Q3 volume reply: 月末と月の初め / 月曜日の午前中 / 取り扱い商品が切り替わる時期 (natural form)
- Test 5 Q3 decision reply: 候補者が現場に合うかどうかの最終判断 (natural form)
- All other manual orb v3 P0s remain non-recurring.

## Rollback

If Phase 2C causes any regression, revert by editing the Adecco voice profile JSON back to the original locator (`0GxlLMOqlBr3dvEhX6Ji` / `GGzWcurA2ogrgciNu7u5`) and re-running publish:scenario. The new ElevenLabs dictionary persists in the workspace but is unreferenced — safe to delete via the ElevenLabs UI when convenient.

## Phase 2 retrospective

- **Phase 2A** (`normalizeJaTextForTts` Adecco extension): completed in this session. Affects benchmark / audio preview only — not live orb.
- **Phase 2B** (PLS local update): completed in this session. Three Adecco brand-name lexemes added.
- **Phase 2C** (remote dictionary upload + voice profile update): handoff (this document).
- **Phase 2D** (DoD 3 mirror test loosening): completed in this session. Test now permits per-profile dictionary divergence with documented rationale.
