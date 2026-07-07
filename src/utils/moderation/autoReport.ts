import type { SupabaseAdmin } from "../api";

function botProfileId(): string | undefined {
  return import.meta.env.MODERATION_BOT_PROFILE_ID || process.env.MODERATION_BOT_PROFILE_ID;
}

export interface AutoReportParams {
  targetType: "review" | "comment" | "recommendation";
  targetId: string;
  categories: string[];
}

/**
 * Files an automated report using the moderation bot's profile as reporter_id,
 * reusing the existing reports table/admin queue — no schema change needed.
 */
export async function fileAutoReport(db: SupabaseAdmin, params: AutoReportParams): Promise<void> {
  const reporterId = botProfileId();
  if (!reporterId) {
    console.error("[moderation] MODERATION_BOT_PROFILE_ID not set — skipping auto-report");
    return;
  }

  const notes = `Auto-flagged: ${params.categories.join(", ")}`.slice(0, 500);

  const { error } = await db.from("reports").insert({
    reporter_id: reporterId,
    target_type: params.targetType,
    target_id: params.targetId,
    reason: "other",
    notes,
    status: "pending",
  });

  if (error) {
    // 23505 = unique_violation — this content was already auto-flagged, which is
    // expected (the reporter+target+type unique constraint enforces the dedupe).
    if (error.code !== "23505") {
      console.error("[moderation] auto-report insert error:", JSON.stringify(error));
    }
  }
}
