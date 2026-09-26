import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ── Shared motion — consistent feel app-wide ─────────────────────────────── */
export const SPRING = { type: "spring", stiffness: 380, damping: 32, mass: 0.9 } as const;
export const SPRING_SOFT = { type: "spring", stiffness: 220, damping: 26 } as const;
export const PAGE_ENTER = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
} as const;

/* ── TiltCard: flat workspace card, 1–2px hover lift ──────────────────────── */
export function TiltCard({
  children,
  className,
  lift = 2,
  interactive = true,
}: {
  children: ReactNode;
  className?: string;
  maxTilt?: number;
  lift?: number;
  interactive?: boolean;
}) {
  const reduced = useReducedMotion();
  const active = interactive && !reduced;
  const y = useMotionValue(0);
  const sy = useSpring(y, SPRING);

  return (
    <motion.div
      onMouseEnter={() => active && y.set(-lift)}
      onMouseLeave={() => y.set(0)}
      style={{ y: sy }}
      className={cn("depth-card depth-card-hover rounded-lg border border-border bg-card", className)}
    >
      {children}
    </motion.div>
  );
}

/* ── AIButton: muted plum, cream text — AI is a capability, not an identity ── */
export function AIButton({
  children,
  onClick,
  disabled,
  className,
  size = "default",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  size?: "default" | "sm";
}) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled || reduced ? undefined : { y: -1 }}
      whileTap={disabled || reduced ? undefined : { y: 0, scale: 0.99 }}
      transition={SPRING}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-[#6f4b5e] font-medium text-[#f5f0e6] transition-colors hover:bg-[#5d3e4e]",
        size === "default" ? "h-9 px-4 text-sm" : "h-7 px-2.5 text-xs",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

/* ── LeadScoreRing: 0 → score animation ──────────────────────────────────── */
export function LeadScoreRing({
  score,
  size = 84,
  stroke = 7,
  label = "Lead score",
  breakdown,
}: {
  score: number;
  size?: number;
  stroke?: number;
  label?: string;
  breakdown?: { label: string; value: number }[];
}) {
  const reduced = useReducedMotion();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = useMotionValue(0);
  const dash = useTransform(progress, (v) => circumference * (v / 100));

  useEffect(() => {
    progress.set(reduced ? score : 0);
    if (!reduced) {
      const controls = setTimeout(() => progress.set(score), 150);
      return () => clearTimeout(controls);
    }
  }, [score, progress, reduced]);

  return (
    <div className="flex items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e4ddcf" strokeWidth={stroke} />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#6f4b5e"
            strokeWidth={stroke}
            strokeLinecap="round"
            style={{ strokeDasharray: circumference, strokeDashoffset: dash }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-lg font-semibold leading-none">{score}</span>
          <span className="text-[9px] text-muted-foreground">/100</span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {breakdown && breakdown.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {breakdown.slice(0, 4).map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-[10px] text-muted-foreground">{b.label}</span>
                <div className="h-1 w-20 overflow-hidden rounded-full bg-[#e4ddcf]">
                  <motion.div
                    className="h-full rounded-full bg-[#6f4b5e]"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, b.value)}%` }}
                    transition={{ ...SPRING_SOFT, delay: 0.15 }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── FloatingSidePanel: right-side panel, workspace stays visible ────────── */
export function FloatingSidePanel({
  open,
  onClose,
  title,
  children,
  width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={false}
      animate={{ opacity: open ? 1 : 0, pointerEvents: open ? ("auto" as const) : ("none" as const) }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-[#171613]/25"
      onClick={onClose}
      aria-hidden={!open}
    >
      <motion.aside
        role="dialog"
        aria-modal="true"
        initial={false}
        animate={open ? { x: 0, opacity: 1 } : { x: "102%", opacity: reduced ? 1 : 0.6 }}
        transition={SPRING_SOFT}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "depth-immersive absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-card",
          width,
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="min-w-0 truncate text-sm font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </motion.aside>
    </motion.div>
  );
}

/* ── AIGenerationStages: calm text transitions, no effects ────────────────── */
const DEFAULT_STAGES = [
  "Researching lead",
  "Analyzing context",
  "Writing opening",
  "Polishing message",
];

export function AIGenerationStages({
  stages = DEFAULT_STAGES,
  done = false,
  doneLabel = "Ready.",
}: {
  stages?: string[];
  done?: boolean;
  doneLabel?: string;
}) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduced || done) return;
    const t = setInterval(() => {
      setStep((s) => (s < stages.length - 1 ? s + 1 : s));
    }, 620);
    return () => clearInterval(t);
  }, [reduced, done, stages.length]);

  useEffect(() => {
    if (done) setStep(stages.length);
  }, [done, stages.length]);

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="label-caps text-[#6f4b5e]">Drafting with AI</p>
      <ul className="mt-2.5 space-y-1.5">
        {stages.map((s, i) => (
          <li
            key={s}
            className={cn(
              "text-[13px] transition-opacity duration-300",
              i < step ? "text-muted-foreground" : i === step ? "text-foreground" : "opacity-40",
            )}
          >
            {s}
          </li>
        ))}
        {done && (
          <li className="stage-enter text-[13px] font-medium text-[#53634a]">✓ {doneLabel}</li>
        )}
      </ul>
    </div>
  );
}

/* ── SpatialPage: soft entrance ──────────────────────────────────────────── */
export function SpatialPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div {...PAGE_ENTER} className={className}>
      {children}
    </motion.div>
  );
}

/* ── AIInsightCard: lead intelligence — quiet plum-ruled card ─────────────── */
export function AIInsightCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ai-gradient-border rounded-lg p-4", className)}>
      <p className="label-caps mb-2 text-[#6f4b5e]">{title}</p>
      {children}
    </div>
  );
}
