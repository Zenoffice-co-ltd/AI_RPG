# Adecco vFinal Submitted URL Decision Inventory

Status as of 2026-05-17 JST: **submitted URL approval or custom domain mapping still required**.

This note supports issue #138. It does not change the customer submission DoD
verdict. Current evidence proves the dedicated Firebase hosted.app backend is
live and separated from the legacy shared backend, but it does not by itself
approve that URL for customer submission.

## Current Submitted URL Candidate

Dedicated hosted.app candidate:

```text
https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app/demo/adecco-roleplay-vFinal
```

Read-only evidence:

- 2026-05-17 07:35 JST submitted URL candidate and hosted.app start smoke
  refresh:
  - `corepack pnpm grok:vfinal-submitted-url-candidates -- --expect=blocked`
    passed for expected BLOCKED. The dedicated hosted.app candidate returned
    HTTP 200; `roleplay-vfinal.mendan.biz` and `adecco-roleplay.mendan.biz`
    did not return HTTP success; active custom-domain candidate count was 0.
  - `corepack pnpm grok:first-vfinal:browser-e2e -- --mode start --origin
    https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app --out
    out/grok_first_vfinal_browser_e2e/2026-05-17T07-35-00-hosted-url-start-recheck`
    passed.
  - Start smoke result: session 200, `sessionApiMs=90`,
    `wsUrl=wss://voice.mendan.biz/api/v3/realtime-relay`, browser WebSocket
    URL only the relay WSS, direct `api.x.ai` count 0, and forbidden session
    keys absent.
  - This refresh keeps the hosted.app approval path viable. It does not approve
    hosted.app as the submitted customer URL and does not create or activate a
    dedicated `mendan.biz` custom-domain mapping.
- 2026-05-17 06:28 JST issue-state recheck: #138 had been closed, but no
  comment contained the required exact hosted.app submitted-URL approval with
  smoke evidence, and no dedicated `mendan.biz` active DNS/certificate +
  submitted-URL smoke evidence was present. The issue was reopened to avoid
  treating issue closure as approval. The valid resolution paths below remain
  unchanged.
- 2026-05-17 05:43 JST submitted URL candidate guard passed for expected
  BLOCKED state:
  `corepack pnpm grok:vfinal-submitted-url-candidates -- --expect=blocked`.
  The dedicated hosted.app candidate returned HTTP 200. The two dedicated
  `mendan.biz` candidates did not return HTTP success, so no active custom
  domain candidate was found. The Node DNS diagnostic for hosted.app returned
  resolver errors in this environment even though HTTP succeeded; DNS details
  are recorded as diagnostic only by the helper.
- 2026-05-17 05:04 JST browser start smoke passed against the hosted.app
  candidate: invite consume 307, session 200, `wsUrl`
  `wss://voice.mendan.biz/api/v3/realtime-relay`, browser WebSocket URL only
  the relay WSS, direct `api.x.ai` count 0, and forbidden session keys absent.
  Evidence directory:
  `out/grok_first_vfinal_browser_e2e/2026-05-16T20-03-58-582Z/`.
- 2026-05-17 04:29 JST browser start smoke passed against the hosted.app
  candidate: session 200, `wsUrl`
  `wss://voice.mendan.biz/api/v3/realtime-relay`, browser WebSocket URL only
  the relay WSS, direct `api.x.ai` count 0, and forbidden session keys absent.
  Evidence directory:
  `out/grok_first_vfinal_browser_e2e/2026-05-16T19-29-24-165Z/`.
- 2026-05-17 01:35 JST browser start smoke passed against the hosted.app
  candidate: invite consume 307, session 200, relay WSS only, direct
  `api.x.ai` count 0, and forbidden session keys absent.
- 2026-05-17 02:09 JST HEAD request returned HTTP 200 for the hosted.app
  candidate page.
- 2026-05-17 03:26 JST HEAD request returned HTTP 200 for the hosted.app
  candidate page.
- 2026-05-17 04:16 JST HEAD request returned HTTP 200 for the hosted.app
  candidate page.
- DNS resolution in this environment returned A/AAAA records for
  `adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app`.

## Dedicated Custom Domain Candidates

Dedicated `mendan.biz` candidates checked for #138:

```text
roleplay-vfinal.mendan.biz
adecco-roleplay.mendan.biz
```

Latest read-only checks in this environment still returned no DNS resolver
result for both candidates. 2026-05-17 04:29 JST recheck:

- `Resolve-DnsName roleplay-vfinal.mendan.biz` returned no result.
- `Resolve-DnsName adecco-roleplay.mendan.biz` returned no result.
- `curl -I https://roleplay-vfinal.mendan.biz/demo/adecco-roleplay-vFinal`
  failed with host resolution error.
- `curl -I https://adecco-roleplay.mendan.biz/demo/adecco-roleplay-vFinal`
  failed with host resolution error.

That means there is no verified active dedicated custom-domain
mapping/certificate evidence for the submitted vFinal backend.

## Legacy Shared URL

The existing shared URL is retained for internal comparison continuity:

```text
https://roleplay.mendan.biz/demo/adecco-roleplay-vFinal
```

This is not the strict submitted no-key runtime unless the customer/operator
explicitly scopes it differently. The strict no-key submitted runtime evidence
belongs to the dedicated `adecco-roleplay-vfinal` App Hosting backend.

## Valid Resolution Paths

Issue #138 remains blocked until one of these is true:

1. A customer/operator explicitly approves the dedicated hosted.app URL as the
   vFinal customer-submitted URL with the existing submitted-URL smoke evidence:
   invite consume 307, session 200, `wsUrl`
   `wss://voice.mendan.biz/api/v3/realtime-relay`, direct `api.x.ai` count 0,
   and forbidden session keys absent.
2. A dedicated vFinal `mendan.biz` custom domain is mapped to the
   `adecco-roleplay-vfinal` backend, DNS/certificate status is active, and a
   submitted-URL smoke confirms invite consume 307, session 200, `wsUrl`
   `wss://voice.mendan.biz/api/v3/realtime-relay`, direct `api.x.ai` count 0,
   and forbidden session keys absent.

If #138 is left OPEN and resolved by approval/evidence comment rather than
issue closure, the final guard accepts either the dedicated hosted.app approval
text or the dedicated `mendan.biz` custom-domain approval text in
`docs/security/adecco-vfinal-approval-packet.md`. Both approval paths must
include submitted-URL smoke evidence; the custom-domain approval text must also
include DNS/certificate active status. DNS/certificate approval alone is not
enough for a custom-domain path. The approval comment
must include the exact submitted URL, and any `<placeholder>` text from the
approval packet must be replaced before the guard will accept it.

Read-only candidate precheck:

```bash
corepack pnpm grok:vfinal-submitted-url-candidates -- --expect=blocked
```

Until then, the customer submission DoD and security-checksheet submission DoD
must remain BLOCKED for #138.
