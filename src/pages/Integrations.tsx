import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Bot, CheckCircle2, Circle, Mail, Plug, Send, Sparkles } from "lucide-react";
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

  const integrations: IntegrationRow[] = [
    {
      icon: Send,
      name: "Email sending — built-in gateway",
      status: "live",
      description:
        "Sends your outreach emails for real — single messages and full campaigns, straight from DealFlow AI.",
      how: "Uses the platform's built-in email service. Zero setup — the key is injected automatically and usage is billed to your workspace.",
    },
    {
      icon: Send,
      name: "Resend — bring your own sender",
      status: "keys-needed",
      envVar: "RESEND_API_KEY",
      description:
        "Optional upgrade: deliver from your own verified domain instead of the built-in gateway.",
      how: "Set a RESEND_API_KEY environment variable (plus RESEND_FROM_EMAIL for a custom sender). When present, every send automatically routes through Resend.",
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

      <div className="space-y-3">
        {integrations.map((row) => (
          <div
            key={row.name}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-start"
          >
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-md",
                row.status === "live"
                  ? "bg-[#D4FF4F]/15 text-[#5c7a00]"
                  : "bg-muted text-muted-foreground",
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
                      ? "bg-[#D4FF4F] text-[#191918]"
                      : "bg-secondary text-secondary-foreground",
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
        <Plug className="mt-0.5 size-4 shrink-0" />
        <p>
          The built-in email gateway and AI assistant work out of the box — no keys needed. Optional
          keys (Resend, OpenAI) are set as environment variables and read server-side; they are never
          exposed in the client bundle (the OpenAI key is the one exception by design and stays
          browser-side for direct calls). Gmail, Outlook, LinkedIn and calendar sync remain on the
          roadmap; the copy-and-send flow covers them today.
        </p>
      </div>

      <Button asChild variant="outline" className="mt-4">
        <Link to="/leads">Back to leads</Link>
      </Button>
    </AppShell>
  );
}
