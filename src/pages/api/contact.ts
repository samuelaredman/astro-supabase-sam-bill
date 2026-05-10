import type { APIRoute } from "astro";
import { getSupabase } from "../../utils/database";

export const POST: APIRoute = async ({ request }) => {
  const json = "Content-Type: application/json";
  const bad = (msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status: 400, headers: { "Content-Type": "application/json" } });

  let body: any;
  try { body = await request.json(); } catch { return bad("Invalid JSON."); }

  const { name, email, subject, message } = body ?? {};

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return bad("Name, email, and message are required.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return bad("Please enter a valid email address.");
  }
  if (message.trim().length < 10) {
    return bad("Message must be at least 10 characters.");
  }
  if (name.trim().length > 120 || email.trim().length > 254 ||
      (subject?.trim().length ?? 0) > 200 || message.trim().length > 5000) {
    return bad("One or more fields exceed the maximum length.");
  }

  const supabase = getSupabase();
  const { error } = await (supabase as any)
    .from('contact_submissions')
    .insert({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      subject: subject?.trim() || null,
      message: message.trim(),
    });

  if (error) {
    console.error('contact insert error', error);
    return new Response(JSON.stringify({ error: "Failed to submit. Please try again." }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};
