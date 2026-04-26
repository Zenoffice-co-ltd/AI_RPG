# QA: AI Roleplay UI

## Mock Mode

- Open `/demo/adecco-orb?mock=1`.
- Confirm the header, Orb, transcript, composer, mute button, voice settings, history drawer, mock toggle, and scroll control are visible.
- Confirm no external voice session is started.
- Send a message with Enter.
- Confirm Shift+Enter inserts a newline.
- Confirm blank messages are not sent.

## Visual Test

- Run `pnpm test:visual`.
- Target URL: `/demo/adecco-orb?mock=1&visualTest=1`.
- Viewport: `1912x1099`.
- Required threshold: full page and region snapshots `<= 0.5%`.
- Do not relax the threshold; adjust CSS/DOM/layout instead.

## Live Mode Smoke Check

Record each live check below before release. The implementation is in place, but
this is not complete until the live browser and microphone checks pass.

| Field | Result |
| --- | --- |
| Execution datetime | 2026-04-26T14:11:25+09:00 |
| Browser | Not yet run with real live mode |
| URL | `/demo/adecco-orb` |
| Mic permission | Not yet run |
| call button start | Not yet run |
| Agent initial utterance displayed | Not yet run |
| User voice transcript displayed | Not yet run |
| Text send | Not yet run |
| Agent response to text | Not yet run |
| Mute ON prevents transcript/agent reaction | Not yet run |
| Mute OFF restores voice input | Not yet run |
| New conversation resets old session/transcript | Not yet run |
| New session receives fresh Agent utterance | Not yet run |
| Safe server error log check | Not yet run |
| Customer-visible provider concealment | Not yet run |

Status: implementation completed and automated mock/fakeLive/visual gates pass;
live smoke is未検証. Do not mark the live conversation DOD complete until a real
API key, browser, and microphone are used to fill the table above.

2026-04-26 local automation note:

- Mock/E2E checks passed with Playwright.
- `fakeLive=1` checks passed with Playwright: initial transcript is empty,
  fake Agent/User events are rendered through the live reducer path, composer
  send displays a user bubble and fake Agent response, mute dispatch is observed,
  and new conversation clears the transcript before a fresh start.
- Visual snapshot checks passed at `1912x1099`.
- In-app Browser plugin verification passed for
  `/demo/adecco-orb?fakeLive=1`: initial message rows were `0`, status text was
  the idle placeholder, then call + composer send produced event-driven bubbles.
- `pnpm lint` still fails on pre-existing unrelated lint errors, currently
  including `packages/scenario-engine/src/accountingArtifacts.ts`,
  `packages/scenario-engine/src/benchmarkRenderer.ts`,
  `packages/scenario-engine/src/compileAccountingScenario.ts`,
  `packages/scenario-engine/src/phase34.ts`,
  `packages/scenario-engine/src/voiceProfiles.ts`, plus the web server test
  unsafe-any baseline noted by `pnpm --filter @top-performer/web lint`.
  Targeted lint for this change passed with
  `pnpm --filter @top-performer/web exec eslint components/roleplay lib/roleplay --ext .ts,.tsx --ignore-pattern '**/*.test.ts' --ignore-pattern '**/*.test.tsx' --no-error-on-unmatched-pattern`.
- `pnpm build` passes, with an existing Next/Turbopack NFT trace warning from
  `apps/web/app/api/vendor/eleven/initiation/route.ts`.
- Live smoke check still requires a real browser session with microphone
  permission and configured production secrets.

## Known Limitations

- DevTools Network may show the external voice transport used by the browser SDK. Network-level provider concealment is out of scope.
- The UI, metadata, errors, console logs, storage, and API responses must not expose provider names, agent id, branch id, API key, or upstream URLs.
