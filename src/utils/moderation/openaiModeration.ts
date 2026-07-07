const MODERATION_URL = "https://api.openai.com/v1/moderations";

function apiKey(): string | undefined {
  return import.meta.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
}

export interface ModerationResult {
  flagged: boolean;
  categories: string[];
}

const FAIL_OPEN: ModerationResult = { flagged: false, categories: [] };

async function classify(input: unknown): Promise<ModerationResult> {
  const key = apiKey();
  if (!key) {
    console.error("[moderation] OPENAI_API_KEY not set — skipping classification");
    return FAIL_OPEN;
  }

  try {
    const res = await fetch(MODERATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input }),
    });

    if (!res.ok) {
      console.error("[moderation] API error:", res.status, await res.text());
      return FAIL_OPEN;
    }

    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) return FAIL_OPEN;

    const categories = Object.entries(result.categories ?? {})
      .filter(([, flagged]) => flagged === true)
      .map(([category]) => category);

    return { flagged: !!result.flagged, categories };
  } catch (e) {
    // A moderation-provider outage must never block signups/reviews/uploads.
    console.error("[moderation] request failed, failing open:", e);
    return FAIL_OPEN;
  }
}

export function classifyText(text: string): Promise<ModerationResult> {
  return classify(text);
}

export function classifyImageUrl(url: string): Promise<ModerationResult> {
  return classify([{ type: "image_url", image_url: { url } }]);
}
