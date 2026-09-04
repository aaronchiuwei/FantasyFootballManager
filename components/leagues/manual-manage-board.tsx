"use client";

import { useRouter } from "next/navigation";

import {
  TeamsEditor,
  type EditableTeam,
  type TeamActions,
} from "@/components/leagues/teams-editor";

/**
 * The one piece of state the manage screen has: which team's roster is open.
 *
 * It lives in the URL rather than in React, so the page stays server-rendered.
 * The roster below is read on the server for exactly one team — twelve rosters
 * fetched so the browser can hide eleven of them is the shape this avoids —
 * and a link to a particular team's roster is a link somebody can send.
 *
 * `replace` rather than `push`: flipping between teams while entering a league
 * is not navigation anyone wants to walk back through one team at a time.
 */
export function ManualManageBoard({
  teams,
  actions,
  selectedTeamId,
  children,
}: {
  teams: EditableTeam[];
  actions: TeamActions;
  selectedTeamId: string | null;
  /** The selected team's roster editor, rendered by the page above. */
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <>
      <TeamsEditor
        teams={teams}
        actions={actions}
        selectedTeamId={selectedTeamId}
        onSelect={(teamId) => router.replace(`?team=${teamId}`, { scroll: false })}
      />
      {children}
    </>
  );
}
