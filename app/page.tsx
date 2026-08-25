import Link from "next/link";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 p-6 text-center">
      <div className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Yahoo league companion
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Know what your roster is
          <span className="text-primary"> actually worth</span>
        </h1>
        <p className="mx-auto max-w-md text-pretty text-muted-foreground">
          Market-grounded player values, honest trade math, and waiver
          recommendations for your redraft league.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {user ? (
          <Button asChild size="lg">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        ) : (
          <>
            <Button asChild size="lg">
              <Link href="/signup">Get started</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
