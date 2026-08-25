"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  analyzeTrade,
  type TradeParams,
  type VerdictBand,
} from "@/lib/trades/analyze";
import { buildSnapshot } from "@/lib/trades/saved";
import {
  deleteSavedTrade,
  loadTradeBoard,
  normalizeParams,
  saveTrade,
  saveTradeParams,
  type TradeBoardAsset,
} from "@/lib/trades/store";
import { createClient } from "@/lib/supabase/server";

async function requireUser(leagueId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/leagues/${leagueId}/trade`)}`);
  }

  return { supabase, user };
}

function describe(cause: unknown) {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

export type SaveTradeInput = {
  teamA: string;
  teamB: string;
  a: number[];
  b: number[];
  note: string;
  params: TradeParams;
};

/**
 * Saves what the browser is showing — by rebuilding it from the server's own
 * copy of the values.
 *
 * The client sends player ids and knob positions, never totals. The analyzer
 * runs in the browser for §2's reasons, but a *record* of a verdict has to be
 * the server's arithmetic over the server's values, or the payload is only ever
 * as trustworthy as whatever posted it. The two agree because it is literally
 * the same pure function on both sides.
 */
export async function saveTradeAction(
  leagueId: string,
  input: SaveTradeInput,
): Promise<{ error?: string; verdict?: VerdictBand }> {
  const { supabase, user } = await requireUser(leagueId);

  try {
    const board = await loadTradeBoard(supabase, leagueId);
    const byId = new Map(board.assets.map((asset) => [asset.playerId, asset]));

    // A player is only tradeable from the team that actually rosters them, and
    // an id the board does not know is dropped rather than guessed at.
    const side = (ids: number[], teamId: string): TradeBoardAsset[] => {
      const assets: TradeBoardAsset[] = [];

      for (const playerId of ids) {
        const asset = byId.get(playerId);
        if (asset && asset.teamId === teamId) assets.push(asset);
      }

      return assets;
    };

    const params = normalizeParams(input.params);
    const analysis = analyzeTrade(
      side(input.a, input.teamA),
      side(input.b, input.teamB),
      params,
    );

    const team = (id: string) => board.teams.find((entry) => entry.id === id);

    const snapshot = buildSnapshot(
      analysis,
      {
        a: { teamId: input.teamA, teamName: team(input.teamA)?.name ?? null },
        b: { teamId: input.teamB, teamName: team(input.teamB)?.name ?? null },
      },
      params,
    );

    if (!snapshot) {
      return {
        error:
          "This trade has no verdict to save — both sides need players, and every player needs a resolved value.",
      };
    }

    await saveTrade(supabase, {
      userId: user.id,
      leagueId,
      snapshot,
      note: input.note,
    });

    revalidatePath(`/leagues/${leagueId}/trade`);
    return { verdict: snapshot.band };
  } catch (cause) {
    return { error: describe(cause) };
  }
}

export async function deleteSavedTradeAction(
  leagueId: string,
  tradeId: string,
): Promise<{ error?: string }> {
  const { supabase } = await requireUser(leagueId);

  try {
    await deleteSavedTrade(supabase, leagueId, tradeId);
    revalidatePath(`/leagues/${leagueId}/trade`);
    return {};
  } catch (cause) {
    return { error: describe(cause) };
  }
}

/** §6: α, β and γ are per-league tunables — "let the user's league norms calibrate them". */
export async function saveTuningAction(
  leagueId: string,
  params: TradeParams,
): Promise<{ error?: string }> {
  const { supabase } = await requireUser(leagueId);

  try {
    await saveTradeParams(supabase, leagueId, params);
    revalidatePath(`/leagues/${leagueId}/trade`);
    return {};
  } catch (cause) {
    return { error: describe(cause) };
  }
}
