import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";

/**
 * Layer 0 — Environment. Blurred violet geometry floating behind the UI.
 * Purely decorative: pointer-events-none, fixed, -z. Parallax follows the
 * cursor by a few pixels; disabled for touch, small screens, reduced motion.
 */
export function AmbientLayer() {
  const reduced = useReducedMotion();
  const isTouch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const active = !reduced && !isTouch && typeof window !== "undefined" && window.innerWidth >= 1024;

  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const sx = useSpring(mx, { stiffness: 60, damping: 20 });
  const sy = useSpring(my, { stiffness: 60, damping: 20 });
  const shiftX = useTransform(sx, [0, 1], [-5, 5]);
  const shiftY = useTransform(sy, [0, 1], [-4, 4]);

  useEffect(() => {
    if (!active) return;
    const onMove = (e: MouseEvent) => {
      mx.set(e.clientX / window.innerWidth);
      my.set(e.clientY / window.innerHeight);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [active, mx, my]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <motion.div style={active ? { x: shiftX, y: shiftY } : undefined} className="absolute inset-0">
        {/* Wireframe cube — top right, half off-screen */}
        <svg
          className="ambient-float absolute -top-24 right-[8%] h-80 w-80 opacity-[0.16] blur-[2px]"
          viewBox="0 0 200 200"
          fill="none"
        >
          <g stroke="#8B5CF6" strokeWidth="0.7">
            <path d="M60 60 L140 60 L140 140 L60 140 Z" />
            <path d="M85 35 L165 35 L165 115 L85 115 Z" />
            <path d="M60 60 L85 35 M140 60 L165 35 M140 140 L165 115 M60 140 L85 115" />
          </g>
        </svg>

        {/* Interconnected structure — bottom left */}
        <svg
          className="ambient-float absolute bottom-[-60px] left-[4%] h-96 w-96 opacity-[0.12] blur-[3px]"
          style={{ animationDelay: "-6s" }}
          viewBox="0 0 220 220"
          fill="none"
        >
          <g stroke="#A855F7" strokeWidth="0.6">
            <circle cx="60" cy="70" r="26" />
            <circle cx="150" cy="110" r="38" />
            <circle cx="95" cy="180" r="20" />
            <path d="M60 70 L150 110 L95 180 Z" />
            <path d="M86 70 L150 110 M112 87 L95 180" />
          </g>
        </svg>

        {/* Soft glow orbs */}
        <div className="ambient-float absolute left-[38%] top-[30%] h-72 w-72 rounded-full bg-[#8B5CF6]/[0.05] blur-3xl" />
        <div
          className="ambient-float absolute bottom-[18%] right-[30%] h-56 w-56 rounded-full bg-[#67E8F9]/[0.03] blur-3xl"
          style={{ animationDelay: "-9s" }}
        />
      </motion.div>
    </div>
  );
}
