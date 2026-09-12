import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { DEFAULT_SETTINGS } from "@/lib/types";

// OAuth redirect target. Exchanges the code for a session and, on first consent,
// captures the Google refresh token (encrypted) so the server can create/delete
// calendar events later.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/login?error=exchange`);
  }

  const user = data.session.user;
  const refresh = data.session.provider_refresh_token;

  // Ensure a settings row exists; store the refresh token only if Google gave us
  // one this time (it does on first consent / with prompt=consent). Omitting the
  // column on later logins preserves the previously stored token.
  const patch: Record<string, unknown> = { user_id: user.id, ...DEFAULT_SETTINGS };
  if (refresh) patch.google_refresh_token = encrypt(refresh);

  // Don't clobber existing settings: only insert defaults if the row is new.
  const { data: existing } = await supabase
    .from("user_settings")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    if (refresh) {
      await supabase
        .from("user_settings")
        .update({ google_refresh_token: encrypt(refresh) })
        .eq("user_id", user.id);
    }
  } else {
    await supabase.from("user_settings").insert(patch);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
