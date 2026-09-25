"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { vly } from "../lib/vly-integrations";

/**
 * Delivers one email through the best available provider:
 *  1. Resend — when RESEND_API_KEY is configured (own domain/sender).
 *  2. The platform's built-in email gateway — zero config, key is
 *     injected automatically on Freebuff (VLY_INTEGRATION_KEY).
 *
 * Used by single outreach sends (messages.sendEmail) and campaigns.
 */
export type DeliveryResult = {
  provider: "resend" | "built-in";
  providerId: string | null;
};

export const deliverEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  handler: async (_ctx, { to, subject, text }): Promise<DeliveryResult> => {
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

    // Built-in gateway — no API key required.
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
