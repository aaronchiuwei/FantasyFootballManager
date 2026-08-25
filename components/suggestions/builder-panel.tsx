"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Search, X } from "lucide-react";

import { InjuryBadge } from "@/components/players/injury-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PositionBadge } from "@/components/values/position-badge";
import { ValueBadge } from "@/components/values/value-badge";
import type { BuiltPackages } from "@/lib/suggestions/store";
import type { TradeBoard, TradeBoardAsset } from "@/lib/trades/store";
import { cn } from "@/lib/utils";
import { buildPackagesAction } from "@/app/(app)/leagues/[id]/suggestions/actions";

import { PackageStack } from "./package-stack";

/** Enough of the board to scan without turning the panel into a second values screen. */
const MATCH_LIMIT = 8;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Requirement 10: name a player on somebody else's roster and get back three to
 * five packages that would buy them.
 *
 * The menu is the feature, and it is the reason this is not the trade analyzer
 * with a shortcut. "What would it take to get Jefferson" answered with a single
 * package is a number pretending to be a negotiation; three packages at the
 * same price, made of different players, is something to open a conversation
 * with — and the manager on the other side gets to pick which of them they
 * dislike least.
 *
 * The picker is local — the page already handed over the league's whole
 * rostered board for §9's cards — but the *search* is a server action, because
 * §10's packages are the server's arithmetic over the server's values, the same
 * rule saving a trade follows.
 */
export function BuilderPanel({
  leagueId,
  board,
}: {
  leagueId: string;
  board: TradeBoard;
}) {
  const [teamId, setTeamId] = useState(
    () => (board.teams.find((team) => team.isUsersTeam) ?? board.teams[0])?.id ?? "",
  );
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<BuiltPackages | null>(null);
  const [pending, startBuilding] = useTransition();

  const names = useMemo(
    () => Object.fromEntries(board.teams.map((team) => [team.id, team.name])),
    [board.teams],
  );

  const matches = useMemo(() => {
    const needle = normalize(query);
    if (needle.length < 2) return [] as TradeBoardAsset[];

    return board.assets
      .filter(
        (asset) =>
          asset.teamId !== teamId && normalize(asset.name).includes(needle),
      )
      .slice(0, MATCH_LIMIT);
  }, [board.assets, query, teamId]);

  function choose(asset: TradeBoardAsset) {
    setQuery("");
    startBuilding(async () => {
      const { error, result: built } = await buildPackagesAction(leagueId, {
        targetPlayerId: asset.playerId,
        forTeamId: teamId,
      });

      if (error) {
        toast.error(error);
        return;
      }
      setResult(built ?? null);
    });
  }

  const stats = result?.stats ?? null;

  return (
    <div className="space-y-4">
      <Card className="gap-0 py-3">
        <CardContent className="space-y-3 px-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 space-y-1">
              <label
                htmlFor="builder-team"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Building for
              </label>
              <select
                id="builder-team"
                value={teamId}
                onChange={(event) => {
                  setTeamId(event.target.value);
                  setResult(null);
                }}
                className="h-8 w-full max-w-[16rem] rounded-md border bg-background px-2 text-sm"
              >
                {board.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                    {team.isUsersTeam ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <label
                htmlFor="builder-target"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Player to go and get
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="builder-target"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search every other roster in the league"
                  className="h-8 pl-8"
                  autoComplete="off"
                />
              </div>
            </div>
          </div>

          {matches.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {matches.map((asset) => (
                <li key={asset.playerId}>
                  <button
                    type="button"
                    onClick={() => choose(asset)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted motion-reduce:transition-none"
                  >
                    <PositionBadge position={asset.position} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {asset.name}
                    </span>
                    <InjuryBadge status={asset.injuryStatus} />
                    <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                      {names[asset.teamId]}
                    </span>
                    <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                      {asset.value.toLocaleString()}
                    </span>
                    <ValueBadge source={asset.source} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {query.length > 0 && normalize(query).length >= 2 && matches.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nobody by that name on another roster. Free agents are the waiver
              wire&rsquo;s question, not a trade.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {pending ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
          Pricing every package on that roster…
        </p>
      ) : null}

      {!pending && result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm">
              <span className="font-medium">{result.target.name}</span> prices at{" "}
              <span className="font-mono tabular-nums">
                {Math.round(stats?.askingPrice ?? 0).toLocaleString()}
              </span>{" "}
              from {result.target.teamName ?? "their team"}.
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => setResult(null)}
            >
              <X className="size-3.5" aria-hidden />
              Clear
            </Button>
          </div>

          {result.packages.length > 0 ? (
            <PackageStack
              packages={result.packages}
              leagueId={leagueId}
              names={names}
            />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {stats?.blocked === "unvalued"
                ? "That player has no resolved value, so there is no price to meet. Resolve their identity on the identity screen and sync — a missing value must never be summed as a zero."
                : stats?.blocked === "no-pieces"
                  ? "This roster has nothing tradeable to offer — every player on it is either unvalued or a kicker or defense."
                  : "Nothing on this roster adds up to a fair package for them, at any combination of up to three players."}
            </p>
          )}

          <BuilderNotes stats={stats} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * What the search did *not* look at, said out loud.
 *
 * §5's rule is that a number the app cannot stand behind gets stated rather than
 * folded in, and the same applies to a player it deliberately declined to
 * offer. A menu that quietly left out the user's best asset because §7 says
 * they are thin there is a menu that looks worse than it is for a reason the
 * user cannot see.
 */
function BuilderNotes({
  stats,
}: {
  stats: BuiltPackages["stats"] | null;
}) {
  if (!stats) return null;

  const notes: string[] = [];

  if (stats.relaxed) {
    notes.push(
      "Every tradeable player on this roster plays a position the team is thin at, so the search offered them anyway — an exclusion that empties a roster is a refusal to answer, not a filter.",
    );
  } else if (stats.protectedPieces > 0) {
    notes.push(
      `${stats.protectedPieces} player${stats.protectedPieces === 1 ? "" : "s"} held back: they play a position §7's needs vector says this team is already short of.`,
    );
  }

  if (stats.unvalued > 0) {
    notes.push(
      `${stats.unvalued} player${stats.unvalued === 1 ? " has" : "s have"} no resolved value and cannot be put in a package.`,
    );
  }

  if (notes.length === 0) return null;

  return (
    <ul className={cn("space-y-1 border-t pt-2 text-xs text-muted-foreground")}>
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}
