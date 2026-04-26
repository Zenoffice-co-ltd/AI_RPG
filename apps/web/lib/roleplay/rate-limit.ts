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

export function resetSessionTokenRateLimit() {
  buckets.clear();
}

export function buildRateLimitKey(ip: string, accessSignature: string | undefined) {
  return `${ip}:${accessSignature ?? "anonymous"}`;
}
