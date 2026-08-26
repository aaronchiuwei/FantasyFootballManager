"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, Loader2, RefreshCw, Trash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Panel, Stencil } from "@/components/board/panel";
import {
  analyzeTrade,
  DEFAULT_TRADE_PARAMS,
  type TradeParams,
  type TradeSideKey,
} from "@/lib/trades/analyze";
import type { OpenAsset, OpenBoard } from "@/lib/trades/open-board";
import {
  MAX_SIDE,
  pprLabel,
  SCORING_CHOICES,
  type OpenScoring,
} from "@/lib/trades/open-market";
import { cn } from "@/lib/utils";

import { MAX_SIDE_NAME, OpenTradeSide } from "./open-trade-side";
import { TuningPanel } from "./tuning-panel";
import { VerdictPanel } from "./verdict-panel";

type Picks = Record<TradeSideKey, number[]>;
type Names = Record<TradeSideKey, string>;

const NO_PICKS: Picks = { a: [], b: [] };

export type OpenTrade = { picks: Picks; names: Names };

/**
 * The analyzer, without a league (§6, reached before §1's import).
 *
 * The league version answers "is this trade fair *for my team*": it knows who
 * rosters whom, what each roster is short of, and what the deal does to a
 * starting lineup. None of that exists here, and the honest consequence is
 * that this screen answers the narrower question — is this package worth that
 * package, on the open market, at these league settings — and says so rather
 * than implying the fuller one.
 *
 * What it does keep is the part that needed no league in the first place.
 * `analyzeTrade` is a pure function of cached values (§2), so the verdict, the
 * beam and the three knobs behave exactly as they do inside a league, on every
 * keystroke, with no server in the loop. The only round trip on this page is
 * changing the market board, because that is a different set of values and has
 * to be fetched.
 */
