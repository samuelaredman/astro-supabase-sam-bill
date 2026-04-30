import type { APIRoute } from "astro";
import { getSupabase } from "../../../utils/database";

export const GET: APIRoute = async ({ url }) => {
  const gameId = url.searchParams.get('id');
  if (!gameId) return new Response(JSON.stringify([]), { status: 400, headers: { "Content-Type": "application/json" } });

  const supabase = getSupabase();
  const { data } = await (supabase as any)
    .from('game_platforms')
    .select('platforms(id, name)')
    .eq('game_id', gameId);

  const platforms = (data ?? []).map((row: any) => row.platforms).filter(Boolean);
  return new Response(JSON.stringify(platforms), { status: 200, headers: { "Content-Type": "application/json" } });
};
