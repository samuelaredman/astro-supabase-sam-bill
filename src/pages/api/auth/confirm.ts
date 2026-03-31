export const prerender = false;

import { createSupabaseServerClient } from "../../../utils/database";
import type { APIRoute } from "astro";
import type { EmailOtpType } from "@supabase/supabase-js";

export const GET: APIRoute = async ({ request, redirect }) => {
  const response = new Response();
  const supabase = createSupabaseServerClient(request, response);

  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return redirect("/");
    }
  }

  return redirect("/signin?error=confirmation_failed");
};
