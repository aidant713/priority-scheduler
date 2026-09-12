import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

/** Current signed-in user, or null. */
export async function getUser(): Promise<User | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** For API routes: returns the user or throws a 401-shaped error. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) {
    const err = new Error("Unauthorized") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return user;
}
