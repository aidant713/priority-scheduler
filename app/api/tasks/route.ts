import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { clampEstimate, errorResponse } from "@/lib/api";

// GET /api/tasks — live (todo) tasks in priority order
export async function GET() {
  try {
    const user = await requireUser();
    const supabase = createClient();
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "todo")
      .order("priority", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ tasks: data });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/tasks — quick-add; lands at the bottom of the list
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const title = String(body.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const supabase = createClient();
    const { data: maxRow } = await supabase
      .from("tasks")
      .select("priority")
      .eq("user_id", user.id)
      .eq("status", "todo")
      .order("priority", { ascending: false })
      .limit(1)
      .maybeSingle();

    const priority = maxRow ? (maxRow.priority as number) + 1 : 0;

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: user.id,
        title,
        estimate_minutes: clampEstimate(body.estimateMinutes, 30),
        priority,
        notes: body.notes ?? null,
        deadline: body.deadline ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ task: data });
  } catch (e) {
    return errorResponse(e);
  }
}
