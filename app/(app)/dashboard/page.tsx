import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: userData }, { data: profile }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("email, created_at").single(),
  ]);

  const user = userData.user!;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Signed in as {profile?.email ?? user.email}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Link your Yahoo league</CardTitle>
          <CardDescription>
            Next up (Phase 1): connect a Yahoo account, import the league, and
            render its teams from live data.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Account created{" "}
          {new Date(profile?.created_at ?? user.created_at).toLocaleDateString()}.
        </CardContent>
      </Card>
    </div>
  );
}
