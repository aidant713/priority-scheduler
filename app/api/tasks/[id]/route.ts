import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { clampEstimate, errorResponse } from "@/lib/api";
import { renumber } from "@/lib/tasks-server";

// PATCH /api/tasks/:id — edit fields or change status (done/archived removes it)
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const supabase = createClient();

    const patch: Record<string, unknown> = {};
    if (typeof body.title === "string") patch.title = body.title.trim();
    if ("notes" in body) patch.notes = body.notes ?? null;
    if ("deadline" in body) patch.deadline = body.deadline ?? null;
    if ("estimateMinutes" in body) patch.estimate_minutes = clampEstimate(body.estimateMinutes);
    if (typeof body.status === "string" && ["todo", "done", "archived"].includes(body.status)) {
      patch.status = body.status;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no updatable fields" }, { status: 400 });
    }

    // returning to the list (restore / undo-done): give it a fresh bottom
    // priority so it can't collide with the existing contiguous ordering
    if (patch.status === "todo") {
      const { data: maxRow } = await supabase
        .from("tasks")
        .select("priority")
        .eq("user_id", user.id)
        .eq("status", "todo")
        .order("priority", { ascending: false })
        .limit(1)
        .maybeSingle();
      patch.priority = maxRow ? (maxRow.priority as number) + 1 : 0;
    }

    const { data, error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (error) throw error;

    // leaving the list creates a gap — renumber the survivors
    if (patch.status && patch.status !== "todo") await renumber(supabase, user.id);

    return NextResponse.json({ task: data });
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE /api/tasks/:id — hard delete (cascade removes scheduled_blocks)
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.id);
    if (error) throw error;
    await renumber(supabase, user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
