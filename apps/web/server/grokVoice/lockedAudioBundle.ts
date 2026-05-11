// PR B — locked-response audio prebundle assembler.
//
// Builds the optional `lockedResponseAudioBundle` field surfaced by
// `/api/v3/session`. The bundle carries pre-synthesized canonical audio
// for the most frequently-hit PR60 deterministic locks, so the client
// can play locked-voice turns from a local Map instead of paying an
// HTTP roundtrip to `/api/v3/locked-response-tts` after each STT
// confirmation.
//
// Strict contract:
//   - Read-only against the shared TTS cache. NEVER synthesize on the
//     session-bootstrap path — that would add seconds to every new
//     session and turn the latency win into a latency loss.
//   - Cache miss → omit the entry from the bundle. The warm-cache
//     hook landed in PR #84 already keeps prod hit rate >95% on the
//     canonical set, so the typical session bundles 100% of the
//     priority canonicals.
//   - Firestore timeout is bounded; a slow Firestore must not block
//     session bootstrap.
//   - Max entries is bounded by env (default 8) so the response stays
//     under ~3MB on worst case.
//
// PR B keeps the client behavior conservative: a voice turn whose
// canonical is NOT in the bundle falls back to the existing
// `lock_voice_network_tts` path. Future PRs (or an env flip to
// `GROK_VOICE_VOICE_LOCK_POLICY=local_audio_only`) can change that
// fallback policy without re-deploying the client.

import { getAllPr60LockedResponses } from "../../lib/roleplay/grok-voice-pr60-shared";
import {
  getCachedGrokVoiceTts,
  type GrokVoiceTtsCacheEntry,
} from "./ttsCache";

// Default priority order. Production traffic on `staffing_order_hearing`
// hits the first ~8 most often (募集背景 / 業務内容 / 件数 / 単価 /
// broad-skill / 人柄 / 開始時期 / 繁忙時期). The list mirrors
// `PR60_LOCKED_RESPONSES` in `grok-voice-pr60-shared.ts` ordering.
const DEFAULT_BUNDLE_PRIORITY: readonly string[] = [
  // 業務内容 lock (#78) — highest-volume business factual response
  "じゅはっちゅうや納期調整まわりの営業事務です。",
  // 件数 lock (#74)
  "つきあたり、ろっぴゃく件から、ななひゃっけん程度です。",
  // broad initial skill lock (#75)
  "じゅはっちゅう経験と対外調整の経験がある方を優先的に見ています。",
  // 単価 lock — kanji form (legacy path; deterministic mode uses the
  // kana form via registered-speech bundle instead).
  "請求想定は経験により、千七百五十円から、千九百円程度です。",
  // 募集背景 lock
  "増員です。受注処理が増えてきています。",
  // 人柄 lock
  "周囲と合わせて進められるタイプが合いやすく、自分のやり方にこだわりすぎる方は合いにくいです。",
  // 開始時期 lock
  "開始は六月ついたちを希望しています。",
  // 繁忙時期 lock
  "月のおわりと月の初め、月曜日の午前中、商品が切り替わる時期に負荷が上がります。",
];

export type LockedAudioBundleEntry = {
  // The canonical spoken text (voice-friendly normalized form). The
  // client uses this as the lookup key — it matches the output of
  // `getPr60LockedResponseForUser()` exactly.
  spokenText: string;
  audioBase64: string;
  audioBytes: number;
  cacheStatus: "hit";
  cacheKeyHash: string;
  vendorMsAtCreation: number | null;
};

export type LockedAudioBundle = {
  // Bundle schema version. Bumped when entry shape changes so the
  // client can ignore older shapes.
  version: "v1";
  voiceId: string;
  sampleRateHz: number;
  codec: "pcm";
  entries: LockedAudioBundleEntry[];
};

export type AssembleLockedAudioBundleInput = {
  voiceId: string;
  sampleRateHz: number;
  maxEntries: number;
  firestoreTimeoutMs?: number;
};

export type AssembleLockedAudioBundleResult = {
  bundle: LockedAudioBundle;
  // Set of canonical spoken-text strings we ATTEMPTED to load but did
  // not find in cache. Logged for warm-cache observability — a high
  // miss count means the warm hook is broken or the canonical text
  // changed without re-warming.
  missedSpokenTexts: string[];
  attemptedSpokenTexts: string[];
};

// Build the priority-ordered candidate list. Always starts from the
// hardcoded `DEFAULT_BUNDLE_PRIORITY`, then includes any other
// PR60 canonical that isn't already listed (so newly-added locks
// automatically get cached audio if cache-hit). This keeps the bundle
// stable across PR60 catalog growth without manual maintenance.
function buildCandidateList(): string[] {
  const all = getAllPr60LockedResponses();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of DEFAULT_BUNDLE_PRIORITY) {
    if (all.includes(text) && !seen.has(text)) {
      out.push(text);
      seen.add(text);
    }
  }
  for (const text of all) {
    if (!seen.has(text)) {
      out.push(text);
      seen.add(text);
    }
  }
  return out;
}

export async function assembleLockedAudioBundle(
  input: AssembleLockedAudioBundleInput
): Promise<AssembleLockedAudioBundleResult> {
  const { voiceId, sampleRateHz, maxEntries, firestoreTimeoutMs } = input;
  const candidates = buildCandidateList().slice(0, maxEntries);
  const entries: LockedAudioBundleEntry[] = [];
  const missed: string[] = [];

  // Parallel cache lookups — they're all reading from the same Firestore
  // collection and the in-memory cache hits are synchronous after the
  // first miss. Bounded by `maxEntries` (default 8) so we are not
  // hammering Firestore on every session.
  const results = await Promise.all(
    candidates.map(async (spokenText) => {
      try {
        const cached = await getCachedGrokVoiceTts({
          text: spokenText,
          voiceId,
          sampleRateHz,
          purpose: "locked_response",
          ...(firestoreTimeoutMs !== undefined ? { firestoreTimeoutMs } : {}),
        });
        return { spokenText, cached };
      } catch {
        return { spokenText, cached: null as GrokVoiceTtsCacheEntry | null };
      }
    })
  );

  for (const { spokenText, cached } of results) {
    if (cached) {
      entries.push({
        spokenText,
        audioBase64: cached.audioBase64,
        audioBytes: cached.audioBytes,
        cacheStatus: "hit",
        cacheKeyHash: cached.cacheKeyHash,
        vendorMsAtCreation: cached.vendorMs ?? null,
      });
    } else {
      missed.push(spokenText);
    }
  }

  return {
    bundle: {
      version: "v1",
      voiceId,
      sampleRateHz,
      codec: "pcm",
      entries,
    },
    missedSpokenTexts: missed,
    attemptedSpokenTexts: candidates,
  };
}
