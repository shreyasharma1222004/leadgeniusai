/**
 * Campaign sending safety limits — production hardening §4.
 *
 * Dealflow AI sends REAL email through the user's own connected account
 * (Gmail SMTP → Resend → built-in gateway). These limits exist to protect
 * customers from accidental bulk sending and to protect the sender
 * reputation of the connected mailbox.
 *
 * All limits are CONFIGURABLE without code changes: the server action reads
 * these environment variables (set them via the platform's Keys/env UI):
 *   CAMPAIGN_MAX_BATCH         — max emails per "Send" click (default 20)
 *   CAMPAIGN_MAX_PER_DAY       — per-user real-email sends per UTC day (default 100)
 *   CAMPAIGN_THROTTLE_MS       — pause between individual sends (default 1200)
 *   CAMPAIGN_CONFIRM_THRESHOLD — pending recipients above which the UI demands
 *                                explicit confirmation (default 10)
 *
 * These are deliberately plain constants/env vars (no secrets), so they can
 * later be tied to subscription plans by resolving per-plan values at send
 * time — the UI already renders whatever the server resolves via
 * `api.campaigns.sendPreview`, so a plan change needs no frontend work.
 */

export interface SendLimits {
  /** Max recipients attempted per send invocation. */
  maxBatch: number;
  /** Per-user cap on real (non-manual) email sends per UTC day. */
  maxPerDay: number;
  /** Delay between individual sends, in milliseconds. */
  throttleMs: number;
  /** Pending count above which the UI requires explicit confirmation. */
  confirmThreshold: number;
}

export const DEFAULT_SEND_LIMITS: SendLimits = {
  maxBatch: 20,
  maxPerDay: 100,
  throttleMs: 1200,
  confirmThreshold: 10,
};

function num(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Resolve limits from a process-env-like record. Called server-side with
 * process.env; kept pure so it can be unit-tested and reused for per-plan
 * resolution later.
 */
export function resolveSendLimits(env: Record<string, string | undefined>): SendLimits {
  return {
    maxBatch: num(env["CAMPAIGN_MAX_BATCH"], DEFAULT_SEND_LIMITS.maxBatch, 1, 200),
    maxPerDay: num(env["CAMPAIGN_MAX_PER_DAY"], DEFAULT_SEND_LIMITS.maxPerDay, 1, 5000),
    throttleMs: num(env["CAMPAIGN_THROTTLE_MS"], DEFAULT_SEND_LIMITS.throttleMs, 0, 60_000),
    confirmThreshold: num(
      env["CAMPAIGN_CONFIRM_THRESHOLD"],
      DEFAULT_SEND_LIMITS.confirmThreshold,
      1,
      1000,
    ),
  };
}
