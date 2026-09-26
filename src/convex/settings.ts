import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Which provider the next send will use — powers the Integrations page.
 * Lives here (not in emailDelivery.ts) because only actions may run in
 * "use node" modules.
 *
 * Production hardening §6: this query previously had NO auth check and
 * returned the Gmail sender address to any caller, including anonymous
 * ones. It now requires a signed-in user; unauthenticated callers only
 * ever get the neutral built-in shape (from: null) and never see the
 * configured sender address or provider credentials.
 */
export const deliveryStatus = query({
  args: {},
  handler: async (ctx) => {
    const NEUTRAL = {
      provider: "built-in" as const,
      from: null,
      domainRequired: false,
    };
    const userId = await getAuthUserId(ctx);
    if (userId === null) return NEUTRAL;
    // Single-workspace deployment: email credentials are deployment-level
    // (platform env), so every authenticated workspace member sees the same
    // status — but only after authentication.
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      return {
        provider: "gmail" as const,
        from: process.env.GMAIL_USER,
        domainRequired: false,
      };
    }
    if (process.env.RESEND_API_KEY) {
      return {
        provider: "resend" as const,
        from: process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev",
        domainRequired: !process.env.RESEND_FROM_EMAIL,
      };
    }
    return NEUTRAL;
  },
});

/**
 * Sender identity used for Gmail SMTP delivery. The actual credentials live
 * in Convex environment variables (GMAIL_USER + GMAIL_APP_PASSWORD) — never
 * in the database. Here we store only the display name that goes on the
 * From header, so recipients see "Rahul Sharma <you@gmail.com>".
 */
export const getSenderProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    return {
      senderName: user?.company ?? user?.name ?? "",
      email: user?.email ?? null,
      // Mirrors emailDelivery.deliveryStatus — duplicated client-side for a
      // single-round-trip settings view.
      gmailConnected: Boolean(
        process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD,
      ),
    };
  },
});

/** Update the From display name used when Dealflow AI sends via Gmail. */
export const setSenderName = mutation({
  args: { senderName: v.string() },
  handler: async (ctx, { senderName }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const trimmed = senderName.trim();
    await ctx.db.patch(userId, { company: trimmed || undefined });
    return { senderName: trimmed };
  },
});