export function OpenTradeAnalyzer({
  board,
  initial,
}: {
  board: OpenBoard;
  initial: OpenTrade;
}) {
  const router = useRouter();
  const [switching, startSwitching] = useTransition();

  const [names, setNames] = useState<Names>(initial.names);
  const [picks, setPicks] = useState<Picks>(initial.picks);
  // Not persisted, and nothing here pretends otherwise: the knobs are a
  // per-league calibration (§6) and there is no league to hang them on.
  const [params, setParams] = useState<TradeParams>(DEFAULT_TRADE_PARAMS);

  const byId = useMemo(
    () => new Map(board.assets.map((asset) => [asset.playerId, asset])),
    [board.assets],
  );

  const packages = useMemo(() => {
    const side = (key: TradeSideKey) =>
      picks[key]
        .map((playerId) => byId.get(playerId))
        .filter((asset) => asset !== undefined);

    return { a: side("a"), b: side("b") };
  }, [picks, byId]);

  const analysis = useMemo(
    () => analyzeTrade<OpenAsset>(packages.a, packages.b, params),
    [packages, params],
  );

  // One player cannot be on both sides of a trade, and the search on either
  // side is the place to enforce it — by not offering them.
  const taken = useMemo(
    () => new Set([...picks.a, ...picks.b]),
    [picks],
  );

  // "Your side" and "Their side" rather than "You" and "Them", because these
  // strings are read back as a sentence in three places — the panel head, the
  // verdict's two columns, and the block reasons — and "You sends" is not one.
  const labels: Names = {
    a: names.a.trim() || "Your side",
    b: names.b.trim() || "Their side",
  };

  function add(side: TradeSideKey, playerId: number) {
    if (taken.has(playerId) || !byId.has(playerId)) return;
    if (picks[side].length >= MAX_SIDE) return;

    setPicks({ ...picks, [side]: [...picks[side], playerId] });
  }

  function remove(side: TradeSideKey, playerId: number) {
    setPicks({
      ...picks,
      [side]: picks[side].filter((entry) => entry !== playerId),
    });
  }

  /**
   * The whole state of the screen as a query string.
   *
   * Used for both things this page navigates for: switching the market board,
   * and handing the trade to somebody else. A link that dropped the players
   * when you changed to half-PPR would make the comparison it exists for
   * impossible.
   */
  function query(scoring: OpenScoring): string {
    const search = new URLSearchParams({
      teams: String(scoring.numTeams),
      ppr: String(scoring.ppr),
      qb: String(scoring.numQbs),
    });

    if (picks.a.length > 0) search.set("a", picks.a.join(","));
    if (picks.b.length > 0) search.set("b", picks.b.join(","));
    if (names.a.trim()) search.set("na", names.a.trim().slice(0, MAX_SIDE_NAME));
    if (names.b.trim()) search.set("nb", names.b.trim().slice(0, MAX_SIDE_NAME));

    return search.toString();
  }

  function setScoring(next: Partial<OpenScoring>) {
    const scoring = { ...board.scoring, ...next };
    startSwitching(() => {
      router.push(`/trade?${query(scoring)}`, { scroll: false });
    });
  }

  async function copyLink() {
    const url = `${window.location.origin}/trade?${query(board.scoring)}`;

    // Put it in the address bar first, with `replaceState` rather than a
    // navigation so this costs nothing: the clipboard is refused often enough
    // — an insecure origin, a permission declined, an embedded frame — that
    // the fallback has to be somewhere the user can actually reach, and
    // "it is in the address bar" has to be true before it is said.
    window.history.replaceState(null, "", url);

    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied. It opens this exact trade.");
    } catch {
      toast.error("Could not reach the clipboard. The link is in the address bar — copy it from there.");
    }
  }

  const empty = picks.a.length === 0 && picks.b.length === 0;

  const select = cn(
    "h-8 min-w-0 rounded-xs px-2 font-plate text-sm text-foreground",
    "bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)]",
    "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]",
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:opacity-60",
  );

  return (
    <div className="space-y-4">
      <VerdictPanel analysis={analysis} names={labels} />

      <div className="grid gap-4 lg:grid-cols-2">
        <OpenTradeSide
          sideKey="a"
          name={names.a}
          label={labels.a}
          onNameChange={(name) => setNames({ ...names, a: name })}
          board={board.assets}
          totals={analysis.a}
          taken={taken}
          onAdd={(playerId) => add("a", playerId)}
          onRemove={(playerId) => remove("a", playerId)}
        />
        <OpenTradeSide
          sideKey="b"
          name={names.b}
          label={labels.b}
          onNameChange={(name) => setNames({ ...names, b: name })}
          board={board.assets}
          totals={analysis.b}
          taken={taken}
          onAdd={(playerId) => add("b", playerId)}
          onRemove={(playerId) => remove("b", playerId)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={copyLink} disabled={empty}>
          <Link2 className="size-4" aria-hidden />
          Copy link to this trade
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={empty}
          onClick={() => setPicks(NO_PICKS)}
        >
          <Trash className="size-4" aria-hidden />
          Clear
        </Button>
      </div>

      {/* The board's own settings. A trade is only fair *at a scoring
          configuration*: the same two players swap places between 1QB and
          superflex, and a tool that hid that would be confidently wrong for
          half its users. */}
      <Panel
        label="Market board"
        note={
          <>
            FantasyCalc prices a scoring format, not a league, so the verdict
            above is only as right as these three settings.{" "}
            {switching ? "Re-pricing…" : "Changing one re-prices the trade."}
          </>
        }
        inset
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <Stencil>League size</Stencil>
            <select
              value={board.scoring.numTeams}
              disabled={switching}
              onChange={(event) =>
                setScoring({ numTeams: Number(event.target.value) })
              }
              className={select}
            >
              {SCORING_CHOICES.numTeams.map((teams) => (
                <option key={teams} value={teams}>
                  {teams} teams
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <Stencil>Scoring</Stencil>
            <select
              value={board.scoring.ppr}
              disabled={switching}
              onChange={(event) =>
                setScoring({ ppr: Number(event.target.value) })
              }
              className={select}
            >
              {SCORING_CHOICES.ppr.map((ppr) => (
                <option key={ppr} value={ppr}>
                  {pprLabel(ppr)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <Stencil>Format</Stencil>
            <select
              value={board.scoring.numQbs}
              disabled={switching}
              onChange={(event) =>
                setScoring({ numQbs: Number(event.target.value) })
              }
              className={select}
            >
              <option value={1}>1QB</option>
              <option value={2}>Superflex</option>
            </select>
          </label>

          {switching ? (
            <span className="flex items-center gap-1.5 pb-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading that board
            </span>
          ) : (
            <span className="flex items-center gap-1.5 pb-1.5 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5" aria-hidden />
              {board.assets.length.toLocaleString()} players priced
            </span>
          )}
        </div>
      </Panel>

      <TuningPanel params={params} onChange={setParams} />
    </div>
  );
}
