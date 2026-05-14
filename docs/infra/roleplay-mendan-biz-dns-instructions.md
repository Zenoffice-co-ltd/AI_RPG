# DNS Instructions: roleplay.mendan.biz App Hosting Custom Domain

## Status

`roleplay.mendan.biz` has been added as a Firebase App Hosting custom domain for:

```text
projects/adecco-mendan/locations/asia-east1/backends/adecco-roleplay
```

DNS records have been applied at the authoritative `dnsv.jp` nameservers and
Firebase App Hosting has reached `HOST_ACTIVE`, `OWNERSHIP_ACTIVE`, and
`CERT_ACTIVE`. GCP Cloud DNS has no managed zone for `mendan.biz`.

Current access check:

- No Cloud DNS managed zone for `mendan.biz` exists in `adecco-mendan` or
  `zapier-transfer`.
- No Value Domain / dnsv.jp DNS API credential was found in the checked Google
  Secret Manager projects.
- DNS was applied by the DNS operator through Value Domain / `dnsv.jp`.

## Required DNS Records

The following records are present in the external DNS console for `mendan.biz`.

| Type | Host / Name | Value | Required action |
|---|---|---|---|
| A | `roleplay` or `roleplay.mendan.biz` | `35.219.200.61` | PRESENT |
| TXT | `roleplay` or `roleplay.mendan.biz` | `fah-claim=004-02-0d7d9b03-49a5-46a4-8022-c8a78efcafad` | PRESENT |
| CNAME | `_acme-challenge_7o5w5quluuyscfoe.roleplay` or `_acme-challenge_7o5w5quluuyscfoe.roleplay.mendan.biz` | `124e1455-6a0a-4ced-b50e-b104807eb7d1.16.authorize.certificatemanager.goog.` | PRESENT |

Do not remove or change the existing `voice.mendan.biz` A record.

## API Caution

Value Domain's official API documentation is:

```text
https://www.value-domain.com/api/doc/domain/
```

The DNS API supports `GET /domains/{domain}/dns` and
`PUT /domains/{domain}/dns`. The `PUT` request sends the full DNS record text,
not a single-record patch. If an API credential is supplied later, first fetch
the existing `mendan.biz` DNS records, append only the three records above, and
preserve all existing root, `www`, MX, SPF, DKIM, DMARC, and `voice` records.
Do not issue a blind overwrite.

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
