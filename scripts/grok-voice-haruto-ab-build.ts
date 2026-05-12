// Haruto A/B build harness — offline operator script.
//
// Generates the B-side of the Haruto pronunciation A/B test described in
// docs/grok-voice-haruto-closeout-20260512.md (post-merge follow-up).
//
//   A side: the existing 23 promoted artifacts under
//           data/generated/registered-speech/v1/artifacts/*.pcm. These
//           were synthesized from `spokenTextForGeneration`, which carries
//           manual kana pre-rewrites (じゅはっちゅう / せんななひゃくごじゅう
//           / つきじゅうからじゅうごじかん / etc.) acting as a poor-man's
//           pronunciation dictionary embedded in the source text.
//   B side: the same 23 utterances re-synthesized using `displayText`
//           (the natural kanji form: 受発注 / 千七百五十円 / 月10から
//           15時間) WITHOUT any pronunciation guide, PLS, glossary,
//           lexicon, system prompt, or pre-TTS rewrite. Pure Haruto +
//           language=ja + (when accepted) text_normalization=true.
//
// Output (next to the existing review.html for the same buildId):
//   out/registered-speech-build/<buildId>/review.haruto-ab.html
//   out/registered-speech-build/<buildId>/ab-manifest.haruto-basic-no-dict.json
//   out/registered-speech-build/<buildId>/ab/B_HARUTO_BASIC_NO_DICT/<intent>.pcm
//   out/registered-speech-build/<buildId>/ab/B_HARUTO_BASIC_NO_DICT/<intent>.wav
//   out/registered-speech-build/<buildId>/ab/B_HARUTO_BASIC_NO_DICT/<intent>.metadata.json
//
// Existing review.html and v1/artifacts/* are NOT touched.
//
// SAFETY: same as grok-voice-build-registered-speech.ts — the script is
// offline, run by an operator with xAI key + ADC. It is not wired into
// CI. Re-running is idempotent (overwrites the B/* files only).
//
// Usage:
//   export GROK_VOICE_VOICE_ID=99c95cc8a177
//   pnpm grok:haruto-ab-build
//     [--build-dir=2026-05-12T03-54-35-141Z]   # default: latest under out/
//     [--limit=N]                              # default: all 23

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REGISTERED_SPEECH_VOICE_ID,
  type RegisteredSpeechManifest,
} from "../apps/web/lib/roleplay/registered-speech/types";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Hard-coded — same as apps/web/server/grokVoice/tts.ts. Not imported
// from there because that module pulls server-env which expects the
// runtime context.
const TTS_ENDPOINT = "https://api.x.ai/v1/tts";
const TTS_LANGUAGE = "ja";
const TTS_CODEC = "pcm";
const TTS_SAMPLE_RATE = 24_000;

// Per-intent override for the B-side TTS input text. When omitted, B
// uses the manifest entry's displayText (default behavior — that's the
// "natural kanji form, no dictionary" baseline). When present, B uses
// this string instead — useful for "what if we wrote it differently?"
// variant tests where displayText alone isn't enough to express the
// thing we want to listen to.
//
// 2026-05-12: billing_rate scored A-wins in the first A/B round
// (kana-rewrite "せんななひゃくごじゅう円" beat kanji-digit "千七百五十円").
// The user wanted to additionally test arabic digits with
// text_normalization=true to see if xAI can normalise the digits into
// the natural Japanese reading without our manual kana help.
//
// Round 2 (2026-05-12 evening) tests "1650円から1900円" instead of the
// production figure "1750円から1900円" — the lower bound is shifted to
// see if Haruto's reading is robust across different sen-units. The
// production source.json's spoken/displayText is unchanged.
const B_SIDE_TEXT_OVERRIDES: Record<string, string> = {
  billing_rate: "請求想定は経験により、1650円から1900円程度です。",
};

type CliArgs = { buildDir: string | null; limit: number | null };

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { buildDir: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--build-dir" && next !== undefined) {
      out.buildDir = next;
      i += 1;
    } else if (flag === "--limit" && next !== undefined) {
      out.limit = Number(next);
      i += 1;
    }
  }
  return out;
}

