import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../utils/database";
import { json } from "../../../../utils/api";

// Returns DLCs + editions for a given base game. Powers the game slug page's
// "DLC & Editions" tab. Public — matches the editions query that currently
// lives inline on games/[slug].astro. Service-role client because
// game_review_stats grants SELECT only to service_role.
//
// DLCs: rows the base game points at via game_relationships with a DLC-ish
//   relation_type, filtered to canonical rows (editions-of-DLCs don't belong
//   in the DLC list).
// Editions: rows whose canonical_game_id points back at the base game (existing
//   canonical-graph semantics).

const DLC_RELATION_TYPES = ["dlc", "expansion", "standalone_expansion"] as const;

type DlcEntry = {
  id: string;
  title: string;
  slug: string | null;
  cover_img_url: string | null;
  date_released: string | null;
  igdb_category: number | null;
  relation_type: string;
  game_description: string | null;
  platforms: Array<{ id: string; name: string }>;
  avg_score: number | null;
  review_count: number;
};

type EditionEntry = {
  id: string;
  title: string;
  slug: string | null;
  version_title: string | null;
  cover_img_url: string | null;
  date_released: string | null;
};

export const GET: APIRoute = async ({ params }) => {
  const gameId = params.id;
  if (!gameId) return json({ error: "Missing game id." }, 400);

  const db = getSupabaseAdmin() as any;

  // Confirm the game exists. maybeSingle — a stray id shouldn't 500.
  const { data: game } = await db
    .from("games")
    .select("id")
    .eq("id", gameId)
    .maybeSingle();
  if (!game) return json({ error: "Game not found." }, 404);

  const [{ data: relRows }, { data: editionRows }] = await Promise.all([
    db
      .from("game_relationships")
      .select("to_game_id, relation_type")
      .eq("from_game_id", gameId)
      .in("relation_type", DLC_RELATION_TYPES),
    db
      .from("games")
      .select("id, title, slug, version_title, cover_img_url, date_released")
      .eq("canonical_game_id", gameId)
      .order("date_released", { ascending: true, nullsFirst: false }),
  ]);

  const relTypeById = new Map<string, string>(
    (relRows ?? []).map((r: any) => [r.to_game_id, r.relation_type]),
  );
  const dlcIds = [...relTypeById.keys()];

  let dlcs: DlcEntry[] = [];
  if (dlcIds.length > 0) {
    const [{ data: dlcGames }, { data: statRows }] = await Promise.all([
      db
        .from("games")
        .select("id, title, slug, cover_img_url, date_released, igdb_category, game_description, game_platforms(platforms(id, name, display_group, display_order))")
        .in("id", dlcIds)
        .is("canonical_game_id", null),
      db
        .from("game_review_stats")
        .select("game_id, avg_score, review_count")
        .in("game_id", dlcIds),
    ]);

    const statsById = new Map<string, { avg_score: number | null; review_count: number }>(
      (statRows ?? []).map((r: any) => [
        r.game_id,
        { avg_score: r.avg_score ?? null, review_count: r.review_count ?? 0 },
      ]),
    );

    dlcs = (dlcGames ?? [])
      .map((g: any) => ({
        id: g.id,
        title: g.title,
        slug: g.slug ?? null,
        cover_img_url: g.cover_img_url ?? null,
        date_released: g.date_released ?? null,
        igdb_category: g.igdb_category ?? null,
        relation_type: relTypeById.get(g.id) ?? "dlc",
        game_description: g.game_description ?? null,
        platforms: dedupePlatforms(g.game_platforms),
        avg_score: statsById.get(g.id)?.avg_score ?? null,
        review_count: statsById.get(g.id)?.review_count ?? 0,
      }))
      .sort(byReleaseAsc);
  }

  const editions: EditionEntry[] = (editionRows ?? []).map((g: any) => ({
    id: g.id,
    title: g.title,
    slug: g.slug ?? null,
    version_title: g.version_title ?? null,
    cover_img_url: g.cover_img_url ?? null,
    date_released: g.date_released ?? null,
  }));

  return json({ dlcs, editions });
};

function byReleaseAsc(a: { date_released: string | null }, b: { date_released: string | null }): number {
  if (!a.date_released && !b.date_released) return 0;
  if (!a.date_released) return 1;
  if (!b.date_released) return -1;
  return a.date_released.localeCompare(b.date_released);
}

// Collapse per-game platforms into display-group labels (PS4 + PS4 Pro →
// "PlayStation 4"), preserving the display_order sort. Mirrors the collapse
// logic in src/pages/api/games/platforms.ts and the game slug page.
function dedupePlatforms(gps: any): Array<{ id: string; name: string }> {
  const seen = new Set<string>();
  return (gps ?? [])
    .map((gp: any) => gp.platforms)
    .filter((p: any) => p && (p.display_group || p.name))
    .sort((a: any, b: any) => (a.display_order ?? 99) - (b.display_order ?? 99))
    .filter((p: any) => {
      const key = p.display_group ?? p.name;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    })
    .map((p: any) => ({ id: p.id, name: p.display_group ?? p.name }));
}
