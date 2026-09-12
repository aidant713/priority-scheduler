import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api";

// POST /api/google/disconnect — forget the stored Google refresh token.
// (Existing calendar events are left in place; the next sync won't run until
// the user reconnects.)
export async function POST() {
  try {
    const user = await requireUser();
    const supabase = createClient();
    const { error } = await supabase
      .from("user_settings")
      .update({ google_refresh_token: null })
      .eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
