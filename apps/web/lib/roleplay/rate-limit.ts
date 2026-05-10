type HitBucket = {
  minute: number[];
  hour: number[];
};

const buckets = new Map<string, HitBucket>();

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export function checkSessionTokenRateLimit(
  key: string,
  now = Date.now()
): RateLimitResult {
  const bucket = buckets.get(key) ?? { minute: [], hour: [] };
  const minuteWindow = now - 60_000;
  const hourWindow = now - 60 * 60_000;
  bucket.minute = bucket.minute.filter((value) => value > minuteWindow);
  bucket.hour = bucket.hour.filter((value) => value > hourWindow);

  if (bucket.minute.length >= 3 || bucket.hour.length >= 30) {
    buckets.set(key, bucket);
    const oldest = bucket.minute.length >= 3 ? bucket.minute[0] : bucket.hour[0];
    const windowMs = bucket.minute.length >= 3 ? 60_000 : 60 * 60_000;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(((oldest ?? now) + windowMs - now) / 1000)),
    };
  }

  bucket.minute.push(now);
  bucket.hour.push(now);
  buckets.set(key, bucket);
  return { allowed: true };
}

// Relaxed bucket for strict-sanitized-playback reseeds. A reseed only fires
// when a stock suffix was detected; bursting them is the legitimate symptom
// of a model that got into a closing-suffix loop. We allow more attempts per
// hour but still cap to avoid a runaway loop overwhelming the ephemeral-token
// endpoint. Bucket key is independent so reseed and fresh-session quota don't
// share state.
const reseedBuckets = new Map<string, HitBucket>();

export function checkSessionReseedRateLimit(
  key: string,
  now = Date.now()
): RateLimitResult {
  const bucket = reseedBuckets.get(key) ?? { minute: [], hour: [] };
  const minuteWindow = now - 60_000;
  const hourWindow = now - 60 * 60_000;
  bucket.minute = bucket.minute.filter((value) => value > minuteWindow);
  bucket.hour = bucket.hour.filter((value) => value > hourWindow);

  if (bucket.minute.length >= 10 || bucket.hour.length >= 60) {
    reseedBuckets.set(key, bucket);
    const oldest = bucket.minute.length >= 10 ? bucket.minute[0] : bucket.hour[0];
    const windowMs = bucket.minute.length >= 10 ? 60_000 : 60 * 60_000;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(((oldest ?? now) + windowMs - now) / 1000)),
    };
  }

  bucket.minute.push(now);
  bucket.hour.push(now);
  reseedBuckets.set(key, bucket);
  return { allowed: true };
}

export function resetSessionTokenRateLimit() {
  buckets.clear();
  reseedBuckets.clear();
}

export function buildRateLimitKey(ip: string, accessSignature: string | undefined) {
  return `${ip}:${accessSignature ?? "anonymous"}`;
}
