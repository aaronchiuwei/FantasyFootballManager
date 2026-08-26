import { Skeleton } from "@/components/ui/skeleton";

/**
 * What every one of this league's screens shows while its reads are in flight.
 *
 * One file covers all seven, because a `loading.tsx` wraps its segment *and*
 * everything nested under it — and because they genuinely share a shape: a
 * heading and a sync button, a strip of numbers or filters, then a body. There
 * is no honest way to skeleton a balance beam or a radar, and a per-page
 * imitation of one would be a worse lie than a grey block.
 *
 * It renders inside `layout.tsx`, so the breadcrumb and the section strip stay
 * put and stay clickable while the page underneath swaps. That is the whole
 * reason this file earns its place: these pages do between three and seven
 * Supabase round trips, and until now a tab click did nothing visible for as
 * long as they took.
 *
 * No pulse variation, no staggered reveal, nothing that could be mistaken for
 * content. `Skeleton`'s own `animate-pulse` is the only motion, and §10's
 * global reduced-motion rule stills it.
 */
export default function LeagueLoading() {
  return (
    <div className="space-y-6" aria-busy role="status" aria-label="Loading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-4 w-3/4 max-w-lg" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>

      <Skeleton className="h-px w-full" />

      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