function loadXaiKeyFromSecretManagerIfNeeded(): void {
  const current = process.env["XAI_API_KEY"];
  const looksReal =
    current && current.length >= 32 && !current.startsWith("test-");
  if (looksReal) return;
  const projects = [
    process.env["SECRET_SOURCE_PROJECT_ID"] ?? "zapier-transfer",
    "adecco-mendan",
  ];
  for (const project of projects) {
    const r = spawnSync(
      "gcloud",
      [
        "secrets",
        "versions",
        "access",
        "latest",
        "--secret=XAI_API_KEY",
        `--project=${project}`,
      ],
      { encoding: "utf8", shell: process.platform === "win32" }
    );
    if (r.status === 0 && r.stdout && r.stdout.trim().length >= 32) {
      process.env["XAI_API_KEY"] = r.stdout.trim();
      console.info(
        `[haruto-ab-build] XAI_API_KEY fetched from projects/${project}/secrets/XAI_API_KEY (len=${r.stdout.trim().length})`
      );
      return;
    }
  }
}

function pcmToWav(pcm: Buffer, sampleRate = TTS_SAMPLE_RATE): Buffer {
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function findLatestBuildDir(): string {
  const root = resolve(REPO_ROOT, "out", "registered-speech-build");
  if (!existsSync(root)) {
    throw new Error(
      `[haruto-ab-build] no build root at ${root} — run pnpm grok:build-registered-speech first`
    );
  }
  const entries = readdirSync(root)
    .map((name) => ({ name, full: resolve(root, name) }))
    .filter((e) => statSync(e.full).isDirectory())
    .sort((a, b) => (a.name < b.name ? 1 : -1));
  const latest = entries[0];
  if (!latest) {
    throw new Error(`[haruto-ab-build] no build subdirectories under ${root}`);
  }
  return latest.name;
}

// xAI TTS request shape — keep this DELIBERATELY minimal. The whole
// point of the B side is to prove what Haruto sounds like with no
// help: no system prompt, no pronunciation guide, no PLS, no
// glossary, no pre-rewrite. Anything beyond {text, voice_id, language,
// output_format} would defeat the test.
type TtsRequestBody = {
  text: string;
  voice_id: string;
  language: string;
  output_format: { codec: string; sample_rate: number };
  text_normalization?: boolean;
};

type TtsResult =
  | {
      ok: true;
      pcm: Buffer;
      vendorMs: number;
      textNormalizationApplied: boolean;
    }
  | {
      ok: false;
      status: number;
      bodyFragment: string;
    };

async function synthesizeHarutoBasic(
  text: string,
  textNormalizationEnabled: boolean
): Promise<TtsResult> {
  const apiKey = process.env["XAI_API_KEY"];
  if (!apiKey) {
    return { ok: false, status: 0, bodyFragment: "missing XAI_API_KEY" };
  }
  const body: TtsRequestBody = {
    text,
    voice_id: REGISTERED_SPEECH_VOICE_ID,
    language: TTS_LANGUAGE,
    output_format: { codec: TTS_CODEC, sample_rate: TTS_SAMPLE_RATE },
  };
  if (textNormalizationEnabled) {
    body.text_normalization = true;
  }
  const startedAt = Date.now();
  const response = await fetch(TTS_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let bodyFragment = "";
    try {
      bodyFragment = (await response.text()).slice(0, 240);
    } catch {
      // ignore
    }
    return { ok: false, status: response.status, bodyFragment };
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    return { ok: false, status: 502, bodyFragment: "empty audio" };
  }
  return {
    ok: true,
    pcm: audio,
    vendorMs: Date.now() - startedAt,
    textNormalizationApplied: textNormalizationEnabled,
  };
}

type BSideArtifactMetadata = {
  intent: string;
  variant: "B_HARUTO_BASIC_NO_DICT";
  voice: "haruto";
  voiceId: string;
  language: "ja";
  textNormalizationRequested: boolean;
  textNormalizationApplied: boolean;
  textNormalizationSkippedReason?: string;
  dictionaryMode: "none";
  pronunciationGuideInjected: false;
  plsApplied: false;
  glossaryApplied: false;
  lexiconApplied: false;
  preTtsRewriteApplied: false;
  sourceTextUsed: "displayText" | "experimentalOverride";
  sourceText: string;
  sourceDisplayTextSha256: string;
  audioPath: string;
  audioWavPath: string;
  audioSha256: string;
  durationMs: number;
  vendorMs: number;
};

function buildReviewAbHtml(args: {
  builtAt: string;
  manifest: RegisteredSpeechManifest;
  bMetadataByIntent: Map<string, BSideArtifactMetadata>;
  globalTextNormalizationApplied: boolean;
}): string {
  const rows = args.manifest.entries
    .map((entry, idx) => {
      const bMeta = args.bMetadataByIntent.get(entry.intent);
      if (!bMeta) {
        // Per DoD: missing B side is a hard fail.
        throw new Error(
          `[haruto-ab-build] B-side metadata missing for intent=${entry.intent}`
        );
      }
      const aWavPath = `wav/${entry.intent}.wav`;
      return `
      <tr data-intent="${escapeHtml(entry.intent)}">
        <td>${idx + 1}</td>
        <td><code>${escapeHtml(entry.intent)}</code></td>
        <td class="text">
          <details>
            <summary>spokenText (A入力 — kana rewrite含む)</summary>
            <pre>${escapeHtml(entry.spokenText)}</pre>
          </details>
          <details open>
            <summary>displayText (B入力 — 自然な漢字)</summary>
            <pre>${escapeHtml(entry.displayText)}</pre>
          </details>
        </td>
        <td class="variant-a">
          <div class="badge badge-a">A: 現状 Haruto / 辞書あり (kana rewrite)</div>
          <audio controls preload="none" src="${aWavPath}"></audio>
          <details>
            <summary>metadata</summary>
            <pre>${escapeHtml(JSON.stringify({ sha256: entry.sha256, durationMs: entry.durationMs, source: "spokenTextForGeneration" }, null, 2))}</pre>
          </details>
        </td>
        <td class="variant-b" data-dictionary-mode="none" data-source-text-used="${escapeHtml(bMeta.sourceTextUsed)}">
          <div class="badge badge-b">B: Haruto basic / 辞書なし</div>
          ${
            bMeta.sourceTextUsed === "experimentalOverride"
              ? `<div class="override-banner">⚠ B側は experimentalOverride で生成: <code>${escapeHtml(bMeta.sourceText)}</code></div>`
              : ""
          }
          <audio controls preload="none" src="${escapeHtml(bMeta.audioWavPath)}"></audio>
          <details>
            <summary>metadata</summary>
            <pre>${escapeHtml(JSON.stringify({
              audioSha256: bMeta.audioSha256,
              durationMs: bMeta.durationMs,
              language: bMeta.language,
              textNormalizationRequested: bMeta.textNormalizationRequested,
              textNormalizationApplied: bMeta.textNormalizationApplied,
              ...(bMeta.textNormalizationSkippedReason
                ? { textNormalizationSkippedReason: bMeta.textNormalizationSkippedReason }
                : {}),
              dictionaryMode: bMeta.dictionaryMode,
              pronunciationGuideInjected: bMeta.pronunciationGuideInjected,
              plsApplied: bMeta.plsApplied,
              glossaryApplied: bMeta.glossaryApplied,
              lexiconApplied: bMeta.lexiconApplied,
              preTtsRewriteApplied: bMeta.preTtsRewriteApplied,
              sourceTextUsed: bMeta.sourceTextUsed,
              sourceText: bMeta.sourceText,
            }, null, 2))}</pre>
          </details>
        </td>
        <td class="judgment">
          <select name="judgment-${escapeHtml(entry.intent)}">
            <option value="">--</option>
            <option value="A">Aが良い</option>
            <option value="B">Bが良い</option>
            <option value="EQ">同等</option>
            <option value="REGEN">要再生成</option>
            <option value="SKIP">対象外</option>
          </select>
        </td>
        <td class="memo">
          <textarea name="memo-${escapeHtml(entry.intent)}" rows="3" placeholder="イントネーション / 誤読 / 間 / ビジネス用途としての違和感"></textarea>
        </td>
      </tr>
    `;
    })
    .join("");

  const tnSummary = args.globalTextNormalizationApplied
    ? "B側で text_normalization=true を送信 (xAI が受理)"
    : "B側 text_normalization は xAI が拒否したため未適用 (metadata 参照)";

  return `<!doctype html>
<meta charset="utf-8">
<title>Haruto A/B Review — ${escapeHtml(args.builtAt)}</title>
<style>
  body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif; margin: 24px; max-width: 1600px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #555; font-size: 13px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 8px 10px; font-size: 13px; vertical-align: top; }
  th { background: #f3f4f6; text-align: left; font-weight: 600; }
  td.text { max-width: 360px; }
  td.text pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 12px; margin: 4px 0; }
  td.variant-a, td.variant-b { min-width: 280px; }
  td.judgment { min-width: 110px; }
  td.memo { min-width: 220px; }
  td.memo textarea { width: 100%; box-sizing: border-box; font-family: inherit; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; margin-bottom: 6px; }
  .badge-a { background: #e0e7ff; color: #1e3a8a; }
  .badge-b { background: #fef3c7; color: #92400e; }
  .override-banner {
    background: #fee2e2;
    border-left: 3px solid #dc2626;
    color: #7f1d1d;
    padding: 4px 8px;
    margin: 4px 0;
    font-size: 11px;
    border-radius: 2px;
  }
  .override-banner code { background: #fff; padding: 1px 4px; border-radius: 2px; }
  details summary { cursor: pointer; font-size: 12px; color: #555; }
  details[open] summary { color: #111; }
  details pre { background: #f9fafb; padding: 6px 8px; border-radius: 4px; max-height: 220px; overflow: auto; font-size: 11px; }
  audio { width: 100%; margin: 4px 0; }
  .criteria {
    background: #fef9c3;
    border-left: 4px solid #ca8a04;
    padding: 12px 16px;
    margin: 16px 0;
    font-size: 13px;
  }
  .criteria ul { margin: 6px 0 0 20px; padding: 0; }
</style>
<h1>Haruto A/B Review — ${escapeHtml(args.builtAt)}</h1>
<div class="meta">
  <div>buildId: <code>${escapeHtml(args.manifest.buildId)}</code></div>
  <div>voiceId: <code>${escapeHtml(args.manifest.voiceId)}</code> (Haruto, A/B共通)</div>
  <div>entries: ${args.manifest.entries.length} / 23</div>
  <div>${escapeHtml(tnSummary)}</div>
</div>
<div class="criteria">
  <strong>評価観点</strong>
  <ul>
    <li>固有名詞・略語の誤読がないか</li>
    <li>日本語イントネーションが自然か</li>
    <li>句読点・間が不自然でないか</li>
    <li>ビジネス会話として違和感がないか</li>
    <li>Aの kana rewrite (じゅはっちゅう/せんななひゃくごじゅう等) によって逆に不自然になっていないか</li>
    <li>Bの自然な漢字 (受発注 / 千七百五十円 等) のままで Haruto が必要十分に読めているか</li>
  </ul>
  <p style="margin: 8px 0 0;">A=既存 review.html の音声 (spokenText 経由・kana rewrite あり) / B=同じ発話を displayText から再合成 (辞書・PLS・guide・pre-rewrite すべて無効)</p>
</div>
<table>
  <thead><tr>
    <th>#</th>
    <th>intent</th>
    <th>発話テキスト</th>
    <th>A: 現状 Haruto / 辞書あり</th>
    <th>B: Haruto basic / 辞書なし</th>
    <th>判定</th>
    <th>メモ</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadXaiKeyFromSecretManagerIfNeeded();
  const apiKey = process.env["XAI_API_KEY"];
  if (!apiKey || apiKey.length < 32 || apiKey.startsWith("test-")) {
    console.error(
      "BLOCKED: XAI_API_KEY not available. Tried shell env + gcloud Secret Manager (zapier-transfer, adecco-mendan)."
    );
    process.exit(2);
  }
  const expectedVoice = REGISTERED_SPEECH_VOICE_ID;
  const actualVoiceEnv = process.env["GROK_VOICE_VOICE_ID"] ?? "";
  if (actualVoiceEnv !== expectedVoice) {
    console.error(
      `BLOCKED: GROK_VOICE_VOICE_ID must be ${expectedVoice} (Haruto), got ${
        actualVoiceEnv || "(empty)"
      }`
    );
    process.exit(2);
  }

  const buildDir = args.buildDir ?? findLatestBuildDir();
  const buildRoot = resolve(REPO_ROOT, "out", "registered-speech-build", buildDir);
  if (!existsSync(buildRoot)) {
    throw new Error(`[haruto-ab-build] build dir not found: ${buildRoot}`);
  }
  const manifestPath = resolve(
    REPO_ROOT,
    "data",
    "generated",
    "registered-speech",
    "v1",
    "manifest.json"
  );
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8")
  ) as RegisteredSpeechManifest;
  if (manifest.voiceId !== expectedVoice) {
    throw new Error(
      `[haruto-ab-build] manifest voiceId mismatch: expected=${expectedVoice} actual=${manifest.voiceId}`
    );
  }

  const bRoot = resolve(buildRoot, "ab", "B_HARUTO_BASIC_NO_DICT");
  mkdirSync(bRoot, { recursive: true });

  // Probe text_normalization support on the FIRST entry. If xAI returns
  // 400 with a body that mentions the field, fall back to omitting it
  // for the rest. If the first request succeeds with the field, assume
  // the API accepts it (we cannot verify it was actually applied — that
  // is a soft signal, recorded as `textNormalizationApplied: true` with
  // the caveat noted in commentary).
  const entries = args.limit
    ? manifest.entries.slice(0, args.limit)
    : manifest.entries;
  let textNormalizationGloballyEnabled = true;
  let textNormalizationGloballyApplied = true;
  let probeReason: string | undefined;

  const bMetadataByIntent = new Map<string, BSideArtifactMetadata>();
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const override = B_SIDE_TEXT_OVERRIDES[entry.intent];
    const bText = override ?? entry.displayText;
    const sourceTextUsed: BSideArtifactMetadata["sourceTextUsed"] =
      override !== undefined ? "experimentalOverride" : "displayText";
    console.info(
      `[haruto-ab-build] synthesizing B intent=${entry.intent} (${i + 1}/${entries.length})${
        override !== undefined ? " [OVERRIDE]" : ""
      }`
    );
    let attempt = await synthesizeHarutoBasic(
      bText,
      textNormalizationGloballyEnabled
    );
    if (
      !attempt.ok &&
      textNormalizationGloballyEnabled &&
      attempt.status === 400 &&
      /text_normalization/i.test(attempt.bodyFragment)
    ) {
      console.warn(
        `[haruto-ab-build] xAI rejected text_normalization=true (${attempt.bodyFragment.slice(0, 120)}); retrying without it for the remaining ${entries.length - i} entries`
      );
      textNormalizationGloballyEnabled = false;
      textNormalizationGloballyApplied = false;
      probeReason = `xAI HTTP 400 mentioning text_normalization: ${attempt.bodyFragment.slice(0, 200)}`;
      attempt = await synthesizeHarutoBasic(bText, false);
    }
    if (!attempt.ok) {
      throw new Error(
        `[haruto-ab-build] xAI TTS failed for intent=${entry.intent}: status=${attempt.status} body=${attempt.bodyFragment.slice(0, 200)}`
      );
    }
    const audioSha = createHash("sha256").update(attempt.pcm).digest("hex");
    const sourceSha = createHash("sha256")
      .update(bText, "utf8")
      .digest("hex");
    const pcmPath = `ab/B_HARUTO_BASIC_NO_DICT/${entry.intent}.pcm`;
    const wavPath = `ab/B_HARUTO_BASIC_NO_DICT/${entry.intent}.wav`;
    writeFileSync(resolve(buildRoot, pcmPath), attempt.pcm);
    writeFileSync(resolve(buildRoot, wavPath), pcmToWav(attempt.pcm));
    const metadata: BSideArtifactMetadata = {
      intent: entry.intent,
      variant: "B_HARUTO_BASIC_NO_DICT",
      voice: "haruto",
      voiceId: REGISTERED_SPEECH_VOICE_ID,
      language: "ja",
      textNormalizationRequested: true,
      textNormalizationApplied: attempt.textNormalizationApplied,
      ...(attempt.textNormalizationApplied
        ? {}
        : {
            textNormalizationSkippedReason:
              probeReason ?? "Current xAI TTS wrapper does not expose text_normalization",
          }),
      dictionaryMode: "none",
      pronunciationGuideInjected: false,
      plsApplied: false,
      glossaryApplied: false,
      lexiconApplied: false,
      preTtsRewriteApplied: false,
      sourceTextUsed,
      sourceText: bText,
      sourceDisplayTextSha256: sourceSha,
      audioPath: pcmPath,
      audioWavPath: wavPath,
      audioSha256: audioSha,
      durationMs: Math.round((attempt.pcm.length / 2 / TTS_SAMPLE_RATE) * 1000),
      vendorMs: attempt.vendorMs,
    };
    writeFileSync(
      resolve(buildRoot, `ab/B_HARUTO_BASIC_NO_DICT/${entry.intent}.metadata.json`),
      `${JSON.stringify(metadata, null, 2)}\n`
    );
    bMetadataByIntent.set(entry.intent, metadata);
  }

  // Stable-key sanity: every manifest entry has a B counterpart.
  for (const entry of manifest.entries) {
    if (!bMetadataByIntent.has(entry.intent)) {
      throw new Error(
        `[haruto-ab-build] B side missing for intent=${entry.intent} — refusing to emit review.haruto-ab.html`
      );
    }
  }

  const abManifest = {
    builtAt: new Date().toISOString(),
    buildId: manifest.buildId,
    aSourceManifest: "data/generated/registered-speech/v1/manifest.json",
    aReviewHtml: "review.html",
    bReviewHtml: "review.haruto-ab.html",
    voice: "haruto",
    voiceId: REGISTERED_SPEECH_VOICE_ID,
    language: "ja",
    textNormalization: {
      requested: true,
      appliedAcrossAllEntries: textNormalizationGloballyApplied,
      ...(probeReason ? { skippedReason: probeReason } : {}),
    },
    bSideEntries: Array.from(bMetadataByIntent.values()),
  };
  writeFileSync(
    resolve(buildRoot, "ab-manifest.haruto-basic-no-dict.json"),
    `${JSON.stringify(abManifest, null, 2)}\n`
  );

  const html = buildReviewAbHtml({
    builtAt: new Date().toISOString(),
    manifest,
    bMetadataByIntent,
    globalTextNormalizationApplied: textNormalizationGloballyApplied,
  });
  writeFileSync(resolve(buildRoot, "review.haruto-ab.html"), html);

  console.log(
    JSON.stringify(
      {
        scope: "grokVoice.harutoAb.build",
        ok: true,
        buildDir,
        bSideEntries: bMetadataByIntent.size,
        textNormalizationAppliedAcrossAll: textNormalizationGloballyApplied,
        ...(probeReason ? { probeReason } : {}),
        outputs: {
          html: resolve(buildRoot, "review.haruto-ab.html"),
          manifest: resolve(buildRoot, "ab-manifest.haruto-basic-no-dict.json"),
          audioRoot: bRoot,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("FATAL", error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
