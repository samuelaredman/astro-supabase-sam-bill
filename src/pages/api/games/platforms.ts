import type { APIRoute } from "astro";
import { getSupabase } from "../../../utils/database";

export const GET: APIRoute = async ({ url }) => {
  const gameId = url.searchParams.get('id');
  if (!gameId) return new Response(JSON.stringify([]), { status: 400, headers: { "Content-Type": "application/json" } });

  const supabase = getSupabase();
  const { data } = await (supabase as any)
    .from('game_platforms')
    .select('platforms(id, name, display_group, display_order)')
    .eq('game_id', gameId);

  // Deduplicate by display_group, keeping the first match
  const seen = new Set();
  const platforms = (data ?? [])
    .map((row: any) => row.platforms)
    .filter(Boolean)
    .filter((p: any) => p.display_group) // hide ungrouped legacy platforms
    .sort((a: any, b: any) => (a.display_order ?? 99) - (b.display_order ?? 99))
    .filter((p: any) => {
      if (seen.has(p.display_group)) return false;
      seen.add(p.display_group);
      return true;
    })
    .map((p: any) => ({ id: p.id, name: p.display_group })); // show group name, not raw name

  return new Response(JSON.stringify(platforms), { status: 200, headers: { "Content-Type": "application/json" } });
};
