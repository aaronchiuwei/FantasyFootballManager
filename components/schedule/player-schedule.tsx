import { Panel, Stencil } from "@/components/board/panel";
import { EmptySeat } from "@/components/board/rail";
import { SosChip, sosDescription } from "@/components/schedule/sos-chip";
import type { ScheduleStrength, SosTier, WeekMatchup } from "@/lib/schedule/sos";
import { cn } from "@/lib/utils";

/**
 * One player's schedule, whole.
 *
 * The board and the roster columns carry a schedule as a single stamp, which
 * is the right size for a list of two hundred names and the wrong size for the
 * screen about one man. Here there is room for the thing the stamp is an
 * average of: every week of the league's window, who he draws, and how much
 * that defense gives up.
 *
 * A season average and a week are different claims and are drawn differently.
 * The average is a reason to trade for someone; a week is a reason to start
 * him, and the two disagree often -- a level slate is routinely three soft
 * weeks and three brutal ones.
 */

const TIER_CELL: Record<SosTier, string> = {
  easy: "bg-success/12 text-success",
  even: "bg-[color-mix(in_oklch,var(--channel)_45%,transparent)] text-chalk-dim",
  hard: "bg-warning/12 text-warning",
};

const TIER_WORDS: Record<SosTier, string> = {
  easy: "Soft",
  even: "Level",
  hard: "Tough",
};

function signed(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded >= 0 ? "+" : "-"}${Math.abs(rounded).toFixed(1)}`;
}

/** One week of the slate: the opponent, and what that defense gives up. */
function WeekCell({
  matchup,
  position,
  currentWeek,
}: {
  matchup: WeekMatchup;
  position: string;
  /** Weeks behind this one are played; they are dimmed, not hidden. */
  currentWeek: number | null;
}) {
  const past = currentWeek !== null && matchup.week < currentWeek;
  const bye = matchup.opponent === null;

  const title = bye
    ? `Week ${matchup.week}: bye. No game, and no points from him either way.`
    : matchup.tier === null
      ? `Week ${matchup.week}: ${matchup.isHome ? "hosting" : "at"} ${matchup.opponent}. That defense is not graded, so this week carries no reading.`
      : `Week ${matchup.week}: ${matchup.isHome ? "hosting" : "at"} ${matchup.opponent}, the ${matchup.opponentRank} softest defense of ${matchup.outOf} against a ${position}. They give up ${signed(matchup.pointsPerGame ?? 0)} points a game against the average defense, in this league's scoring.`;

  return (
    <div
      title={title}
      data-tier={matchup.tier ?? "none"}
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-xs px-1.5 py-1 text-center",
        bye || matchup.tier === null
          ? "bg-[color-mix(in_oklch,var(--board-deep)_35%,transparent)]"
          : TIER_CELL[matchup.tier],
        past && "opacity-55",
      )}
    >
      <Stencil data-numeric className="text-[0.5625rem] tabular-nums">
        {matchup.week}
      </Stencil>

      <span className="truncate font-plate text-xs font-semibold">
        {bye ? "BYE" : `${matchup.isHome ? "" : "@"}${matchup.opponent}`}
      </span>

      <span
        data-numeric
        className="stencil text-[0.5625rem] tabular-nums opacity-90"
      >
        {bye || matchup.pointsPerGame === null
          ? "--"
          : signed(matchup.pointsPerGame)}
      </span>
    </div>
  );
}

function Reading({
  label,
  reading,
}: {
  label: string;
  reading: ScheduleStrength | null;
}) {
  return (
    <div className="space-y-1">
      <Stencil className="block">{label}</Stencil>
      {reading === null ? (
        <p className="stencil text-chalk-dim">No reading</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <SosChip reading={reading} windowLabel={label} />
          </div>
          <p className="max-w-[52ch] text-xs leading-relaxed text-muted-foreground">
            {sosDescription(reading, label)}
          </p>
        </>
      )}
    </div>
  );
}

export function PlayerSchedule({
  position,
  nflTeam,
  season,
  currentWeek,
  restOfSeason,
  playoffs,
  weeks,
  /** What the defenses were graded on, for the note under the head. */
  gradedOn,
}: {
  position: string | null;
  nflTeam: string | null;
  season: number;
  currentWeek: number | null;
  restOfSeason: ScheduleStrength | null;
  playoffs: ScheduleStrength | null;
  /** The league's whole week window, byes included. Empty when ungraded. */
  weeks: WeekMatchup[];
  gradedOn: string;
}) {
  const graded = restOfSeason !== null || weeks.length > 0;

  return (
    <Panel
      label={`Schedule · ${season}`}
      note={
        graded
          ? `Points per game each opponent gives up to a ${position}, against what the average defense gives up, in this league's scoring. Graded on ${gradedOn}. Positive is a defense worth facing.`
          : position === "K" || position === "DEF"
            ? "Only quarterbacks, runners, receivers and tight ends are graded. Points allowed to opposing kickers and team defenses is not a matchup anybody streams on."
            : nflTeam === null
              ? "A player on no NFL roster has no slate to read."
              : "One sync pulls the NFL slate and grades every defense by position."
      }
    >
      {!graded ? (
        <EmptySeat>
          {nflTeam === null
            ? "No NFL team, so no slate to read."
            : position === "K" || position === "DEF"
              ? `A ${position} carries no schedule reading`
              : "No schedule read yet"}
        </EmptySeat>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Reading label="Rest of season" reading={restOfSeason} />
            <Reading label="Playoff weeks" reading={playoffs} />
          </div>

          {weeks.length > 0 ? (
            <div className="space-y-1.5">
              <Stencil className="block">Week by week</Stencil>
              {/* A fixed column count rather than auto-fit: an eighteen-week
                  slate should wrap into two even rows, not one long one and a
                  stub, because the eye reads the strip as a sequence. */}
              <div className="grid grid-cols-5 gap-1 sm:grid-cols-9">
                {weeks.map((matchup) => (
                  <WeekCell
                    key={matchup.week}
                    matchup={matchup}
                    position={position ?? "player"}
                    currentWeek={currentWeek}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {TIER_WORDS.easy} is a defense that gives up more than average,{" "}
                {TIER_WORDS.hard.toLowerCase()} is one that gives up less. Weeks
                already played are dimmed.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
