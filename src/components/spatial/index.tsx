import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Shared spring physics — consistent feel app-wide ─────────────────────── */
export const SPRING = { type: "spring", stiffness: 380, damping: 32, mass: 0.9 } as const;
export const SPRING_SOFT = { type: "spring", stiffness: 220, damping: 26 } as const;
export const PAGE_ENTER = {
  initial: { opacity: 0, y: 14, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
} as const;

/* ── TiltCard: Layer-2 card with 1–2° cursor parallax ─────────────────────── */
export function TiltCard({
  children,
  className,
  maxTilt = 1.6,
  lift = 5,
  interactive = true,
}: {
  children: ReactNode;
  className?: string;
  maxTilt?: number;
  lift?: number;
  interactive?: boolean;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const active = interactive && !reduced;

  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const sx = useSpring(mx, SPRING);
  const sy = useSpring(my, SPRING);
  const rotateY = useTransform(sx, [0, 1], [-maxTilt, maxTilt]);
  const rotateX = useTransform(sy, [0, 1], [maxTilt, -maxTilt]);
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      ref={ref}
      onMouseMove={(e) => {
        if (!active || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width);
        my.set((e.clientY - r.top) / r.height);
      }}
      onMouseEnter={() => active && setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        mx.set(0.5);
        my.set(0.5);
      }}
      animate={{ y: hovered ? -lift : 0 }}
      style={
        active
          ? { rotateX, rotateY, transformPerspective: 900, transformStyle: "preserve-3d" }
          : undefined
      }
      transition={SPRING}
      className={cn("depth-card depth-card-hover rounded-xl border border-border bg-card", className)}
    >
      {children}
    </motion.div>
  );
}

/* ── AIButton: violet glow + subtle pulsing Sparkles ─────────────────────── */
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
      whileHover={disabled || reduced ? undefined : { y: -2 }}
      whileTap={disabled || reduced ? undefined : { y: 0, scale: 0.98 }}
      transition={SPRING}
      className={cn(
        "glow-primary inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-[#8B5CF6]/60 bg-[#8B5CF6] font-medium text-white transition-colors hover:bg-[#7C4DF0]",
        size === "default" ? "h-9 px-4 text-sm" : "h-7 px-2.5 text-xs",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <Sparkles className={cn("size-3.5 shrink-0", !reduced && "ai-pulse")} />
      {children}
    </motion.button>
  );
}

/* ── LeadScoreRing: 0 → score spring animation ───────────────────────────── */
export function LeadScoreRing({
  score,
  size = 84,
  stroke = 7,
  label = "High potential",
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
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="url(#score-gradient)"
            strokeWidth={stroke}
            strokeLinecap="round"
            style={{ strokeDasharray: circumference, strokeDashoffset: dash }}
          />
          <defs>
            <linearGradient id="score-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#8B5CF6" />
              <stop offset="100%" stopColor="#A855F7" />
            </linearGradient>
          </defs>
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
                <div className="h-1 w-20 overflow-hidden rounded-full bg-white/8">
                  <motion.div
                    className="h-full rounded-full bg-[#8B5CF6]"
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

/* ── FloatingSidePanel: Layer-4/5 glass panel from the right ─────────────── */
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
      transition={{ duration: 0.22 }}
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px]"
      onClick={onClose}
      aria-hidden={!open}
    >
      <motion.aside
        role="dialog"
        aria-modal="true"
        initial={false}
        animate={open ? { x: 0, scale: 1, opacity: 1 } : { x: "102%", scale: 0.985, opacity: reduced ? 1 : 0.6 }}
        transition={SPRING_SOFT}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "depth-immersive absolute inset-y-0 right-0 flex w-full flex-col border-l border-white/10 bg-card/95 backdrop-blur-xl",
          width,
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="min-w-0 truncate text-sm font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-[#8B5CF6]/50 hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </motion.aside>
    </motion.div>
  );
}

/* ── AIGenerationStages: elegant thinking pipeline ────────────────────────── */
const DEFAULT_STAGES = [
  "Analyzing lead…",
  "Finding relevant context…",
  "Personalizing message…",
  "Optimizing opening…",
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
    <div className="rounded-lg border border-[#8B5CF6]/25 bg-[#8B5CF6]/[0.05] px-4 py-3">
      <p className="ai-chip label-caps inline-flex items-center gap-1.5 rounded-full px-2 py-0.5">
        <Sparkles className="size-3" /> AI Sales Assistant
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {stages.map((s, i) => (
          <li
            key={s}
            className={cn(
              "flex items-center gap-2 text-[13px] transition-opacity",
              i < step ? "text-muted-foreground" : i === step ? "text-foreground" : "opacity-30",
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px]",
                i < step
                  ? "border-[#8B5CF6]/50 bg-[#8B5CF6]/20 text-[#c4b5fd]"
                  : i === step
                    ? "border-[#8B5CF6] text-[#8B5CF6] ai-pulse"
                    : "border-white/10 text-muted-foreground",
              )}
            >
              {i < step ? "✓" : i + 1}
            </span>
            {s}
          </li>
        ))}
        {done && (
          <li className="stage-enter flex items-center gap-2 text-[13px] font-medium text-[#c4b5fd]">
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-[#8B5CF6] bg-[#8B5CF6]/25 text-[9px]">
              ✦
            </span>
            {doneLabel}
          </li>
        )}
      </ul>
    </div>
  );
}

/* ── SpatialPage: soft spatial entrance for page content ─────────────────── */
export function SpatialPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div {...PAGE_ENTER} className={className}>
      {children}
    </motion.div>
  );
}

/* ── AIInsightCard: animated gradient border for AI content ──────────────── */
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
      <p className="label-caps mb-2 flex items-center gap-1.5 text-[#c4b5fd]">
        <Sparkles className="size-3" /> AI Insight · {title}
      </p>
      {children}
    </div>
  );
}
