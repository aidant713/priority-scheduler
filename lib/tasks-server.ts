import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Renumber a user's live (todo) tasks to a contiguous 0..n-1 sequence in their
 * current priority order. Used after a delete / status change leaves gaps.
 */
export async function renumber(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data } = await supabase
    .from("tasks")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "todo")
    .order("priority", { ascending: true });
  const ids = (data ?? []).map((r) => r.id as string);
  await supabase.rpc("reorder_tasks", { p_user: userId, ordered_ids: ids });
}
