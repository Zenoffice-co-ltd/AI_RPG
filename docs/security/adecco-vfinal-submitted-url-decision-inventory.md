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

- 2026-05-17 01:35 JST browser start smoke passed against the hosted.app
  candidate: invite consume 307, session 200, relay WSS only, direct
  `api.x.ai` count 0, and forbidden session keys absent.
- 2026-05-17 02:09 JST HEAD request returned HTTP 200 for the hosted.app
  candidate page.
- 2026-05-17 03:26 JST HEAD request returned HTTP 200 for the hosted.app
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
result for both candidates. 2026-05-17 03:26 JST recheck:

- `Resolve-DnsName roleplay-vfinal.mendan.biz` returned no result.
- `Resolve-DnsName adecco-roleplay.mendan.biz` returned no result.
- `curl -I https://roleplay-vfinal.mendan.biz/demo/adecco-roleplay-vFinal`
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
   vFinal customer-submitted URL.
2. A dedicated vFinal `mendan.biz` custom domain is mapped to the
   `adecco-roleplay-vfinal` backend, DNS/certificate status is active, and a
   submitted-URL smoke confirms session 200, relay WSS only, direct
   `api.x.ai` count 0, and forbidden session keys absent.

If #138 is left OPEN and resolved by approval/evidence comment rather than
issue closure, the final guard accepts either the dedicated hosted.app approval
text or the dedicated `mendan.biz` custom-domain approval text in
`docs/security/adecco-vfinal-approval-packet.md`. The custom-domain approval
text must include DNS/certificate active status plus submitted-URL smoke
evidence; DNS/certificate approval alone is not enough. The approval comment
must include the exact submitted URL, and any `<placeholder>` text from the
approval packet must be replaced before the guard will accept it.

Until then, the customer submission DoD and security-checksheet submission DoD
must remain BLOCKED for #138.
