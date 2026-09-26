import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import { DELIVERABILITY_TIPS } from "@/lib/outreach";
import { useQuery } from "convex/react";
import {
  Bot,
  CheckCircle2,
  Circle,
  Copy,
  KeyRound,
  Mail,
  Plug,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";

interface IntegrationRow {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  status: "live" | "keys-needed";
  envVar?: string;
  description: string;
  how: string;
}

export default function IntegrationsPage() {
  useAuth();
  const delivery = useQuery(api.settings.deliveryStatus, {});

  const gmailActive = delivery?.provider === "gmail";

  const integrations: IntegrationRow[] = [
    {
      icon: Mail,
      name: "Gmail — send to anyone, no domain",
      status: gmailActive ? "live" : "keys-needed",
      envVar: "GMAIL_USER + GMAIL_APP_PASSWORD",
      description: gmailActive
        ? `Connected. Your outreach now goes out from your own Gmail address (${delivery?.from ?? ""}) and can reach any recipient on any provider.`
        : "Connect your own Gmail account and DealFlow AI sends email as you — to anyone, on Gmail, Outlook, Yahoo or company addresses. No domain, no DNS records, nothing to buy.",
      how: "Uses Gmail's SMTP with an App Password Google issues for free. Recipients see your name and address, so replies land in your normal inbox.",
    },
    {
      icon: Send,
      name: "Resend — dedicated sender API",
      status: "keys-needed",
      envVar: "RESEND_API_KEY",
      description:
        "Optional upgrade for volume sending. Test mode delivers only to your own signup address; a verified domain lifts that limit.",
      how: "Set a RESEND_API_KEY environment variable (plus RESEND_FROM_EMAIL once your domain is verified). Sits behind Gmail in the delivery order, so it only applies when Gmail isn't configured.",
    },
    {
      icon: Sparkles,
      name: "OpenAI — GPT research briefs",
      status: "keys-needed",
      envVar: "VITE_OPENAI_API_KEY",
      description:
        "Upgrades lead analysis from the built-in heuristic engine to real GPT-4o-mini research briefs.",
      how: "Add the key and every new analysis is model-generated. Without it, the deterministic estimator still scores leads from your own data.",
    },
    {
      icon: Bot,
      name: "DealFlow Assistant",
      status: "live",
      description: "Built in — answers pipeline questions from your workspace data with no external calls.",
      how: "Open AI Assistant in the sidebar. It runs entirely on your Convex data.",
    },
    {
      icon: Mail,
      name: "Email OTP sign-in",
      status: "live",
      description: "Built in — passwordless auth through the platform's email provider.",
      how: "Already active on the sign-in page, alongside guest sessions.",
    },
  ];

  return (
    <AppShell title="Integrations">
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        What's connected, what a key unlocks, and exactly how each one behaves.
      </p>

      {/* Gmail setup guide — the no-domain path */}
      <section
        className={cn(
          "mb-6 rounded-lg border p-5",
          gmailActive ? "border-[#191713]/30 bg-[#f7f3ea]" : "border-border bg-card",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Mail className="size-5 text-foreground" />
          <h2 className="text-sm font-semibold">Send to anybody — connect your Gmail</h2>
          {gmailActive ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#191713]/40 bg-[#191713] px-2 py-0.5 text-[10px] font-medium text-[#f7f3ea]">
              <CheckCircle2 className="size-3" /> Connected as {delivery?.from}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
              <Circle className="size-3" /> Not connected
            </span>
          )}
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          No domain needed. Google gives every account free App Passwords; one
          minute of setup and every email you send from DealFlow AI goes out
          from your own address — reaching real prospects on Gmail, Outlook,
          Yahoo and company mailboxes alike.
        </p>

        {!gmailActive && (
          <ol className="mt-4 space-y-3">
            {[
              {
                title: "Turn on 2-Step Verification",
                body: (
                  <>
                    Go to{" "}
                    <a
                      className="font-medium text-foreground underline underline-offset-2"
                      href="https://myaccount.google.com/security"
                      target="_blank"
                      rel="noreferrer"
                    >
                      myaccount.google.com/security
                    </a>{" "}
                    and switch on 2-Step Verification if it isn't already.
                  </>
                ),
              },
              {
                title: "Create an App Password",
                body: (
                  <>
                    Visit{" "}
                    <a
                      className="font-medium text-foreground underline underline-offset-2"
                      href="https://myaccount.google.com/apppasswords"
                      target="_blank"
                      rel="noreferrer"
                    >
                      myaccount.google.com/apppasswords
                    </a>
                    , name it "DealFlow AI", and copy the 16-character password
                    Google shows you.
                  </>
                ),
              },
              {
                title: "Set two environment variables",
                body: (
                  <>
                    In your deployment's environment variables, add{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      GMAIL_USER
                    </code>{" "}
                    = your full Gmail address and{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      GMAIL_APP_PASSWORD
                    </code>{" "}
                    = the 16-character code. DealFlow AI picks them up on the
                    next send automatically.
                  </>
                ),
              },
              {
                title: "Send a test",
                body: "Compose outreach to any lead and hit Send — it should arrive from your Gmail address within seconds. Check the lead's thread if anything fails.",
              },
            ].map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-[#191713]/40 bg-[#191713] text-[11px] font-semibold text-[#f7f3ea]">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {gmailActive && (
          <p className="mt-3 text-xs text-muted-foreground">
            Every new send — single outreach and full campaigns — now routes
            through your Gmail. If a send ever fails, the exact Gmail error
            appears in the lead's thread.
          </p>
        )}
      </section>

      {/* Deliverability playbook */}
      <section className="mb-6 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-5 text-foreground" />
          <h2 className="text-sm font-semibold">Staying out of spam</h2>
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Read before scaling up
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Gmail delivers your email with proper signing (SPF/DKIM), so
          technical setup is already done. Whether a message lands in the inbox
          is decided by your sender reputation and how human it reads. These
          are the levers that actually move it:
        </p>
        <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {DELIVERABILITY_TIPS.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
              <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-[#8a7d63]" />
              {tip}
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-3">
        {integrations.map((row) => (
          <div
            key={row.name}
            className="depth-card-hover flex flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-colors sm:flex-row sm:items-start"
          >
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-md",
                row.status === "live"
                  ? "border border-[#191713]/40 bg-[#191713] text-[#f7f3ea]"
                  : "border border-border bg-secondary text-muted-foreground",
              )}
            >
              <row.icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{row.name}</p>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    row.status === "live"
                      ? "border border-[#191713]/40 bg-[#191713] text-[#f7f3ea]"
                      : "border border-border bg-secondary text-muted-foreground",
                  )}
                >
                  {row.status === "live" ? (
                    <>
                      <CheckCircle2 className="size-3" /> Active
                    </>
                  ) : (
                    <>
                      <Circle className="size-3" /> Add key to enable
                    </>
                  )}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{row.description}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
                <span className="font-medium text-foreground">How it works:</span> {row.how}
              </p>
              {row.envVar && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Environment variable:{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    {row.envVar}
                  </code>
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
        {gmailActive ? <Send className="mt-0.5 size-4 shrink-0" /> : <Copy className="mt-0.5 size-4 shrink-0" />}
        <p>
          {gmailActive ? (
            <>
              Gmail is your active sender, so Compose → Send delivers for real
              to any address. Copy message still works as a manual fallback.
            </>
          ) : (
            <>
              While Gmail isn't connected yet, the fastest way to work real
              prospects is Compose → <span className="font-medium text-foreground">Copy message</span> →
              paste into your Gmail → send manually — DealFlow AI logs the touch
              either way. Connecting Gmail upgrades that to one-click automated
              sending.
            </>
          )}
        </p>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
        <Plug className="mt-0.5 size-4 shrink-0" />
        <p>
          Keys are read server-side from environment variables and never exposed
          in the client bundle (the OpenAI key is the one exception by design
          and stays browser-side for direct calls). Gmail, Outlook and LinkedIn
          sync remain on the roadmap; the copy-and-send flow covers them today.
        </p>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
        <KeyRound className="mt-0.5 size-4 shrink-0" />
        <p>
          Security note: your Gmail App Password lives only in your deployment's
          environment variables — it's never stored in the database, never sent
          to the browser, and can be revoked any time from your Google account.
        </p>
      </div>

      <Button asChild variant="outline" className="mt-4">
        <Link to="/leads">Back to leads</Link>
      </Button>
    </AppShell>
  );
}
