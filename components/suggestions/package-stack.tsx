"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SuggestionPayload } from "@/lib/suggestions/payload";
import { cn } from "@/lib/utils";

import { SuggestionCard } from "./suggestion-card";

/** How many card-shaped shadows sit behind the front one. */
const DEPTH = 2;

/** Pointer travel, in px, that counts as a swipe rather than a fidget. */
const SWIPE_THRESHOLD = 56;

/** Past this many packages the dots convey nothing the counter does not. */
const DOT_LIMIT = 12;

/**
 * §10's "Skiper UI carousel/stack for cycling trade packages."
 *
 * Written in the repo rather than pulled from the registry, which is the same
 * arrangement §10 describes for both component libraries: they are copy-paste
 * shadcn registries, so a vendored component is the normal outcome and this one
 * skips the round trip. It also keeps §10's performance guardrail — the richer
 * React Bits stack components pull GSAP or OGL, and this is a data-dense page
 * that has no business loading a WebGL renderer to move a card sideways. What
 * is here is two CSS transforms and a pointer handler.
 *
 * **Only the front card is real.** The ones behind it are empty rounded
 * rectangles, so the accessibility tree contains exactly the trade the user is
 * being shown and the arrows move through the list the way a listbox would. A
 * stack that rendered every package would put a dozen offers in the tab order
 * to convey "there are more".
 *
 * Under `prefers-reduced-motion` the transitions are cancelled outright. The
 * offsets stay — they are a static diagram of "there is more behind this",
 * which is information rather than motion — and the card simply changes.
 */
export function PackageStack({
  packages,
  leagueId,
  names,
  emptyLabel = "Nothing to show.",
}: {
  packages: SuggestionPayload[];
  leagueId: string;
  names?: Record<string, string>;
  emptyLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  // A filter that shortens the list must not leave the stack pointing past the
  // end of it.
  useEffect(() => {
    setIndex((current) => (current < packages.length ? current : 0));
  }, [packages.length]);

  if (packages.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
    );
  }

  const clamped = Math.min(index, packages.length - 1);
  const move = (step: number) => {
    setDrag(0);
    setIndex((current) => {
      const next = current + step;
      // Wraps, because a stack of three is meant to be cycled and stopping at
      // the end of it turns "next" into a dead button on the third card.
      return (next + packages.length) % packages.length;
    });
  };

  const behind = Math.min(DEPTH, packages.length - 1);

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label={`Trade package ${clamped + 1} of ${packages.length}`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") move(-1);
          else if (event.key === "ArrowRight") move(1);
          else return;
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          start.current = event.clientX;
        }}
        onPointerMove={(event) => {
          if (start.current === null) return;
          setDrag(event.clientX - start.current);
        }}
        onPointerUp={() => {
          if (start.current === null) return;
          const travelled = drag;
          start.current = null;
          if (Math.abs(travelled) >= SWIPE_THRESHOLD) move(travelled < 0 ? 1 : -1);
          else setDrag(0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(0);
        }}
        className="relative rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {Array.from({ length: behind }, (_, depth) => (
          <div
            key={depth}
            aria-hidden
            className="absolute inset-x-0 top-0 z-0 h-full rounded-xl border bg-card"
            style={{
              transform: `translateY(${(depth + 1) * 10}px) scaleX(${
                1 - (depth + 1) * 0.035
              })`,
              opacity: 1 - (depth + 1) * 0.3,
            }}
          />
        ))}

        <div
          className="relative z-10 touch-pan-y transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none"
          style={{ transform: `translateX(${drag * 0.35}px)` }}
        >
          <SuggestionCard
            // Keyed on the package so a new card is a new element: the
            // crossfade is the one on the analyzer's verdict, for the same
            // reason — the answer changed, so it should look like it did.
            key={clamped}
            suggestion={packages[clamped]}
            leagueId={leagueId}
            names={names}
            className="animate-in fade-in duration-[var(--motion-base)] motion-reduce:animate-none"
          />
        </div>
      </div>

      {packages.length > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            className="size-8 p-0"
            aria-label="Previous package"
            onClick={() => move(-1)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>

          {/* Dots stop being a position indicator and start being a texture
              somewhere around a dozen; past that the counter underneath is the
              honest way to say where you are. */}
          {packages.length <= DOT_LIMIT ? (
            <div className="flex items-center gap-1.5" aria-hidden>
              {packages.map((entry, position) => (
                <span
                  key={`${entry.a.teamId}-${entry.b.teamId}-${position}`}
                  className={cn(
                    "h-1.5 rounded-4xl transition-all duration-[var(--motion-fast)] motion-reduce:transition-none",
                    position === clamped
                      ? "w-5 bg-primary"
                      : "w-1.5 bg-muted-foreground/40",
                  )}
                />
              ))}
            </div>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            className="size-8 p-0"
            aria-label="Next package"
            onClick={() => move(1)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      ) : null}

      <p className="text-center text-xs text-muted-foreground" aria-live="polite">
        {clamped + 1} of {packages.length}
      </p>
    </div>
  );
}
