/**
 * Supabase caps a single response at 1000 rows and truncates silently. Page
 * through with .range() until a short page comes back. `build` runs one ranged
 * query; give it a stable .order() so pages can't overlap or skip rows.
 *
 * Stops at the first error and returns what it has — the same degradation as a
 * failed single query (callers treat missing rows as "no data").
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
