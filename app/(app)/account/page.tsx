import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import { ChangeEmailForm } from "@/components/account/change-email-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { DeleteAccountForm } from "@/components/account/delete-account-form";
import { DisconnectEspnButton } from "@/components/leagues/disconnect-espn-button";
import { DisconnectYahooButton } from "@/components/leagues/disconnect-yahoo-button";
import { signOut } from "@/app/(auth)/actions";
import { createClient } from "@/lib/supabase/server";
import { getEspnConnection } from "@/lib/sources/espn-auth";
import { getYahooConnection } from "@/lib/sources/yahoo-auth";

export const metadata: Metadata = { title: "Account" };

function formatDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** One fact stamped on the board: its label ruled left, its value at the end. */
function Fact({
  label,
  value,
  action,
}: {
  label: string;
  value: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
      <Stencil className="w-32 shrink-0">{label}</Stencil>
      <span
        data-numeric
        className="min-w-0 flex-1 truncate font-plate text-sm text-foreground tabular-nums"
      >
        {value}
      </span>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const account = user!;

  const [connection, espn, leagues, trades, syncs] = await Promise.all([
    getYahooConnection(account.id),
    getEspnConnection(account.id),
    supabase.from("leagues").select("id", { count: "exact", head: true }),
    supabase.from("saved_trades").select("id", { count: "exact", head: true }),
    supabase.from("sync_runs").select("id", { count: "exact", head: true }),
  ]);

  const leagueCount = leagues.count ?? 0;
  const tradeCount = trades.count ?? 0;
  const syncCount = syncs.count ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
          Account
        </h1>
        <p className="mt-1.5 max-w-[62ch] text-sm text-muted-foreground">
          Who you are signed in as, what this account is linked to, and how to
          close it.
        </p>
      </header>

      <Panel
        label="Signed in"
        action={
          <form action={signOut}>
            <Button type="submit" size="sm" variant="outline">
              Sign out
            </Button>
          </form>
        }
      >
        <div className="flex flex-col">
          <Fact label="Email" value={account.email ?? "Unknown"} />
          <RailLine />
          <Fact label="Member since" value={formatDate(account.created_at)} />
          <RailLine />
          <Fact
            label="Last sign in"
            value={formatDate(account.last_sign_in_at)}
          />
        </div>
      </Panel>

      <Panel
        label="Change email"
        note="A confirmation link goes to the new address. Nothing changes until you click it."
      >
        <ChangeEmailForm current={account.email ?? "you@example.com"} />
      </Panel>

      <Panel
        label="Change password"
        note="Used to sign in to this board. Your Yahoo password is never one of ours."
      >
        <ChangePasswordForm />
      </Panel>

      <Panel
        label="Yahoo link"
        note={
          connection.connected
            ? connection.needsReauth
              ? "The link needs renewing before leagues can be read."
              : `Linked ${formatDate(connection.linkedAt)}. Tokens are stored encrypted, server-side only.`
            : "Not linked. Read-only access to your fantasy leagues."
        }
        action={
          connection.connected && !connection.needsReauth ? (
            <DisconnectYahooButton />
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href="/leagues">
                {connection.connected ? "Reconnect" : "Connect"}
              </Link>
            </Button>
          )
        }
      >
        <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
          Disconnecting revokes the stored tokens. Leagues you already imported
          stay on the board and stop receiving new syncs.
        </p>
      </Panel>

      <Panel
        label="ESPN cookies"
        note={
          espn.connected
            ? espn.needsReauth
              ? "ESPN has stopped accepting them. Connect a league again with a fresh pair to replace them."
              : `Saved ${formatDate(espn.linkedAt)}, encrypted and server-side only.`
            : "None saved. Public ESPN leagues never needed any; a private one does."
        }
        action={
          espn.connected ? (
            <DisconnectEspnButton />
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href="/leagues/espn">Connect</Link>
            </Button>
          )
        }
      >
        <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
          These are session cookies for your ESPN account rather than a scoped
          token, which is why they are stored encrypted and never shown again.
          Forgetting them leaves public ESPN leagues syncing and stops private
          ones.
        </p>
      </Panel>

      <Panel
        label="What this account holds"
        note="Everything below is deleted with the account, immediately and for good."
      >
        <div className="flex flex-col">
          <Fact label="Leagues" value={leagueCount} />
          <RailLine />
          <Fact label="Saved trades" value={tradeCount} />
          <RailLine />
          <Fact label="Syncs run" value={syncCount} />
          <RailLine />
          <Fact
            label="Yahoo link"
            value={connection.connected ? "Connected" : "None"}
          />
          <RailLine />
          <Fact
            label="ESPN cookies"
            value={espn.connected ? "Saved" : "None"}
          />
        </div>
      </Panel>

      <Panel
        label="Delete account"
        note="Closes the account and clears its leagues, teams, rosters, values, sync history and saved trades. There is no undo and no export."
      >
        <DeleteAccountForm email={account.email ?? ""} />
      </Panel>
    </div>
  );
}
