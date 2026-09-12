import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api";

// POST /api/tasks/reorder { orderedIds: string[] }
// Atomically renumbers the user's todo tasks to match the given top->bottom order.
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const orderedIds: unknown = body.orderedIds;
    if (!Array.isArray(orderedIds) || !orderedIds.every((x) => typeof x === "string")) {
      return NextResponse.json({ error: "orderedIds must be a string[]" }, { status: 400 });
    }
    const supabase = createClient();
    const { error } = await supabase.rpc("reorder_tasks", {
      p_user: user.id,
      ordered_ids: orderedIds,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
