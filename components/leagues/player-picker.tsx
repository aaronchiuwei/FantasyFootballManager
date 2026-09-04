"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import { MIN_QUERY_LENGTH } from "@/lib/values/search";
import type { PlayerHit } from "@/lib/leagues/manual";
import { cn } from "@/lib/utils";

/** Long enough that a fast typist makes one round trip, not six. */
const DEBOUNCE_MS = 220;

/**
 * Finds a player in the master list.
 *
 * The one control this whole feature stands on: with no import, every roster
 * row in the app starts as somebody typing a name. Two things make it worth
 * more than a text box.
 *
 * It searches the *master list* rather than the league, so a player nobody in
 * the league has ever rostered is still findable — which is the normal case
 * when a roster is being entered for the first time.
 *
 * And it says who already owns each hit, before the click rather than after.
 * Typing a name into a hand-kept league is exactly the moment you are most
 * likely to be wrong about who has him, and a row that says "on Regression to
 * the Mean" is the correction arriving early enough to be free.
 */
export function PlayerPicker({
  search,
  onPick,
  placeholder = "Search every player…",
  disabled,
  busyPlayerId,
}: {
  search: (query: string) => Promise<{ hits: PlayerHit[]; error?: string }>;
  onPick: (hit: PlayerHit) => void;
  placeholder?: string;
  disabled?: boolean;
  /** The row to spin while its pick is being written. */
  busyPlayerId?: number | null;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlayerHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [pending, startTransition] = useTransition();

  // The request this render's results belong to. An earlier search that lands
  // after a later one must not overwrite it — the list would then be showing
  // results for a prefix of what is in the box.
  const latest = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY_LENGTH) {
      setHits([]);
      setSearched(false);
      setError(null);
      return;
    }

    const timer = setTimeout(() => {
      const ticket = (latest.current += 1);

      startTransition(async () => {
        const result = await search(term);
        if (ticket !== latest.current) return;

        setHits(result.hits);
        setError(result.error ?? null);
        setSearched(true);
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, search]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-chalk-dim"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="pl-8"
          aria-label="Search players"
          autoComplete="off"
          spellCheck={false}
        />
        {pending ? (
          <Loader2
            aria-hidden
            className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-chalk-dim"
          />
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {hits.length > 0 ? (
        <ul className="flex flex-col rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] px-3 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]">
          {hits.map((hit, index) => (
            <li key={hit.playerId}>
              <button
                type="button"
                onClick={() => onPick(hit)}
                disabled={busyPlayerId === hit.playerId}
                className={cn(
                  "flex w-full items-center gap-2.5 py-2.5 text-left",
                  "transition-colors duration-(--motion-fast) ease-(--ease-out)",
                  "hover:text-grease disabled:opacity-45",
                )}
              >
                <PositionBadge position={hit.position} />
                <span className="min-w-0 flex-1 truncate font-plate text-sm font-semibold text-foreground">
                  {hit.name}
                </span>
                <InjuryBadge status={hit.injuryStatus} />
                <span className="stencil shrink-0 text-chalk-dim">
                  {hit.nflTeam ?? "FA"}
                </span>
                {busyPlayerId === hit.playerId ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                ) : hit.ownedBy ? (
                  <Stencil className="max-w-[14ch] shrink-0 truncate">
                    {hit.ownedBy.teamName}
                  </Stencil>
                ) : (
                  <Stencil tone="grease" className="shrink-0">
                    Free
                  </Stencil>
                )}
              </button>
              {index < hits.length - 1 ? <RailLine /> : null}
            </li>
          ))}
        </ul>
      ) : searched && !pending ? (
        <p className="text-sm text-muted-foreground">
          No player matches “{query.trim()}”. If this league is new, the master
          list may still be on its way — give it a moment and reload.
        </p>
      ) : null}
    </div>
  );
}
