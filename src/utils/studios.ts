// Studio search that understands merged duplicates (developers.canonical_developer_id,
// migration 20261031000005): a hit on a duplicate's name ("Lucas Arts") returns
// the main studio (LucasArts) once, instead of a page that only redirects.
export async function searchStudios(
  db: any,
  query: string,
  limit: number,
): Promise<{ id: string; name: string; slug: string }[]> {
  const { data } = await db
    .from('developers')
    .select('id, name, slug, canonical_developer_id')
    .ilike('name', `%${query}%`)
    .limit(limit * 2);
  const rows: { id: string; name: string; slug: string; canonical_developer_id: string | null }[] = data ?? [];

  const canonIds = [...new Set(rows.map((r) => r.canonical_developer_id).filter((id): id is string => !!id))];
  const canonById = new Map<string, { id: string; name: string; slug: string }>();
  if (canonIds.length) {
    const { data: canon } = await db.from('developers').select('id, name, slug').in('id', canonIds);
    for (const c of canon ?? []) canonById.set(c.id, c);
  }

  const out: { id: string; name: string; slug: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const studio = r.canonical_developer_id ? canonById.get(r.canonical_developer_id) : r;
    if (!studio || seen.has(studio.id)) continue;
    seen.add(studio.id);
    out.push({ id: studio.id, name: studio.name, slug: studio.slug });
    if (out.length === limit) break;
  }
  return out;
}
