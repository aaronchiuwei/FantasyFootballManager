import { Skeleton } from "@/components/ui/skeleton";

/**
 * The leagues page is the slowest render in the app and the only one whose
 * slowness is not this app's fault: it calls Yahoo live to discover what
 * leagues the account has, and Yahoo answers when it answers.
 *
 * So this is the one place a skeleton is doing more than smoothing a
 * navigation — it is standing in for a third-party round trip that can take
 * seconds, on the screen a new user sees first.
 */
export default function LeaguesLoading() {
  return (
    <div className="space-y-6" aria-busy role="status" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <Skeleton className="h-28 w-full" />

      <div className="space-y-2">
        <Skeleton className="h-4 w-44" />
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
