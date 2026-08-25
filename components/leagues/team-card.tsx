import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type TeamRow = {
  id: string;
  name: string;
  manager_name: string | null;
  logo_url: string | null;
  is_users_team: boolean;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  points_for: number | null;
  points_against: number | null;
  rank: number | null;
};

function record(team: TeamRow) {
  if (team.wins === null && team.losses === null) return "No games played";
  const base = `${team.wins ?? 0}-${team.losses ?? 0}`;
  return team.ties ? `${base}-${team.ties}` : base;
}

function points(value: number | null) {
  return value === null ? "—" : value.toFixed(1);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function TeamCard({ team }: { team: TeamRow }) {
  return (
    <Card
      className={cn(
        "transition-colors",
        team.is_users_team && "border-primary/60 bg-primary/5",
      )}
    >
      <CardContent className="flex items-start gap-3">
        <span className="w-6 shrink-0 pt-1 text-right font-mono text-sm text-muted-foreground">
          {team.rank ?? "—"}
        </span>

        <Avatar className="size-10 shrink-0">
          {team.logo_url ? (
            <AvatarImage src={team.logo_url} alt="" />
          ) : null}
          <AvatarFallback className="text-xs">
            {initials(team.name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{team.name}</p>
            {team.is_users_team ? (
              <Badge variant="secondary" className="shrink-0">
                You
              </Badge>
            ) : null}
          </div>

          <p className="truncate text-sm text-muted-foreground">
            {team.manager_name ?? "Manager hidden"}
          </p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 font-mono text-xs text-muted-foreground">
            <span className="text-foreground">{record(team)}</span>
            <span>PF {points(team.points_for)}</span>
            <span>PA {points(team.points_against)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
