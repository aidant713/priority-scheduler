import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CompletedList } from "@/components/CompletedList";

export const dynamic = "force-dynamic";

export default async function CompletedPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = createClient();
  const [{ data: done }, { data: settings }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, updated_at")
      .eq("user_id", user.id)
      .eq("status", "done")
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase.from("user_settings").select("timezone").eq("user_id", user.id).maybeSingle(),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Completed</h1>
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← Back to list
        </Link>
      </div>
      <CompletedList initial={done ?? []} tz={settings?.timezone ?? "Australia/Perth"} />
    </main>
  );
}
