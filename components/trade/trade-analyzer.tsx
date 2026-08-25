"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save, Trash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { lineupChange, type LineupPlayer } from "@/lib/needs/lineup";
import {
  analyzeTrade,
  BAND_META,
  type TradeParams,
  type TradeSideKey,
} from "@/lib/trades/analyze";
import type { TradeBoard, TradeBoardAsset } from "@/lib/trades/store";

import { RosterDeltaPanel } from "./roster-delta-panel";
import { SavedTrades, type SavedTradeView } from "./saved-trades";
import { TradeSide } from "./trade-side";
import { TuningPanel } from "./tuning-panel";
import { VerdictPanel } from "./verdict-panel";
import {
  deleteSavedTradeAction,
  saveTradeAction,
  saveTuningAction,
} from "@/app/(app)/leagues/[id]/trade/actions";

type Picks = Record<TradeSideKey, number[]>;

const NO_PICKS: Picks = { a: [], b: [] };

/**
 * A trade the user arrived with rather than built — Phase 8's suggestion cards
 * link here so that a proposal can be tuned, argued with and saved instead of
 * only read. Nothing about it is trusted: the ids are checked against the board
 * the same way a saved trade's are, so a stale link opens an empty analyzer
 * rather than a half-real one.
 */
export type InitialTrade = {
  teamA: string;
  teamB: string;
  a: number[];
  b: number[];
};

/**
 * The lineup math is denominated in rest-of-season projected points, not in
 * market value, so the board's assets are re-read in that currency on the way
 * into it (§6's roster-context delta).
 */
function asLineup(assets: TradeBoardAsset[]): LineupPlayer[] {
  return assets.map((asset) => ({
    playerId: asset.playerId,
    position: asset.position,
    points: asset.rosPoints,
  }));
}

/**
 * The analyzer (§6, §10 — "the centerpiece").
 *
 * Every value on this screen is already in memory: the page handed over the
 * league's whole rostered board in one read, and `analyzeTrade` is a pure
 * function over it. Adding a player, dragging one across, or nudging a slider
 * re-prices the deal in the same tick — §2's "fast enough to run on every
 * keystroke", with no server in the loop.
 *
 * The server is asked for exactly two things: persist a saved trade, and
 * persist the knobs.
 */
