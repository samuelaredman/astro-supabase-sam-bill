// Resolve a Steam review to a Chekpoint `games.id`, importing from IGDB when
// we don't have it. The cascade is Steam-first (matching by appid), falling
// through to the same title-based IGDB search used by the Backloggd importer.
//
// Cascade (stops at first hit):
//   1. any user_game_status row with steam_appid = appid — this is populated
//      by the Steam library sync (api/steam/import.ts), so if the user has
//      already synced their library, every reviewed game is a single-lookup
//      hit. Cross-user is fine: appid is global.
//   2. match_steam_games RPC by title — reuses the tuned Steam-title matcher
//      that the library sync uses, so games without an existing appid link
//      still find their Chekpoint row through the same title-normalization.
//   3. IGDB search by title, gated on the title matching what we searched
//      for — imports the game if IGDB has it. Same shape as step 6 in
//      backloggd/matchGame.ts.
//
// Returns null only when the game can't be identified at all.

import { ALLOWED_GAME_CATEGORIES, foldDiacritics, importGameByIgdbId } from "../games";
import { escapeIgdbString, igdbFetch } from "../igdb";

export type GameMatch = { gameId: string; method: string; imported: boolean };

export type SteamMatchInput = { steam_appid: number; title: string };

const norm = (s: string) =>
  foldDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function titlesMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

export async function matchSteamReviewGame(
  db: any,
  input: SteamMatchInput,
): Promise<GameMatch | null> {
  const appid = input.steam_appid;

  // 1 — appid lookup via user_game_status. Any row with steam_appid=appid
  // points at the same games.id, so pick the first one.
  if (Number.isFinite(appid) && appid > 0) {
    const { data: statusRow } = await db
      .from("user_game_status")
      .select("game_id")
      .eq("steam_appid", appid)
      .limit(1)
      .maybeSingle();
    if (statusRow?.game_id) {
      return { gameId: statusRow.game_id, method: "appid", imported: false };
    }
  }

  const title = (input.title ?? "").trim();
  if (!title) return null;

  // 2 — match_steam_games RPC by title (case-insensitive, tuned for Steam).
  const { data: rpcRows } = await db.rpc("match_steam_games", {
    steam_titles: [title],
  });
  const rpcHit = Array.isArray(rpcRows) && rpcRows.length > 0 ? rpcRows[0] : null;
  if (rpcHit?.id) {
    return { gameId: rpcHit.id, method: "steam-title", imported: false };
  }

  // 3 — IGDB search by title, gated on the title actually matching. Steam
  // titles include ™/®/edition suffixes that IGDB doesn't, so we allow prefix
  // matches in either direction.
  try {
    const rows = await igdbFetch(
      "games",
      `fields id, name, slug, first_release_date;
       search "${escapeIgdbString(title)}";
       where game_type = (${ALLOWED_GAME_CATEGORIES.join(",")});
       limit 5;`,
    );
    const igdbHit = (Array.isArray(rows) ? rows : []).find((g: any) =>
      titlesMatch(g.name ?? "", title),
    );
    if (igdbHit) {
      const res = await importGameByIgdbId(db, igdbHit.id);
      if (res.ok) return { gameId: res.game.id, method: "igdb-search", imported: true };
    }
  } catch (e) {
    console.error("[steam-reviews/matchGame] igdb fallback error:", e);
  }

  return null;
}
