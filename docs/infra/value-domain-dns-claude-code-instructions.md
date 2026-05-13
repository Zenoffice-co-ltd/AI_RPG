# Claude Code DNS 作業指示書: `voice.mendan.biz` Aレコード追加

## 目的

`adecco-roleplay-v25` の xAI Realtime Cloud Run relay をブラウザから利用できるようにする。

現状、Cloud Run relay と Google Cloud Load Balancer は作成済みだが、`voice.mendan.biz` のDNSが未設定のため、ブラウザE2Eで以下の失敗になっている。

```text
WebSocket connection to 'wss://voice.mendan.biz/api/v3/realtime-relay' failed:
net::ERR_NAME_NOT_RESOLVED
```

## 追加するDNSレコード

Value Domain / dnsv.jp 側で、`mendan.biz` のDNS設定に以下を追加する。

```text
host: voice
type: A
value: 34.149.106.144
ttl: default
```

FQDN表記:

```text
voice.mendan.biz.  A  34.149.106.144
```

## 絶対に変更しないもの

- `mendan.biz` root の既存A/CNAME/MX/TXT
- `www.mendan.biz`
- MX / SPF / DKIM / DMARC
- 既存MENDANサイトのDNS設定
- `api.x.ai` 関連のDNS
- Cloud Run / Load Balancer / Secret Manager の設定

今回必要なのは `voice` サブドメインのAレコード追加のみ。

## 背景情報

GCP側は作成済み。

```text
Project: adecco-mendan
Cloud Run service: xai-realtime-relay
Region: us-east1
Public relay host: voice.mendan.biz
Relay path: /api/v3/realtime-relay
Load Balancer frontend IPv4: 34.149.106.144
Managed cert: voice-mendan-biz-cert
```

現在のブロッカー:

```text
Resolve-DnsName voice.mendan.biz -> 未解決
Google-managed certificate -> FAILED_NOT_VISIBLE
Cloud Run relay logs -> server.listening のみ、client.connected なし
```

## Value Domain UIでの作業

1. Chromeでログインする。

   ```text
   https://www.value-domain.com/login.php
   ```

2. `mendan.biz` のDNS設定画面へ移動する。

   画面表記は環境差があるため、以下に近い導線を探す。

   ```text
   ドメイン
   -> ドメインの設定操作
   -> mendan.biz
   -> DNS / DNSレコード / DNS設定
   ```

3. 既存レコードを確認する。

   `voice` または `voice.mendan.biz` の既存レコードがある場合:

   - 既に `A 34.149.106.144` なら変更不要。
   - CNAMEや別IPが入っている場合は、上書き前にユーザーへ確認する。

4. `voice` のAレコードを追加する。

   ```text
   host/name: voice
   type: A
   value/content/address: 34.149.106.144
   ttl: default
   ```

5. 保存/反映する。

   確認画面が出た場合、変更対象が `voice.mendan.biz A 34.149.106.144` のみであることを確認して実行する。

## 反映確認

ローカルで以下を実行する。

```powershell
Resolve-DnsName voice.mendan.biz
```

期待値:

```text
Name       : voice.mendan.biz
Type       : A
IP4Address : 34.149.106.144
```

curl確認:

```powershell
curl.exe -I --max-time 20 https://voice.mendan.biz/healthz
```

証明書反映前はTLSエラーになる場合がある。DNSが見え始めてからGoogle-managed certificateが有効化されるまで数分から数十分待つ。

証明書状態確認:

```powershell
gcloud compute ssl-certificates describe voice-mendan-biz-cert `
  --project=adecco-mendan `
  --global `
  --format="yaml(managed.status,managed.domainStatus,expireTime)"
```

期待値:

```text
managed:
  status: ACTIVE
  domainStatus:
    voice.mendan.biz: ACTIVE
```

`ACTIVE` 後のhealthz期待値:

```powershell
curl.exe -i --max-time 20 https://voice.mendan.biz/healthz
```

```text
HTTP/2 200
{"ok":true}
```

## v25 E2E再実行

DNSと証明書が有効化されたら、repo rootで実行する。

```powershell
$env:GROK_BROWSER_E2E_BASE_URL="https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app"
$env:GROK_BROWSER_E2E_VARIANTS="adecco-roleplay-v25"
corepack pnpm grok:audio-e2e:browser:text
```

期待値:

```text
PASS
greeting.playback.completed
turn.completed
websocketUrls includes wss://voice.mendan.biz/api/v3/realtime-relay
websocketUrls does NOT include wss://api.x.ai
no WebSocket handshake 403
no ws.error code 1006
```

## Cloud Logging確認

E2E実行後、Cloud Run relay logsを確認する。

```powershell
gcloud logging read `
  'resource.type="cloud_run_revision" AND resource.labels.service_name="xai-realtime-relay" AND jsonPayload.scope="grokVoice.realtimeRelay"' `
  --project=adecco-mendan `
  --limit=80 `
  --format='table(timestamp,jsonPayload.phase,jsonPayload.demoSlug,jsonPayload.transport,jsonPayload.origin,jsonPayload.host)'
```

必須phase:

```text
client.connected
ticket.accepted
upstream.connected
```

望ましいphase:

```text
first.upstream.audio.delta
```

禁止/失敗シグナル:

```text
ticket.rejected
relay.error
browser WebSocket handshake 403
browser ws.error code 1006
```

## セキュリティ確認

DNS作業では秘密情報を扱わない。

relay運用上の前提:

```text
XAI_API_KEY: Secret Manager
XAI_RELAY_TICKET_SECRET: Secret Manager
Browser -> voice.mendan.biz: relay ticket only
Browser -> api.x.ai: direct connectionなし
```

ログに出してはいけないもの:

```text
XAI_API_KEY
XAI_RELAY_TICKET_SECRET
ticket
Sec-WebSocket-Protocol raw value
audio frame
base64 audio
transcript text
user text
assistant text
instructions
prompt
```

## 完了報告に含めること

作業後、以下を報告する。

```text
1. Value Domainで追加/確認したDNSレコード
2. Resolve-DnsName voice.mendan.biz の結果
3. managed certificate status
4. https://voice.mendan.biz/healthz の結果
5. v25 browser E2E結果
6. Cloud Loggingで確認したrelay phase
```

## トラブルシュート

### DNSが見えない

`dnsv.jp` 側の反映待ち。数分おいて再確認する。

```powershell
Resolve-DnsName voice.mendan.biz
```

### 証明書が `FAILED_NOT_VISIBLE`

DNSがGoogle LBのIPへ向いていない、または反映前。

```text
voice.mendan.biz A 34.149.106.144
```

を再確認する。

### healthzが404/SSL error

- DNSがLB IPに向いているか確認する。
- managed certが `ACTIVE` か確認する。
- LB backendにserverless NEGが接続されているか確認する。

backend確認:

```powershell
gcloud compute backend-services describe xai-realtime-relay-backend `
  --project=adecco-mendan `
  --global `
  --format="yaml(backends,enableCDN,loadBalancingScheme,protocol,timeoutSec)"
```

期待値:

```text
enableCDN: false
loadBalancingScheme: EXTERNAL_MANAGED
protocol: HTTP
backends:
  - group: .../regions/us-east1/networkEndpointGroups/xai-realtime-relay-neg
```
