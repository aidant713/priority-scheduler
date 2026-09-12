import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS } from "@/lib/types";
import TaskBoard from "@/components/TaskBoard";

export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  // ensure a settings row exists
  let { data: settings } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!settings) {
    const { data } = await supabase
      .from("user_settings")
      .insert({ user_id: user.id, ...DEFAULT_SETTINGS })
      .select("*")
      .single();
    settings = data;
  }

  const [{ data: tasks }, { data: blocks }] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "todo")
      .order("priority", { ascending: true }),
    supabase
      .from("scheduled_blocks")
      .select("*")
      .eq("user_id", user.id)
      .order("start_at", { ascending: true }),
  ]);

  // never send the refresh token to the client
  const clientSettings = {
    timezone: settings!.timezone,
    work_days: settings!.work_days,
    work_start: settings!.work_start,
    work_end: settings!.work_end,
  };

  return (
    <TaskBoard
      initialTasks={tasks ?? []}
      initialBlocks={blocks ?? []}
      settings={clientSettings}
      googleConnected={!!settings!.google_refresh_token}
      userEmail={user.email ?? ""}
    />
  );
}
