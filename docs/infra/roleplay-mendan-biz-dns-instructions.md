# DNS Instructions: roleplay.mendan.biz App Hosting Custom Domain

## Status

`roleplay.mendan.biz` has been added as a Firebase App Hosting custom domain for:

```text
projects/adecco-mendan/locations/asia-east1/backends/adecco-roleplay
```

Firebase App Hosting is waiting for DNS records at the authoritative
`dnsv.jp` nameservers. GCP Cloud DNS has no managed zone for `mendan.biz`.

## Required DNS Records

Add the following records in the external DNS console for `mendan.biz`.

| Type | Host / Name | Value | Required action |
|---|---|---|---|
| A | `roleplay` or `roleplay.mendan.biz` | `35.219.200.61` | ADD |
| TXT | `roleplay` or `roleplay.mendan.biz` | `fah-claim=004-02-0d7d9b03-49a5-46a4-8022-c8a78efcafad` | ADD |
| CNAME | `_acme-challenge_7o5w5quluuyscfoe.roleplay` or `_acme-challenge_7o5w5quluuyscfoe.roleplay.mendan.biz` | `124e1455-6a0a-4ced-b50e-b104807eb7d1.16.authorize.certificatemanager.goog.` | ADD |

Do not remove or change the existing `voice.mendan.biz` A record.

## Verification Commands

```powershell
Resolve-DnsName roleplay.mendan.biz A
Resolve-DnsName roleplay.mendan.biz TXT
Resolve-DnsName _acme-challenge_7o5w5quluuyscfoe.roleplay.mendan.biz CNAME
curl.exe -I --max-time 20 https://roleplay.mendan.biz/demo/adecco-roleplay-v25
```

Expected after propagation and certificate issuance:

```text
roleplay.mendan.biz A 35.219.200.61
roleplay.mendan.biz TXT fah-claim=004-02-0d7d9b03-49a5-46a4-8022-c8a78efcafad
_acme-challenge_7o5w5quluuyscfoe.roleplay.mendan.biz CNAME 124e1455-6a0a-4ced-b50e-b104807eb7d1.16.authorize.certificatemanager.goog.
HTTPS page load succeeds
```

Firebase App Hosting can take several hours, and in some cases up to 24 hours,
to provision the managed certificate after DNS is correct.
