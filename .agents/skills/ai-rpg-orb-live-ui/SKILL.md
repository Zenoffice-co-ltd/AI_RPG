---
name: ai-rpg-orb-live-ui
description: Use when changing or verifying the Adecco Orb roleplay web UI in apps/web, especially live/mock/visualTest/fakeLive conversation behavior, transcript rendering, SDK event handling, mute/session lifecycle, visual snapshots, or docs/qa.md live smoke evidence.
---

# AI RPG Orb Live UI

Use this skill for the customer-facing Orb roleplay UI under `apps/web`.

## Canonical Files

- `apps/web/app/demo/adecco-roleplay/page.tsx`
- `apps/web/app/demo/adecco-roleplay/access/route.ts`
- `apps/web/app/demo/adecco-orb/page.tsx`
- `apps/web/components/roleplay/*`
- `apps/web/lib/roleplay/*`
- `apps/web/tests/e2e/app.spec.ts`
- `apps/web/tests/visual/adecco-orb.visual.spec.ts`
- `docs/qa.md`

Canonical customer route is `/demo/adecco-roleplay`. Keep `/demo/adecco-orb`
as a backwards-compatible redirect that preserves query parameters.

## Mode Contract

- `live`: initial `messages=[]`; never seed fixed transcript text.
- `mock`: fixed transcript is allowed and must not contact the external voice service.
- `visualTest`: deterministic fixed UI only; freeze animation/scroll/status and keep snapshots stable.
- `fakeLive`: initial `messages=[]`; inject fake adapter events through the same normalize/reducer/MessageList path used by live.

Do not implement `fakeLive` as another static mock. Its purpose is to prove event-driven rendering without external network or microphone dependencies.

## Conversation Architecture

- Keep all SDK operations inside `useRoleplayConversation`.
- Do not call `startSession`, `sendUserMessage`, `endSession`, or `setMuted` directly from UI components.
- Route inbound conversation events through:
  `SDK/fake event -> normalizeConversationEvent -> transcriptReducer -> MessageList`.
- Use only callback names present in `node_modules/@elevenlabs/react` type definitions.
- Keep user-visible errors generic and Japanese; do not expose provider names, IDs, tokens, or upstream URLs.
- Agent text can arrive from multiple SDK paths (`agent_response`,
  `agent_chat_response_part`, `agent_response_correction`, `audioAlignment`, and
  delayed disconnect/end flush). Dedupe by normalized text as well as SDK id.
- Do not render tentative/debug drafting events (`tentative_agent_response`,
  `internal_tentative_agent_response`) into customer transcript rows. They cause
  confusing "入力中" / draft text artifacts.
- To keep transcript timing near voice playback, buffer Agent text until an
  audio signal (`onAudio`, `onAudioAlignment`, or `speaking` mode) arrives. Use a
  short fallback timer only when no audio signal arrives; never hardcode the live
  opening line to paper over missing SDK events.
- The root `pnpm` override pins `livekit-client` to `2.16.1` for the ElevenLabs
  React SDK. Versions `2.17.3+` use the newer `/rtc/v1` signaling path, which
  has failed against this voice endpoint. Do not remove or loosen the pin unless
  a real live smoke confirms the upstream endpoint supports `/rtc/v1`.

## Lifecycle Guardrails

- Live and fakeLive start gates must prevent duplicate session starts.
- Session start must have a timeout and release the connecting state on failure.
- Guard every delayed callback with the active `sessionGeneration` and local conversation id.
- `startNewConversation` must end the old session, clear transcript/indicator/error, reset mute, and create a fresh local conversation id.
- Do not use `window.location.reload()` to start a new conversation.
- Failed chat sends must remain visible as failed bubbles and be retryable without duplicate bubbles.

## UI Guardrails

- If a control is requested hidden, remove the visible UI and any dead interactive affordance unless there is a product reason to keep it accessible.
- Avoid decorative controls with no behavior in the customer-facing shell.
- Keep these customer-facing controls hidden unless explicitly re-approved:
  history, voice settings, mock tool, transcript `...` floating buttons,
  composer clip icon, "詳細を表示", "入力中", and "エージェントが応答中...".
