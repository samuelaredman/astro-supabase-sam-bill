import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../utils/database";
import { json } from "../../utils/api";

export const POST: APIRoute = async (context) => {
  const bad = (msg: string) => json({ error: msg }, 400);

  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sign in to send a message." }, 401);

  let body: any;
  try { body = await context.request.json(); } catch { return bad("Invalid JSON."); }

  const { name, subject, message } = body ?? {};
  // Email always comes from the verified auth account, not the request body
  const email = user.email ?? '';

  if (!name?.trim() || !email || !message?.trim()) {
    return bad("Name and message are required.");
  }
  if (message.trim().length < 10) {
    return bad("Message must be at least 10 characters.");
  }
  if (name.trim().length > 120 || (subject?.trim().length ?? 0) > 200 || message.trim().length > 5000) {
    return bad("One or more fields exceed the maximum length.");
  }

  const db = getSupabaseAdmin();

  // Look up profile_id for this auth user
  const { data: profile } = await db
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  const { error } = await db
    .from('contact_submissions')
    .insert({
      profile_id: profile?.id ?? null,
      name: name.trim(),
      email: email.toLowerCase(),
      subject: subject?.trim() || null,
      message: message.trim(),
    });

  if (error) {
    console.error('contact insert error', JSON.stringify(error));
    return json({ error: "Failed to submit. Please try again." }, 500);
  }

  return json({ ok: true });
};
