// Attaches `youtube_video_id` to review rows with a separate query instead of
// adding the column to each page's main select. If that query fails (e.g. the
// column's migration hasn't been applied yet) the rows come back unchanged, so
// a feed can never go empty because of videos — cards just render without one.

const CHUNK = 100; // keeps the `id=in.(...)` query string well under URL limits

export async function attachReviewVideos<T extends { id?: string | null }>(
  db: any,
  rows: T[] | null | undefined,
): Promise<T[]> {
  const list = rows ?? [];
  const ids = [...new Set(list.map((r) => r?.id).filter(Boolean))] as string[];
  if (ids.length === 0) return list;

  const byId: Record<string, string> = {};
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await db
        .from('reviews')
        .select('id, youtube_video_id')
        .in('id', ids.slice(i, i + CHUNK))
        .not('youtube_video_id', 'is', null);
      if (error) {
        console.error('[reviewVideos] lookup error (non-fatal):', JSON.stringify(error));
        return list;
      }
      for (const r of data ?? []) if (r.youtube_video_id) byId[r.id] = r.youtube_video_id;
    }
  } catch (e) {
    console.error('[reviewVideos] lookup error (non-fatal):', e);
    return list;
  }

  for (const r of list) {
    if (r?.id && byId[r.id]) (r as any).youtube_video_id = byId[r.id];
  }
  return list;
}
