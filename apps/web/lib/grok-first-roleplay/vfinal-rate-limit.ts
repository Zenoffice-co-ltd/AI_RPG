type Bucket = {
  resetAt: number;
  count: number;
};

const buckets = new Map<string, Bucket>();

export function checkVFinalRateLimit(input: {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = input.now ?? Date.now();
  const bucketKey = `${input.scope}:${input.key}`;
  const current = buckets.get(bucketKey);
  if (!current || current.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + input.windowMs });
    return { ok: true };
  }
  if (current.count >= input.limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  current.count += 1;
  return { ok: true };
}

export function clearVFinalRateLimitForTests() {
  buckets.clear();
}
