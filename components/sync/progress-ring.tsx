import { cn } from "@/lib/utils";

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The sync's progress as a ring. Determinate because the pipeline knows
 * exactly how many stages it has — a spinner would be a lie about a job that
 * legitimately takes 20–40 seconds (§9).
 */
export function ProgressRing({
  progress,
  className,
  tone = "primary",
  children,
}: {
  progress: number;
  className?: string;
  tone?: "primary" | "success" | "destructive" | "muted";
  children?: React.ReactNode;
}) {
  const stroke = {
    primary: "stroke-primary",
    success: "stroke-success",
    destructive: "stroke-destructive",
    muted: "stroke-muted-foreground",
  }[tone];

  return (
    <div className={cn("relative size-11 shrink-0", className)}>
      <svg viewBox="0 0 44 44" className="size-full -rotate-90" aria-hidden>
        <circle
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          strokeWidth="3.5"
          className="stroke-border"
        />
        <circle
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, progress)))}
          className={cn(
            stroke,
            "transition-[stroke-dashoffset] duration-[var(--motion-slow)] ease-out motion-reduce:transition-none",
          )}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
