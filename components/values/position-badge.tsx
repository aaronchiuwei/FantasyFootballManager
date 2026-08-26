import { cn } from "@/lib/utils";

/**
 * The laminate core, on its own. Where a full plate is too much (a table cell,
 * a filter row), the position field ships alone: the same cut-through colour
 * field with the code reversed out of it, at plate scale.
 *
 * Position colours are tokens, never literals, which is one of this app's
 * standing conventions.
 */
const CORES: Record<string, string> = {
  QB: "bg-pos-qb",
  RB: "bg-pos-rb",
  WR: "bg-pos-wr",
  TE: "bg-pos-te",
  K: "bg-pos-k",
  DEF: "bg-pos-def",
};

export function PositionBadge({
  position,
  className,
}: {
  position: string | null;
  className?: string;
}) {
  const key = (position ?? "").toUpperCase();

  return (
    <span
      className={cn(
        "stencil inline-flex h-5 w-10 shrink-0 items-center justify-center rounded-xs",
        "text-[0.5625rem] text-pos-ink",
        "shadow-[inset_0_-1px_0_color-mix(in_oklch,black_25%,transparent)]",
        CORES[key] ?? "bg-pos-bench",
        className,
      )}
    >
      {key || "--"}
    </span>
  );
}
