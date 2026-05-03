/**
 * Batch-run all 24 quality-latency cases against xAI grok-voice-think-fast-1.0.
 *
 * For each case:
 *   1. Synthesize the user_input as PCM16 24kHz via OpenAI TTS.
 *   2. Open a WebSocket to xAI Realtime with the same QUALITY_LATENCY_SYSTEM_PROMPT.
 *   3. Send audio + commit + response.create.
 *   4. Capture AI audio chunks + transcript.
 *   5. Save:
 *      - turn audio (WAV)
 *      - llm-text/xai-grok-voice-think-fast-1-0__<caseId>__r01.json
 *        (responseText = audio_transcript, schema-compatible with other models)
 *
 * Usage:
 *   .\scripts\grok-voice-batch.ps1
 *   pnpm exec tsx scripts/grok-voice-batch.ts --run-dir data/generated/quality-latency-benchmark/p6s3-...
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WebSocket as WsClient } from "ws";
import { OpenAiTtsProvider } from "../packages/vendors/src/index";
import { qualityLatencyCases } from "../packages/scenario-engine/src/qualityLatency/cases";
import { QUALITY_LATENCY_SYSTEM_PROMPT } from "../packages/scenario-engine/src/qualityLatency/systemPrompt";

function getArg(flag: string): string | undefined {
  const idx = process.argv.findIndex((v) => v === flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const RUN_DIR =
  getArg("--run-dir") ??
  resolve(
    process.cwd(),
    "data",
    "generated",
    "quality-latency-benchmark",
    "p6s3-20260503T072554094Z"
  );
const VOICE = getArg("--voice") ?? "ara";
const MODEL = getArg("--model") ?? "grok-voice-think-fast-1.0";
const TTS_VOICE = getArg("--tts-voice") ?? process.env["OPENAI_TTS_VOICE"] ?? "marin";
const TTS_MODEL = process.env["OPENAI_TTS_MODEL"] ?? "gpt-4o-mini-tts";
const CASE_LIMIT = Number(getArg("--limit") ?? "24");

const XAI_API_KEY = process.env["XAI_API_KEY"];
if (!XAI_API_KEY) {
  console.error("XAI_API_KEY not set");
  process.exit(1);
}

function pcmS16LeToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.byteLength;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return buffer;
}

type CaseResult = {
  caseId: string;
  category: string;
  userInput: string;
  userTranscriptEcho: string;
  responseText: string;
  firstAiAudioMs: number | null;
  firstAiTextMs: number | null;
  aiAudioDoneMs: number | null;
  totalSessionMs: number;
  userAudioPath: string;
  aiAudioPath: string;
  errorCode: string;
  errorMessage: string;
};

async function transcribeWithWhisper(audioPcm: Buffer): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return "";
  const wav = pcmS16LeToWav(audioPcm, 24_000);
  const boundary = `----WhisperBoundary${Date.now()}`;
  const fileName = "ai.wav";
  const intro = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `whisper-1\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\n` +
      `ja\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `json\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: audio/wav\r\n\r\n`
  );
  const outro = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([intro, wav, outro]);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.byteLength),
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`whisper failed HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { text?: string };
  return j.text ?? "";
}

async function synthesizeUserAudio(text: string): Promise<Buffer> {
  const tts = new OpenAiTtsProvider();
  const result = await tts.synthesize({
    provider: "openai",
    model: TTS_MODEL,
    text,
    language: "ja",
    outputFormat: "pcm_s16le",
    sampleRateHz: 24_000,
    voiceId: TTS_VOICE,
    timeoutMs: 30_000,
  });
  if (!result.success || !result.audio) {
    throw new Error(
      `TTS failed: ${result.errorCode ?? ""} ${result.errorMessage ?? ""}`
    );
  }
  return result.audio;
}

async function runOneCase(args: {
  caseId: string;
  category: string;
  userInput: string;
  outputDir: string;
}): Promise<CaseResult> {
  const result: CaseResult = {
    caseId: args.caseId,
    category: args.category,
    userInput: args.userInput,
    userTranscriptEcho: "",
    responseText: "",
    firstAiAudioMs: null,
    firstAiTextMs: null,
    aiAudioDoneMs: null,
    totalSessionMs: 0,
    userAudioPath: "",
    aiAudioPath: "",
    errorCode: "",
    errorMessage: "",
  };

  let userPcm: Buffer;
  try {
    userPcm = await synthesizeUserAudio(args.userInput);
  } catch (e) {
    result.errorCode = "TTS_FAILED";
    result.errorMessage = e instanceof Error ? e.message : String(e);
    return result;
  }

  const userWav = pcmS16LeToWav(userPcm, 24_000);
  const userPath = resolve(args.outputDir, `${args.caseId}-user.wav`);
  await writeFile(userPath, userWav);
  result.userAudioPath = userPath;

  const aiPcmChunks: Buffer[] = [];
  const startedAt = Date.now();

  return new Promise<CaseResult>((resolveResult) => {
    const ws = new WsClient(
      `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(MODEL)}`,
      { headers: { Authorization: `Bearer ${XAI_API_KEY}` } }
    );

    let sessionConfigured = false;
    let responseDone = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const finish = async (reason: string): Promise<void> => {
      if (responseDone) return;
      responseDone = true;
      if (watchdog) clearTimeout(watchdog);
      try {
        ws.close();
      } catch {
        // ignore
      }
      result.totalSessionMs = Date.now() - startedAt;
      if (aiPcmChunks.length > 0) {
        const aiWav = pcmS16LeToWav(Buffer.concat(aiPcmChunks), 24_000);
        const aiPath = resolve(args.outputDir, `${args.caseId}-ai.wav`);
        await writeFile(aiPath, aiWav);
        result.aiAudioPath = aiPath;
      }
      if (reason && !result.errorCode && aiPcmChunks.length === 0) {
        result.errorCode = "EMPTY_RESPONSE";
        result.errorMessage = reason;
      }
      resolveResult(result);
    };

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions: QUALITY_LATENCY_SYSTEM_PROMPT,
            voice: VOICE,
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            input_audio_transcription: { model: "whisper-1" },
            turn_detection: null,
          },
        })
      );
      sessionConfigured = true;

      // Send all user audio in one append, then commit + create response.
      ws.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: userPcm.toString("base64"),
        })
      );
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      ws.send(JSON.stringify({ type: "response.create" }));

      watchdog = setTimeout(() => {
        finish("watchdog timeout");
      }, 60_000);
    });

    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      const obj = msg as { type?: string; delta?: unknown; transcript?: unknown };
      const type = obj.type ?? "";

      if (type === "response.output_audio.delta" || type === "response.audio.delta") {
        const b64 = (obj as { delta?: string }).delta;
        if (typeof b64 === "string" && b64.length > 0) {
          aiPcmChunks.push(Buffer.from(b64, "base64"));
          if (result.firstAiAudioMs === null) {
            result.firstAiAudioMs = Date.now() - startedAt;
          }
        }
      } else if (type === "response.audio_transcript.delta") {
        const d = (obj as { delta?: string }).delta;
        if (typeof d === "string") {
          if (result.firstAiTextMs === null) {
            result.firstAiTextMs = Date.now() - startedAt;
          }
          result.responseText += d;
        }
      } else if (
        type === "conversation.item.input_audio_transcription.completed"
      ) {
        const t = (obj as { transcript?: string }).transcript;
        if (typeof t === "string") result.userTranscriptEcho = t;
      } else if (
        type === "response.output_audio.done" ||
        type === "response.audio.done"
      ) {
        if (result.aiAudioDoneMs === null) {
          result.aiAudioDoneMs = Date.now() - startedAt;
        }
      } else if (type === "response.done") {
        finish("response.done");
      } else if (type === "error") {
        const err = (obj as { error?: { message?: string; code?: string } }).error;
        result.errorCode = err?.code ?? "API_ERROR";
        result.errorMessage = err?.message ?? JSON.stringify(err ?? {});
        finish("error_event");
      }
    });

    ws.on("close", () => {
      if (!responseDone) finish("ws_closed");
    });

    ws.on("error", (err) => {
      if (!result.errorCode) {
        result.errorCode = "WS_ERROR";
        result.errorMessage = err.message;
      }
      finish("ws_error");
    });
  });
}

async function main(): Promise<void> {
  const llmTextDir = resolve(RUN_DIR, "llm-text");
  const audioDir = resolve(RUN_DIR, "grok-voice-batch");
  await mkdir(llmTextDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });

  const cases = qualityLatencyCases.slice(0, CASE_LIMIT);
  console.info(`[grok-voice-batch] running ${cases.length} cases`);
  console.info(`  model:      ${MODEL}`);
  console.info(`  xai voice:  ${VOICE}`);
  console.info(`  tts voice:  ${TTS_VOICE} (${TTS_MODEL})`);
  console.info(`  output:     ${audioDir}`);
  console.info("");

  const summary: CaseResult[] = [];
  for (const c of cases) {
    process.stdout.write(`[${c.id}] ${c.userInput.slice(0, 30)}... `);
    const r = await runOneCase({
      caseId: c.id,
      category: c.category,
      userInput: c.userInput,
      outputDir: audioDir,
    });
    if (!r.errorCode && r.responseText.length === 0 && r.aiAudioPath) {
      try {
        const { readFile } = await import("node:fs/promises");
        const wavBuf = await readFile(r.aiAudioPath);
        const pcmOnly = wavBuf.subarray(44);
        const transcript = await transcribeWithWhisper(pcmOnly);
        r.responseText = transcript.trim();
      } catch (e) {
        r.errorMessage =
          (r.errorMessage ?? "") +
          ` whisper-fallback-failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    summary.push(r);
    if (r.errorCode) {
      console.info(`ERROR ${r.errorCode}: ${r.errorMessage}`);
    } else {
      console.info(
        `done firstAudio=${r.firstAiAudioMs ?? "-"}ms total=${r.totalSessionMs}ms text=${r.responseText.slice(0, 40)}...`
      );
    }

    // Save schema-compatible llm-text json so my rubric scoring can read it
    // exactly like the other models' files.
    const slug = "xai-grok-voice-think-fast-1-0";
    const fname = `${slug}__${c.id}__r01.json`;
    await writeFile(
      resolve(llmTextDir, fname),
      JSON.stringify(
        {
          model: "xai:grok-voice-think-fast-1.0",
          caseId: c.id,
          repeatIndex: 1,
          responseText: r.responseText,
          userTranscriptEcho: r.userTranscriptEcho,
          firstAiAudioMs: r.firstAiAudioMs,
          firstAiTextMs: r.firstAiTextMs,
          aiAudioDoneMs: r.aiAudioDoneMs,
          totalSessionMs: r.totalSessionMs,
          userAudioPath: r.userAudioPath,
          aiAudioPath: r.aiAudioPath,
          errorCode: r.errorCode,
          errorMessage: r.errorMessage,
        },
        null,
        2
      )
    );
  }

  // Save batch summary CSV
  const summaryPath = resolve(audioDir, "batch-summary.csv");
  const header =
    "caseId,category,userInput,userTranscriptEcho,responseText,firstAiAudioMs,firstAiTextMs,aiAudioDoneMs,totalSessionMs,errorCode,errorMessage";
  const rows = summary.map((r) => {
    const escape = (s: string) => `"${s.replace(/"/g, '""').replace(/\n/g, " ")}"`;
    return [
      r.caseId,
      r.category,
      escape(r.userInput),
      escape(r.userTranscriptEcho),
      escape(r.responseText),
      r.firstAiAudioMs ?? "",
      r.firstAiTextMs ?? "",
      r.aiAudioDoneMs ?? "",
      r.totalSessionMs,
      r.errorCode,
      escape(r.errorMessage),
    ].join(",");
  });
  await writeFile(summaryPath, [header, ...rows].join("\n") + "\n");

  const successCount = summary.filter((r) => !r.errorCode).length;
  console.info("");
  console.info(`[grok-voice-batch] done: ${successCount}/${summary.length} success`);
  console.info(`  summary: ${summaryPath}`);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
