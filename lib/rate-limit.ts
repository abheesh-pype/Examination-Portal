import { NextResponse } from "next/server";

// In-memory fixed-window limiter. Counters are per server process, so a deployment with
// several instances should also limit at the load balancer or edge.
type RateLimitWindow = { count: number; resetAt: number };

type RateLimitRule = { limit: number; windowMs: number };

type GlobalWithRateLimits = typeof globalThis & {
  umsExamRateLimits?: Map<string, RateLimitWindow>;
};

const globalWithRateLimits = globalThis as GlobalWithRateLimits;
const windows = globalWithRateLimits.umsExamRateLimits ?? new Map<string, RateLimitWindow>();
globalWithRateLimits.umsExamRateLimits = windows;

const MAX_TRACKED_KEYS = 50_000;

export const rateLimitRules = {
  // Many students may share one exam-hall IP, so the per-IP login limit is generous and a
  // much tighter limit applies per IP + account identifier to stop credential guessing.
  loginPerIp: { limit: 300, windowMs: 60_000 },
  loginPerAccount: { limit: 10, windowMs: 15 * 60_000 },
  tokenPerIp: { limit: 30, windowMs: 60_000 },
  integrationPerIp: { limit: 600, windowMs: 60_000 },
  launchPerIp: { limit: 120, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

function pruneExpired(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export function getClientAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Counts one hit against the bucket and returns a 429 response once the limit is exceeded. */
export function consumeRateLimit(bucket: string, rule: RateLimitRule, message?: string) {
  const now = Date.now();
  if (windows.size > MAX_TRACKED_KEYS) pruneExpired(now);
  let window = windows.get(bucket);
  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + rule.windowMs };
    windows.set(bucket, window);
  }
  window.count += 1;
  if (window.count <= rule.limit) return null;
  const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
  return NextResponse.json(
    message ? { error: message } : { ok: false, error: "rate_limited", error_description: "Too many requests. Try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export function resetRateLimits() {
  windows.clear();
}
