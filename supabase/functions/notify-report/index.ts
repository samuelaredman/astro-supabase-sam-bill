import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const REASON_LABELS: Record<string, string> = {
  spam:          "Spam or misleading",
  harassment:    "Harassment or hate",
  spoilers:      "Unmarked spoilers",
  inappropriate: "Inappropriate content",
  other:         "Other",
};

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload.record;

    if (!record) {
      return new Response("No record in payload", { status: 400 });
    }

    const targetType  = record.target_type ?? "unknown";
    const targetId    = record.target_id   ?? "—";
    const reason      = REASON_LABELS[record.reason] ?? record.reason ?? "—";
    const notes       = record.notes ?? null;
    const time        = new Date(record.created_at).toLocaleString("en-US", { timeZone: "America/New_York" });

    // Look up the reporter's username via admin client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    let reporterUsername = "Unknown";
    if (record.reporter_id) {
      const { data: profile } = await db
        .from("profiles")
        .select("username")
        .eq("id", record.reporter_id)
        .single();
      if (profile?.username) reporterUsername = `@${profile.username}`;
    }

    // Build a direct link if it's a review
    const targetLink = targetType === "review"
      ? `https://chekpoint.gg/reviews/${targetId}`
      : targetType === "profile"
        ? `https://chekpoint.gg/reviewers/${targetId}`
        : null;

    const discordUrl = Deno.env.get("DISCORD_REPORTS_WEBHOOK_URL");
    if (discordUrl) {
      const fields: any[] = [
        { name: "Type",     value: targetType,        inline: true },
        { name: "Reason",   value: reason,             inline: true },
        { name: "Reporter", value: reporterUsername,   inline: true },
      ];
      if (notes) fields.push({ name: "Notes", value: notes.slice(0, 500) });
      if (targetLink) fields.push({ name: "Link", value: targetLink });

      await fetch(discordUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [
            {
              title: "🚩 New Report — Chekpoint",
              color: 0xf87171,
              fields,
              footer: { text: time },
            },
          ],
        }),
      });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("notify-report error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
