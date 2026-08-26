import { redirect } from "next/navigation";

import { AppHeader } from "@/components/board/app-header";
import { createClient } from "@/lib/supabase/server";

/**
 * Second gate. The middleware already redirects signed-out visitors, but the
 * layout re-checks because middleware alone is not an authorization boundary.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader email={user.email} />

      {/* px-4 on a phone: the values board and the waiver wire are tables that
          already scroll sideways, and twelve pixels a side is a column. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
