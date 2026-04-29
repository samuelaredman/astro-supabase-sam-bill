export const prerender = false;
import { createSupabaseServerClientFromContext } from "../../../utils/database";
import type { APIRoute } from "astro";
import type { EmailOtpType } from "@supabase/supabase-js";

export const GET: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const url = new URL(context.request.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return context.redirect("/");
  }

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return context.redirect("/");
  }

  return context.redirect("/signin?error=confirmation_failed");
};