- The ended state should show only the functional `+ 新しい会話` action centered
  under the ended text.
- Header and composer changes usually affect visual snapshots; only update baselines for intentional visual changes.
- Do not relax visual thresholds to pass tests.

## Transcript Logging

- For production live debugging, client transcript events may be mirrored to
  `/api/voice/transcript-log`; Cloud Run should log them as one-line JSON with
  `message: "Roleplay transcript"`.
- Log phases should distinguish at least `sdk-received`, `displayed`, and
  `local-user-message` so missing/late transcript issues can be isolated.
- Never log API keys, conversation tokens, full raw SDK objects, upstream URLs,
  agent ids, or branch ids. Logging conversation text is allowed for this Adecco
  demo only because the operator explicitly requested Cloud Run transcript logs.
- If logs appear as multi-line Node object output (`Roleplay transcript {` plus
  separate `phase:` / `text:` lines), change the server log call to
  `console.info(JSON.stringify(...))` before relying on the evidence.

## Verification

Run the narrowest checks that cover the change:

```bash
pnpm --filter @top-performer/web exec eslint components/roleplay lib/roleplay --ext .ts,.tsx --ignore-pattern '**/*.test.ts' --ignore-pattern '**/*.test.tsx' --no-error-on-unmatched-pattern
pnpm --filter @top-performer/web test:e2e
pnpm --filter @top-performer/web test:visual
pnpm --filter @top-performer/web build
```

For intentional visual changes, regenerate snapshots and immediately rerun visual tests:

```bash
pnpm --filter @top-performer/web test:visual -- --update-snapshots
pnpm --filter @top-performer/web test:visual
```

When root `pnpm lint` or `pnpm typecheck` fails because of unrelated repo-wide blockers, record the exact blocker in `docs/qa.md` and still run targeted evidence for the touched files.

## Browser Evidence

- Use Browser Use for localhost checks when the user references the in-app browser.
- Verify visible removals by checking both the DOM count and the screenshot-visible behavior.
- For `fakeLive=1`, confirm initial transcript rows are `0` before exercising call/chat/mute/new-conversation.

## Live Smoke

Do not mark live complete from fakeLive, mock, or visual tests alone. `docs/qa.md` must record real browser and microphone evidence for:

- call start
- Agent initial utterance displayed
- user voice transcript displayed
- composer send and Agent response
- mute ON blocks transcript and Agent reaction
- mute OFF restores voice input
- new conversation clears old state and starts fresh
- customer-visible provider concealment

If this was not run, state `実装済み・live未検証`.

## Production Branch Alignment

After every Adecco Agent publish, verify the web runtime points at the published
branch:

```bash
gcloud run services describe mendan --region asia-northeast1 --project adecco-mendan --format=json
gcloud run services describe roleplay-ui --region asia-northeast1 --project adecco-mendan --format=json
```

- Primary customer service: `mendan`.
- Compatibility/legacy service: `roleplay-ui`.
- Both services must use the publish artifact's latest `binding.elevenBranchId`
  as `ELEVENLABS_BRANCH_ID`.
- If the UI connects but old Agent behavior persists, suspect Cloud Run env
  branch mismatch before debugging React.
- Do not deploy or inspect production state in `rhc-analytics-prod`; use
  `--project adecco-mendan` on every production gcloud command.

## Manual Orb Test 1〜8 Protocol (Adecco Manufacturer Order Hearing)

For the Adecco staffing roleplay scenario, manual orb verification follows a standardized 8-test script tied to Final Release DoD v2 §10. Use this script every time the prompt or voice profile changes.

### Pre-conditions (gate before running orb)

Manual orb is only meaningful AFTER all of the following:

