Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload.record;

    if (!record) {
      return new Response("No record in payload", { status: 400 });
    }

    const name    = record.name    ?? "Unknown";
    const email   = record.email   ?? "Unknown";
    const subject = record.subject ?? "(no subject)";
    const message = record.message ?? "";
    const time    = new Date(record.created_at).toLocaleString("en-US", { timeZone: "America/New_York" });

    const promises: Promise<any>[] = [];

    // ── Discord ───────────────────────────────────────────────────────────────
    const discordUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
    if (discordUrl) {
      promises.push(
        fetch(discordUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [
              {
                title: "📬 New Contact Submission — Chekpoint",
                color: 0x6050c8,
                fields: [
                  { name: "From",    value: `${name} (${email})`, inline: true },
                  { name: "Subject", value: subject,               inline: true },
                  { name: "Message", value: message.slice(0, 1000) },
                ],
                footer: { text: time },
              },
            ],
          }),
        })
      );
    }

    // ── Email via Resend ──────────────────────────────────────────────────────
    const resendKey   = Deno.env.get("RESEND_API_KEY");
    const notifyEmail = Deno.env.get("NOTIFY_EMAIL");
    if (resendKey && notifyEmail) {
      promises.push(
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: "Chekpoint <noreply@chekpoint.gg>",
            to: [notifyEmail],
            subject: `New contact from ${name}: ${subject}`,
            html: `
              <p><strong>From:</strong> ${name} (${email})</p>
              <p><strong>Subject:</strong> ${subject}</p>
              <hr />
              <p>${message.replace(/\n/g, "<br>")}</p>
              <hr />
              <p style="color:#999;font-size:12px">Received ${time}</p>
            `,
          }),
        })
      );
    }

    await Promise.all(promises);

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("notify-contact error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