export function TradeAnalyzer({
  leagueId,
  board,
  saved,
  initial,
}: {
  leagueId: string;
  board: TradeBoard;
  saved: SavedTradeView[];
  initial?: InitialTrade | null;
}) {
  const router = useRouter();

  const [teams, setTeams] = useState<Record<TradeSideKey, string>>(() => {
    const known = (teamId: string | undefined) =>
      board.teams.some((team) => team.id === teamId);

    if (initial && known(initial.teamA) && known(initial.teamB)) {
      return { a: initial.teamA, b: initial.teamB };
    }

    const mine = board.teams.find((team) => team.isUsersTeam) ?? board.teams[0];
    const other = board.teams.find((team) => team.id !== mine?.id) ?? mine;
    return { a: mine?.id ?? "", b: other?.id ?? "" };
  });

  const [picks, setPicks] = useState<Picks>(() => {
    if (!initial) return NO_PICKS;

    // Same rule the analyzer applies everywhere: a player can only be sent by
    // the team that rosters them, so a link naming somebody who has since been
    // traded simply drops them.
    const onTeam = (playerIds: number[], teamId: string) =>
      playerIds.filter((playerId) =>
        board.assets.some(
          (asset) => asset.playerId === playerId && asset.teamId === teamId,
        ),
      );

    return {
      a: onTeam(initial.a, initial.teamA),
      b: onTeam(initial.b, initial.teamB),
    };
  });
  const [params, setParams] = useState<TradeParams>(board.params);
  const [note, setNote] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const byId = useMemo(
    () => new Map(board.assets.map((asset) => [asset.playerId, asset])),
    [board.assets],
  );

  const rosters = useMemo(
    () => ({
      a: board.assets.filter((asset) => asset.teamId === teams.a),
      b: board.assets.filter((asset) => asset.teamId === teams.b),
    }),
    [board.assets, teams],
  );

  const packages = useMemo(() => {
    const side = (key: TradeSideKey) =>
      picks[key]
        .map((playerId) => byId.get(playerId))
        .filter((asset) => asset !== undefined);

    return { a: side("a"), b: side("b") };
  }, [picks, byId]);

  const analysis = useMemo(
    () => analyzeTrade(packages.a, packages.b, params),
    [packages, params],
  );

  /**
   * §6's second scorer, over the same two packages: what each side's starting
   * lineup projects before and after. It is not folded into the verdict —
   * §1.5 makes the value verdict primary and this one context — and it is pure
   * and local for the same reason the verdict is, so both re-run on the same
   * keystroke (§2).
   */
  const context = useMemo(() => {
    const forSide = (key: TradeSideKey) => {
      const other: TradeSideKey = key === "a" ? "b" : "a";
      const team = board.teams.find((entry) => entry.id === teams[key]);
      const incoming = packages[other];

      // One chip per position, not per player: two running backs arriving is
      // still one thing to say about this team's running backs.
      const positions = [
        ...new Set(
          incoming
            .map((asset) => asset.position)
            .filter((position) => position !== null),
        ),
      ];

      return {
        change: lineupChange(
          asLineup(rosters[key]),
          { out: asLineup(packages[key]), in: asLineup(incoming) },
          board.rosterSlots,
        ),
        incoming: positions.map((position) => ({
          position,
          need: team?.needs[position] ?? 0,
        })),
      };
    };

    return { a: forSide("a"), b: forSide("b") };
  }, [board.rosterSlots, board.teams, teams, rosters, packages]);

  const names = useMemo(() => {
    const name = (id: string) =>
      board.teams.find((team) => team.id === id)?.name ?? "Unknown team";
    return { a: name(teams.a), b: name(teams.b) };
  }, [board.teams, teams]);

  /**
   * Choosing the other side's team swaps the two packages rather than emptying
   * one: "what if this went the other way" is a question people ask constantly,
   * and rebuilding both sides by hand to ask it is a bad answer.
   */
  function chooseTeam(side: TradeSideKey, teamId: string) {
    const other: TradeSideKey = side === "a" ? "b" : "a";

    if (teamId === teams[other]) {
      setTeams({ a: teams.b, b: teams.a });
      setPicks({ a: picks.b, b: picks.a });
      return;
    }

    setTeams({ ...teams, [side]: teamId });
    setPicks({ ...picks, [side]: [] });
  }

  function add(side: TradeSideKey, playerId: number) {
    const asset = byId.get(playerId);
    // A player can only be sent by the team that rosters them, which also makes
    // a drag from one column into the other a no-op rather than a nonsense.
    if (!asset || asset.teamId !== teams[side]) return;
    if (picks[side].includes(playerId)) return;

    setPicks({ ...picks, [side]: [...picks[side], playerId] });
  }

  function remove(side: TradeSideKey, playerId: number) {
    setPicks({
      ...picks,
      [side]: picks[side].filter((entry) => entry !== playerId),
    });
  }

  function load(trade: SavedTradeView) {
    const { snapshot } = trade;
    const teamA = snapshot.a.teamId ?? teams.a;
    const teamB = snapshot.b.teamId ?? teams.b;

    const onTeam = (playerIds: number[], teamId: string) =>
      playerIds.filter((playerId) => byId.get(playerId)?.teamId === teamId);

    const next: Picks = {
      a: onTeam(
        snapshot.a.assets.map((asset) => asset.playerId),
        teamA,
      ),
      b: onTeam(
        snapshot.b.assets.map((asset) => asset.playerId),
        teamB,
      ),
    };

    const dropped =
      snapshot.a.assets.length +
      snapshot.b.assets.length -
      next.a.length -
      next.b.length;

    setTeams({ a: teamA, b: teamB });
    setPicks(next);

    if (dropped > 0) {
      // Rosters move. Saying so beats silently re-pricing a different trade.
      toast.warning(
        `${dropped} player${dropped === 1 ? " is" : "s are"} no longer on that roster.`,
      );
    }
  }

  function save() {
    startSaving(async () => {
      const { error, verdict } = await saveTradeAction(leagueId, {
        teamA: teams.a,
        teamB: teams.b,
        a: picks.a,
        b: picks.b,
        note,
        params,
      });

      if (error) {
        toast.error(error);
        return;
      }

      setNote("");
      toast.success(
        verdict ? `Saved — ${BAND_META[verdict].label.toLowerCase()}.` : "Saved.",
      );
      router.refresh();
    });
  }

  function discard(tradeId: string) {
    setPendingDelete(tradeId);
    startSaving(async () => {
      const { error } = await deleteSavedTradeAction(leagueId, tradeId);
      setPendingDelete(null);
      if (error) toast.error(error);
      else router.refresh();
    });
  }

  function commitParams(next: TradeParams) {
    setParams(next);
    void saveTuningAction(leagueId, next).then(({ error }) => {
      if (error) toast.error(error);
    });
  }

  const empty = picks.a.length === 0 && picks.b.length === 0;

  return (
    <div className="space-y-4">
      <VerdictPanel analysis={analysis} leagueId={leagueId} names={names} />

      {/* Shown as soon as both sides have a player, even where the value
          verdict is refused: an unvalued player blocks a *price*, and the
          lineup question is asked in projected points, which is a different
          number that may well still exist. */}
      {picks.a.length > 0 && picks.b.length > 0 ? (
        <RosterDeltaPanel names={names} sides={context} />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <TradeSide
          sideKey="a"
          label={names.a}
          teams={board.teams}
          teamId={teams.a}
          onTeamChange={(teamId) => chooseTeam("a", teamId)}
          roster={rosters.a}
          totals={analysis.a}
          onAdd={(playerId) => add("a", playerId)}
          onRemove={(playerId) => remove("a", playerId)}
        />
        <TradeSide
          sideKey="b"
          label={names.b}
          teams={board.teams}
          teamId={teams.b}
          onTeamChange={(teamId) => chooseTeam("b", teamId)}
          roster={rosters.b}
          totals={analysis.b}
          onAdd={(playerId) => add("b", playerId)}
          onRemove={(playerId) => remove("b", playerId)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note — why you would or would not send this"
          maxLength={200}
          className="h-9 max-w-md flex-1"
        />
        <Button
          size="sm"
          onClick={save}
          disabled={saving || analysis.verdict === null}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          Save trade
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

      <TuningPanel params={params} onChange={setParams} onCommit={commitParams} />

      <Separator />

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Saved trades ({saved.length})
        </h2>
        <SavedTrades
          trades={saved}
          onLoad={load}
          onDelete={discard}
          pendingId={pendingDelete}
        />
      </section>
    </div>
  );
}