- `pnpm publish:scenario -- --scenario staffing_order_hearing_adecco_manufacturer_busy_manager_medium` PASSED with `passed=true`, vendor smoke 8/8, non-null `binding`.
- `pnpm test` (local regression including `priorOrbFailure.regression.test.ts` + `gradeStaffingSession.test.ts`) PASSED.
- `pnpm smoke:eleven` PASSED (≤ 3 retries within a session for vendor flake).
- post-publish SAP grep clean.
- voice mirror parity confirmed against accounting profile.

If any pre-condition fails, do NOT run manual orb — the test results will not be diagnostic.

### Test execution

URL: `https://elevenlabs.io/app/talk-to?agent_id=agent_2801kpj49tj1f43sr840cvy17zcc`

Environment: Chrome, quiet room, microphone permission granted, transcript recorder ready.

1. **Test 1 — Opening line** (FROZEN, user-approved 2026-04-26): just open the URL; the agent should self-initiate with the natural opening (`新しい派遣会社` + `要件整理` cues), no AI/採点 self-naming. **Do NOT modify the opening line / `identity_self` trigger / `openingLine` field as part of any prompt-fix work** — this text is user-approved as of Manual Orb v3. If a future fix appears to require changing it, surface that as a separate decision to the operator first.
2. **Test 2 — Shallow overview**: ask `今回の募集について概要を教えてください。` Agent must stay at `営業事務一名 / 要件整理` level only; no leak of competition / 単価 / decision / 月600〜700件.
3. **Test 3 — Background staged disclosure**: Q1 `募集背景を教えてください。` → expect 増員 / 比較したい only. Q2 `なぜ新しい派遣会社にも声かけたんですか？` → expect 供給/レスポンス課題 reveal.
4. **Test 4 — Business task staged disclosure**: Q1 `営業事務ですよね？` → 受発注/納期調整 program. Q2 `主業務はどれ？` → 受発注入力+納期調整中心. Q3 `件数や繁忙サイクルは？` → 月600〜700件 + ピーク.
5. **Test 5 — Competition/decision staged**: Q1 `他社にも並行で？` → もう一社の大手. Q2 `先行提案期間は？` → 三営業日. Q3 `決定者は？` → 人事+現場課長 二段. **Critical**: after Q3, the agent must STOP — it must NOT append `はい、大きくはその整理で合っています` / `補足すると` / `Adeccoさんの派遣の特徴` / `他社さんとの違い`. Closing_summary content fired here = P0.
6. **Test 5.5 — Conditions before summary** (NEW, Manual Orb v3 — REQUIRED before Test 6, do NOT skip): Q1 `開始時期は？` → `開始は6月1日`. Q2 `就業時間や残業は？` → `8:45-17:30 / 月10-15h`. Q3 `請求単価のレンジは？` → `1,750-1,900円`. Q4 `優先したい経験や人物面は？` → `受発注経験 + 対外調整 + 正確性 + 協調性`. Each Q must end with its own intent's answer only — no closing_summary leak.
7. **Test 6A — Closing summary 正常系 + アデコ逆質問**: read learner's full numeric summary turn that bundles ALL conditions gathered in Tests 1〜5.5 (1名/6/1/8:45-17:30/月10-15h/**1,750-1,900円**/受発注経験+対外調整+正確性+協調性/水曜まで) **with an explicit summary signal** (`整理させてください` / `という進め方でよろしいでしょうか`). Agent must (a) acknowledge/correct, (b) ask ONE アデコ strength/違い question. Skipping Test 5.5 makes this turn artificially short and tests an unrealistic scenario.
7.1. **Test 6B — Closing summary 数値誤認ガード** (NEW, Manual Orb v5): summarize with one major value INTENTIONALLY WRONG. Recommended variant: 請求単価を `5万円から10万円` と誤要約 (真値 1,750-1,900円). Agent must (a) start with or clearly contain `違います`, (b) provide the correct value (1,750-1,900円), (c) NOT contain `はい、大きくはその整理で合っています` or hedging (`だいたい合っています` / `少し違うかもしれません`), AND (d) **NOT proceed to the アデコ reverse question in the same response** (correction must end the turn so the learner can absorb it). FAIL if any of these are violated — this is a P0 (see #14 below).
7.2. **Test 6C — 沈黙時の催促禁止** (NEW, Manual Orb v5): say nothing for 30+ seconds after Test 6A completes. Agent must remain SILENT — no `お話しはお済みでしょうか` / `ご連絡いただければと思います` / `まだご検討中でしょうか` / `いかがでしょうか` / `お待ちしております` / `まだお話しになられていますでしょうか`. P1 (see #15 below).
8. **Test 7 — No coaching**: ask `何を聞けば良いですか？` Agent must give short deflection (`ご確認したい点からで大丈夫です。`); no item enumeration.
9. **Test 8 — Natural Japanese (whole-conversation observation)**: 1〜3 sentences per reply; no bullet points; `どの点についてですか` ≤ 2 in session, never 2 turns consecutive; `まだご検討中でしょうか` zero in regular replies.

### v6 / v8 で追加された Test variants

- **Test 4.5 — 引継ぎ (handover_method, NEW v6)**: ask `引継ぎはどのように進めますか？` / `OJT は何週間ですか？` / `独り立ちまでの期間は？`. Agent answers ONLY 引継ぎ情報 (二週間の重なり OJT + マニュアル + だいたい一か月) — does NOT leak competition / decision / first_proposal_window.
- **Test 5.7 — forced ranking (selection_priority_ranking, NEW v6)**: ask `受発注経験・データ入力・業界経験・人柄・開始日のうち何を最優先で見ますか？` / `must と want を分けるとどうですか？` / `年齢はどこまで緩和できますか？`. Agent must (a) put 受発注経験 as 最優先, (b) state 年齢は目安, (c) NOT give vague "全部同じくらい大事です" answer.
- **Test 5.8a — 指揮命令者の人柄 (supervisor_personality_question, NEW v8 split)**: ask `指揮命令者はどんな方ですか？` / `合わないタイプは？`. Agent answers ONLY 課長の人柄 (落ち着いて正確性に厳しい) + 合う/合わないタイプ (協調型 OK / 自己流 NG) in 1〜2 sentences. Does NOT mention 部署人数・男女比・服装・休憩室 (those belong to Test 5.8b). NEW v9: Response opening must NOT have filler prefix (「承知しました。少し整理しますね。」「お待ちください。」).
- **Test 5.8b — 部署の雰囲気 (team_atmosphere_question, NEW v8 split)**: ask `部署の雰囲気は？` / `男女比は？` / `服装は？` / `休憩室はありますか？`. Agent answers ONLY 部署構成 (12 名 / 女性 8 / 男性 4 / 30〜40 代) + 派遣スタッフ数 + 服装 + 休憩室 in 1〜2 sentences. Does NOT mention 課長の人柄 / 合う/合わないタイプ (those belong to Test 5.8a). NEW v9: Response opening must NOT have filler prefix.
- **Test 6 v7 variant — 「半」⇔「三十分」semantic equivalence**: in Test 6A summary, intentionally say `平日八時四十五分から十七時半` instead of `十七時三十分`. Agent MUST acknowledge as equivalent (not say "違います" — manual orb v7 P0 fix). The same goes for 一名 ⇔ 1名, 六月一日 ⇔ 6月1日, 千七百五十円 ⇔ 1,750円.

### P0 blockers (immediate release stop)

If ANY of these occur during Test 1〜5.5 / 6〜8, release is blocked and the agent must NOT go to production:

1. Hidden facts leaked at overview level
2. Reply lags one turn ahead
3. Agent ignores learner summary or returns generic catch-all
4. Adecco reverse question fires before learner summary
5. Adecco reverse question never fires
6. Adecco reverse question repeats 2+ times
7. `どの点についてですか` loops (2 turns consecutive, or 3+ in session)
8. SAP / Oracle / ERP / AP / 経費精算 / 支払 appears in any reply
9. Voice does not match accounting current Publish (sound check)
10. **closing_summary content (`はい、大きくはその整理で合っています` / `補足すると` / `Adeccoさんの派遣の特徴` / `アデコさんの派遣の特徴` / `他社さんとの違い`) is appended to a non-summary intent answer** — e.g., the agent answers a `decision_structure` / `next_step_close` / `competition` / `commercial_terms` / `volume_cycle` / `first_proposal_window` question and then concatenates a closing_summary acknowledgement + Adecco/アデコ reverse question without the user having issued an explicit summary signal AND ≥3 conditions in the same turn. (Manual Orb v3, 2026-04-26 — fixed by strict A∧B trigger; if it recurs, escalate to `ai-rpg-staffing-reference-scenario` § "Disclosure Ledger 3-Layer Edit Rule".)
11. Test 5.5 was skipped — Test 6 results are not diagnostic if conditions were not actually hearable beforehand.
12. **TTS reads English `Adecco` as 'アデッコ' instead of 'アデコ'** (Manual Orb v4, 2026-04-26). The agent is supposed to use カタカナ `アデコ` in runtime utterances; if you hear 'アデッコさん', the prompt source has English `Adecco` leaking into an `allowedAnswer` or rendered prompt example. Fix path: edit prompt source per `ai-rpg-staffing-reference-scenario` § "Brand-name TTS rewrite categorization" (5-bucket categorization). The remote pronunciation dictionary is a defense-in-depth backstop — Phase 2C handoff at `data/handoff/manual-orb-v4-phase2-handoff.md` covers the upload steps to make `Adecco → アデコ` work even when source text leaks the English form.
13. **Compressed Japanese (月末月初 / 月曜午前 / 商材切替時 / 現場適合判断) sounds harsh / business-jargony in TTS** (Manual Orb v4, 2026-04-26). Agent should say `月末と月の初め` / `月曜日の午前中` / `取り扱い商品が切り替わる時期` / `候補者が現場に合うかどうかの最終判断`. If you hear the compressed form, prompt source needs naturalization in `volume_cycle.allowedAnswer` or `decision_structure.allowedAnswer`. Both forms are accepted by tests for backwards compat, but the natural form is preferred for live orb.
14. **誤数値要約に AI が同意してしまう** (Manual Orb v5 P0, 2026-04-26). Test 6B で意図的に誤った請求単価 (5万円〜10万円) を要約しても AI が「はい、大きくはその整理で合っています」と返したり、「だいたい合っていますが」と曖昧に流したり、訂正と同時にアデコ逆質問へ進んだ場合は P0。Fix path: `ai-rpg-staffing-reference-scenario` § "Manual Orb v5 lesson: トリガ条件と応答内容検証は別レイヤー" (canonical truth table + Case 1/2 allowedAnswer + hedging negativeExamples + ConvAI 回帰テスト追加)。
15. **沈黙時に AI が勝手に催促文を発話する** (Manual Orb v5 P1, 2026-04-26). Test 6C で 30 秒沈黙したら AI が「お話しはお済みでしょうか」「ご連絡いただければと思います」「まだご検討中でしょうか」「まだお話しになられていますでしょうか」等を発話した場合は P1。原因は `compileStaffingReferenceScenario.ts` の Silence and Ambiguity Handling 節が「短く一度だけ促します」と勝手に許可していること (ElevenLabs プラットフォームの default 挙動ではない)。Fix: 該当文を削除 + 禁止フレーズ列挙。
16. **「データ入力」が業務分解質問への回答に含まれない** (Manual Orb v6 P0, 2026-04-26). Test 4 Q2 で AI が「受発注入力と納期調整が中心です」だけで止まり「データ入力」が含まれない場合は P0。Excel 設計書 (Sheet 02 業務リスト + Sheet 05 必須#2) は「データ入力」を明示している。Fix: `job_detail_tasks.allowedAnswer` + `core_tasks` hidden fact に「データ入力」追加。
17. **引継ぎ質問に答えられない / 競合に話を逸らす** (Manual Orb v6 P0). Test 4.5 で「引継ぎはどう進めますか？」と聞いたのに AI が独立した引継ぎ情報を返さない / 競合状況を返してしまう場合は P0。Fix: `handover_method` 独立 trigger を追加 (volume_cycle と分離)。
18. **forced ranking に「全部同じくらい大事」と曖昧回答** (Manual Orb v6 P0). Test 5.7 で must / want forced ranking を引き出した際 AI が優先順位を出さない場合は P0。Fix: `selection_priority_ranking` 独立 trigger を追加し canonical answer に「受発注経験 最優先」「年齢は目安」を明示。
19. **「年齢は目安」が出ない** (Manual Orb v6 P0). Test 5.7 forced ranking で AI が年齢を絶対条件として扱った場合は P0。Fix: 同上 (`selection_priority_ranking.allowedAnswer` に「年齢は目安で絶対条件ではありません」明示)。
20. **職場環境 / 指揮命令者 / 合う・合わない人物像 を答えられない** (Manual Orb v6 P0). Test 5.8 で AI がカルチャーフィット情報を返さない場合は P0。Fix: v8 で `supervisor_personality_question` + `team_atmosphere_question` の 2 trigger に分離 (詳細は #24 参照)。
21. **「十七時半」⇔「十七時三十分」の同義表記を「違います」訂正してしまう** (Manual Orb v7 P0, 2026-04-27). Test 6 で学習者が「平日八時四十五分から**十七時半**」と要約した時、AI が「違います。就業時間は十七時半ではなく、十七時三十分です」と返した場合は P0。半 = 三十分、漢数字 ⇔ 算用数字、千円 ⇔ 1,000円 はすべて意味的同義。Fix: `closing_summary.intentDescription` に「表記揺れの同義扱い」セクション追加 + smoking-gun を `negativeExamples` に lock。
22. **AI が prompt 指示文「（何も返さず…）」を literal 発話してしまう** (Manual Orb v8 P0, 2026-04-26). 「うん」「はい」短い相槌に対して AI が「（何も返さず、ユーザーの次の発話を待ちます）」「（沈黙）」「（応答なし）」のような括弧付き stage direction を読み上げた場合は P0。LLM が prompt 内の instructional text を template と誤解する class の問題 (v5 の 5万円〜10万円 hallucination と同型)。Fix path: `ai-rpg-staffing-reference-scenario` § "Manual Orb v8/v9 lesson" Pattern 3 (Stage direction smoking-gun lock)。
23. **culture_fit_question が連続質問で同じ canonical を repeat する** (Manual Orb v8 P1, 2026-04-26). Test 5.8 で「指揮命令者は？」 → full canonical → 「部署の雰囲気は？」 → **同じ canonical を再度フル emit + truncate** された場合は P1。Fix: v8 で `supervisor_personality_question` + `team_atmosphere_question` の 2 trigger に分離 (Test 5.8a + 5.8b)。詳細は `ai-rpg-staffing-reference-scenario` § Pattern 2 (Trigger split)。
24. **AI 応答冒頭に取りつくろいフィラー** (Manual Orb v9 P1, 2026-04-27). 「承知しました。少し整理しますね。<canonical>」「承知しました。<canonical>」「少し整理しますね。<canonical>」「お待ちください。<canonical>」のような filler prefix が応答の最初の文に置かれた場合は P1。原因は prompt 内の「allow vs ban conflict」(承知しました 一般 allow + compound ban の coexistence)。Fix: `ai-rpg-staffing-reference-scenario` § Pattern 1 (Allow vs ban conflict resolution) — allow を **位置で制限** された stricter form に変換 + smoking-gun lock + 高 salience `# Response Opening Format` 独立セクション昇格。

### Recording rule

Record actual utterances in `docs/references/adecco_manufacturer_order_hearing_memo.md` under "Post-fix orb verification" — replace any `<blocked: human orb utterance not captured>` markers with verbatim quotes.

Do NOT mark DoD H complete with `<blocked>` placeholders remaining. Real utterance evidence is required.

If a P0 blocker fires, write the failure utterance, the test number, and a one-line root cause hypothesis into the memo before closing the orb session — that becomes the next prompt-iteration input.
