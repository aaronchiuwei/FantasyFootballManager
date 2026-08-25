"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Long enough to read as movement, short enough to keep up with typing. */
const DURATION_MS = 420;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Eases a number towards its target across frames.
 *
 * §10 asks for values that count up as a package changes — the movement is
 * what makes a side's total feel like a scale being loaded rather than a field
 * being overwritten. It is also the animation §10's guardrail is aimed at, so
 * a reduced-motion reader gets the new number immediately and nothing else.
 *
 * The initial state is the target, not zero: the server renders a real total
 * and the first client paint has to match it.
 */
export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;

    if (prefersReducedMotion()) {
      shownRef.current = target;
      setShown(target);
      return;
    }

    const started = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + (target - from) * eased;

      shownRef.current = next;
      setShown(next);

      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else frame.current = null;
    };

    frame.current = requestAnimationFrame(tick);

    // An interrupted run leaves `shownRef` wherever it stopped, so the next
    // target is chased from where the eye actually is.
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [target]);

  return shown;
}

export function CountUp({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const shown = useCountUp(value);

  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {Math.round(shown).toLocaleString()}
    </span>
  );
}
