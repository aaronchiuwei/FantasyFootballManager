import { cn } from "@/lib/utils";

/** Position colors are tokens, never literals — one of the app's conventions. */
const STYLES: Record<string, string> = {
  QB: "bg-pos-qb/12 text-pos-qb",
  RB: "bg-pos-rb/12 text-pos-rb",
  WR: "bg-pos-wr/12 text-pos-wr",
  TE: "bg-pos-te/12 text-pos-te",
  K: "bg-pos-k/12 text-pos-k",
  DEF: "bg-pos-def/12 text-pos-def",
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
        "inline-flex h-5 w-10 shrink-0 items-center justify-center rounded-md text-[0.6875rem] font-semibold",
        STYLES[key] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {key || "—"}
    </span>
  );
}
