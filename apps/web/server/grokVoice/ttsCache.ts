import { createHash } from "node:crypto";
import { getFirestoreAdmin } from "@top-performer/firestore";
import {
  GROK_VOICE_TTS_CODEC,
  GROK_VOICE_TTS_LANGUAGE,
  GROK_VOICE_TTS_MIME_TYPE,
  GROK_VOICE_TTS_REQUEST_SHAPE_VERSION,
  type GrokVoiceTtsPurpose,
  type GrokVoiceTtsResult,
} from "./tts";

export type GrokVoiceTtsCacheInput = {
  text: string;
  voiceId: string;
  sampleRateHz: number;
  purpose: GrokVoiceTtsPurpose;
};

export type GrokVoiceTtsCacheEntry = {
  cacheKey: string;
  cacheKeyHash: string;
  textHash: string;
  voiceId: string;
  sampleRateHz: number;
  codec: typeof GROK_VOICE_TTS_CODEC;
  language: typeof GROK_VOICE_TTS_LANGUAGE;
  mimeType: typeof GROK_VOICE_TTS_MIME_TYPE;
  audioBase64: string;
  audioBytes: number;
  createdAt: string;
  vendorMs: number | null;
  xaiTtsRequestShapeVersion: string;
};

const COLLECTION = "grok_voice_tts_cache";
const FIRESTORE_DOC_SIZE_CAP_BYTES = 900_000;
const DEFAULT_FIRESTORE_READ_TIMEOUT_MS = 250;
const memoryCache = new Map<string, GrokVoiceTtsCacheEntry>();

export function buildGrokVoiceTtsCacheKey(input: GrokVoiceTtsCacheInput) {
  const textHash = hash(input.text);
  const cacheKey = JSON.stringify({
    textHash,
    voiceId: input.voiceId,
    sampleRateHz: input.sampleRateHz,
    codec: GROK_VOICE_TTS_CODEC,
    language: GROK_VOICE_TTS_LANGUAGE,
    xaiTtsRequestShapeVersion: GROK_VOICE_TTS_REQUEST_SHAPE_VERSION,
  });
  const cacheKeyHash = hash(cacheKey);
  return { cacheKey, cacheKeyHash, textHash };
}

export async function getCachedGrokVoiceTts(input: {
  text: string;
  voiceId: string;
  sampleRateHz: number;
  purpose: GrokVoiceTtsPurpose;
  firestoreTimeoutMs?: number;
}): Promise<GrokVoiceTtsCacheEntry | null> {
  const { cacheKeyHash } = buildGrokVoiceTtsCacheKey(input);
  const memoryHit = memoryCache.get(cacheKeyHash);
  if (memoryHit) return memoryHit;

  const timeoutMs =
    input.firestoreTimeoutMs ?? DEFAULT_FIRESTORE_READ_TIMEOUT_MS;
  if (process.env["GROK_VOICE_TTS_CACHE_DISABLE_FIRESTORE"] === "true") {
    return null;
  }
  try {
    const firestoreEntry = await withTimeout(readFirestoreCache(cacheKeyHash), timeoutMs);
    if (!firestoreEntry) return null;
    memoryCache.set(cacheKeyHash, firestoreEntry);
    return firestoreEntry;
  } catch {
    return null;
  }
}

export function saveGrokVoiceTtsCache(input: {
  text: string;
  purpose: GrokVoiceTtsPurpose;
  result: GrokVoiceTtsResult;
}): void {
  const audioBase64 = input.result.audio.toString("base64");
  const audioBytes = input.result.audio.byteLength;
  const { cacheKey, cacheKeyHash, textHash } = buildGrokVoiceTtsCacheKey({
    text: input.text,
    voiceId: input.result.voiceId,
    sampleRateHz: input.result.sampleRateHz,
    purpose: input.purpose,
  });
  const entry: GrokVoiceTtsCacheEntry = {
    cacheKey,
    cacheKeyHash,
    textHash,
    voiceId: input.result.voiceId,
    sampleRateHz: input.result.sampleRateHz,
    codec: input.result.codec,
    language: input.result.language,
    mimeType: input.result.mimeType,
    audioBase64,
    audioBytes,
    createdAt: new Date().toISOString(),
    vendorMs: input.result.vendorMs,
    xaiTtsRequestShapeVersion: input.result.xaiTtsRequestShapeVersion,
  };
  memoryCache.set(cacheKeyHash, entry);

  if (JSON.stringify(entry).length > FIRESTORE_DOC_SIZE_CAP_BYTES) {
    return;
  }
  if (process.env["GROK_VOICE_TTS_CACHE_DISABLE_FIRESTORE"] === "true") {
    return;
  }
  void writeFirestoreCache(entry).catch(() => undefined);
}

export function clearGrokVoiceTtsMemoryCache() {
  memoryCache.clear();
}

export function seedGrokVoiceTtsMemoryCache(entry: GrokVoiceTtsCacheEntry) {
  memoryCache.set(entry.cacheKeyHash, entry);
}

async function readFirestoreCache(
  cacheKeyHash: string
): Promise<GrokVoiceTtsCacheEntry | null> {
  const db = getTtsCacheFirestore();
  const snap = await db.collection(COLLECTION).doc(cacheKeyHash).get();
  if (!snap.exists) return null;
  const data = snap.data() as Partial<GrokVoiceTtsCacheEntry> | undefined;
  if (!isCacheEntry(data)) return null;
  return data;
}

async function writeFirestoreCache(entry: GrokVoiceTtsCacheEntry) {
  const db = getTtsCacheFirestore();
  await db.collection(COLLECTION).doc(entry.cacheKeyHash).set(entry, { merge: true });
}

function getTtsCacheFirestore() {
  return getFirestoreAdmin({
    ...(process.env["FIREBASE_PROJECT_ID"]
      ? { projectId: process.env["FIREBASE_PROJECT_ID"] }
      : process.env["GOOGLE_CLOUD_PROJECT"]
        ? { projectId: process.env["GOOGLE_CLOUD_PROJECT"] }
        : process.env["GCLOUD_PROJECT"]
          ? { projectId: process.env["GCLOUD_PROJECT"] }
          : {}),
  });
}

function isCacheEntry(value: Partial<GrokVoiceTtsCacheEntry> | undefined): value is GrokVoiceTtsCacheEntry {
  return (
    !!value &&
    typeof value.cacheKey === "string" &&
    typeof value.cacheKeyHash === "string" &&
    typeof value.textHash === "string" &&
    typeof value.voiceId === "string" &&
    typeof value.sampleRateHz === "number" &&
    value.codec === GROK_VOICE_TTS_CODEC &&
    value.language === GROK_VOICE_TTS_LANGUAGE &&
    value.mimeType === GROK_VOICE_TTS_MIME_TYPE &&
    typeof value.audioBase64 === "string" &&
    typeof value.audioBytes === "number" &&
    typeof value.createdAt === "string" &&
    value.xaiTtsRequestShapeVersion === GROK_VOICE_TTS_REQUEST_SHAPE_VERSION
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("grok voice tts cache read timed out"));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
