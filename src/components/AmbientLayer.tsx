import { useReducedMotion } from "framer-motion";

/**
 * Environment backdrop — a faint warm-paper wash with one soft light from the
 * top. Deliberately almost invisible; decorative only, disabled for reduced
 * motion. Pointer-events none, fixed, -z.
 */
export function AmbientLayer() {
  const reduced = useReducedMotion();

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Soft top light */}
      <div className="absolute inset-x-0 top-0 h-[38vh] bg-gradient-to-b from-white/50 to-transparent" />
      {/* Barely-there warm corner warmth */}
      <div
        className={
          "absolute -bottom-32 left-[10%] h-96 w-96 rounded-full bg-[#e8dfc9]/40 blur-3xl" +
          (reduced ? "" : " ambient-float")
        }
      />
      <div className="absolute -right-24 top-[20%] h-80 w-80 rounded-full bg-[#efe9da]/50 blur-3xl" />
    </div>
  );
}
