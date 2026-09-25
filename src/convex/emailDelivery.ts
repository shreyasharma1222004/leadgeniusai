"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { vly } from "../lib/vly-integrations";
import nodemailer from "nodemailer";

/**
 * Delivers one email through the best available provider:
 *  1. Gmail SMTP — when GMAIL_USER + GMAIL_APP_PASSWORD are set. Sends from
 *     the user's own Gmail address, which every inbox provider accepts:
 *     no custom domain, no DKIM/SPF setup required.
 *  2. Resend — when RESEND_API_KEY is configured. Fully unrestricted only
 *     with a verified domain; the sandbox (onboarding@resend.dev) can only
 *     deliver to the account owner's own email address.
 *  3. The platform's built-in email gateway — zero config, key is injected
 *     automatically on Freebuff (VLY_INTEGRATION_KEY).
 *
 * Used by single outreach sends (messages.sendEmail) and campaigns.
 */
export type DeliveryResult = {
  provider: "gmail" | "resend" | "built-in";
  providerId: string | null;
};

/**
 * Which provider the next send will use is exposed via settings.deliveryStatus
 * (queries can't live in "use node" modules). See src/convex/settings.ts.
 */
export const deliverEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    // Display name for Gmail's From header (e.g. the signed-in user's name).
    fromName: v.optional(v.string()),
  },
  handler: async (
    _ctx,
    { to, subject, text, fromName },
  ): Promise<DeliveryResult> => {
    // ── 1. Gmail SMTP — own address, sends to anyone, zero domain setup ──
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (gmailUser && gmailPass) {
      let info: { messageId?: string };
      try {
        const transport = nodemailer.createTransport({
          service: "gmail",
          auth: { user: gmailUser, pass: gmailPass },
        });
        info = await transport.sendMail({
          from: fromName ? `"${fromName.replace(/"/g, "")}" <${gmailUser}>` : gmailUser,
          to,
          subject,
          text,
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        if (/Invalid login|Username and Password not accepted|EAUTH|BadCredentials/i.test(raw)) {
          throw new Error(
            "Gmail rejected the login. Check GMAIL_USER and GMAIL_APP_PASSWORD in your Convex environment variables — the password must be a 16-character App Password (Google Account → Security → 2-Step Verification → App passwords), not your normal password.",
          );
        }
        throw new Error(`Gmail SMTP error: ${raw.slice(0, 250)}`);
      }
      return { provider: "gmail", providerId: info.messageId ?? null };
    }

    // ── 2. Resend — needs a verified domain for full delivery ────────────
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const from =
        process.env.RESEND_FROM_EMAIL ?? "DealFlow AI <onboarding@resend.dev>";
      let response: Response;
      try {
        response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to, subject, text }),
        });
      } catch {
        throw new Error(
          "Couldn't reach the email provider — check your connection and retry.",
        );
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `The email provider rejected this send (${response.status}). ${detail.slice(0, 200)}`,
        );
      }
      const payload = (await response.json().catch(() => ({}))) as { id?: string };
      return { provider: "resend" as const, providerId: payload.id ?? null };
    }

    // ── 3. Built-in gateway — no API key required ─────────────────────────
    const paragraphs = text
      .split(/\n{2,}/)
      .map(
        (p) =>
          `<p>${p
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br/>")}</p>`,
      )
      .join("");

    const result = await vly.email.send({
      to,
      subject,
      text,
      html: paragraphs,
    });
    if (!result.success) {
      throw new Error(
        result.error ?? "The built-in email gateway rejected this send.",
      );
    }
    return { provider: "built-in" as const, providerId: null };
  },
});
