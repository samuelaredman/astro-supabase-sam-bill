import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext } from "../../../utils/database";
import { landingAfterConfirm } from "../../../utils/groupJoin";

// Bridges client-side-only tokens (delivered via a URL hash fragment, which
// the server can never see) into a real, server-readable session cookie.
// Used by /auth/confirm after extracting #access_token/#refresh_token from
// the browser's location hash — createSupabaseServerClientFromContext's
// setSession() call here writes the Set-Cookie the rest of the (server-
// rendered) site relies on for auth.getUser().
export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { access_token, refresh_token } = await context.request.json();

  if (!access_token || !refresh_token) {
    return new Response(JSON.stringify({ error: "Missing tokens." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Signed up from a group page: join it and tell /auth/confirm to go there
  const redirect = await landingAfterConfirm(data.user);

  return new Response(JSON.stringify({ success: true, redirect }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
