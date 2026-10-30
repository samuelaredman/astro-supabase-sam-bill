-- Restore showcase picks the 20261030000000 migration dropped because their
-- game wasn't imported yet. Run AFTER importing the games. Rebuilds each
-- backed-up showcase with the same rules (order kept, duplicates dropped,
-- IGDB ids mapped through games.igdb_id) and writes it only where it adds
-- picks back — a profile whose owner changed their showcase since is skipped.
with e as (
  select b.id as pid, x.ord,
    case when jsonb_typeof(x.elem) = 'string' then x.elem #>> '{}' else x.elem ->> 'id' end as gid
  from profiles_showcase_backup_20261030 b
  cross join lateral jsonb_array_elements(b.showcase_games) with ordinality x(elem, ord)
), resolved as (
  select e.pid, e.ord, coalesce(g1.id, g2.id)::text as game_id
  from e
  left join games g1 on g1.id = (case when e.gid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then e.gid::uuid end)
  left join games g2 on g2.igdb_id = (case when e.gid ~ '^[0-9]{1,9}$' then e.gid::int end)
), firsts as (
  select pid, game_id, min(ord) as ord from resolved where game_id is not null group by pid, game_id
), rebuilt as (
  select pid, jsonb_agg(to_jsonb(game_id) order by ord) as showcase from firsts group by pid
)
update profiles p
set showcase_games = r.showcase
from rebuilt r
where p.id = r.pid
  and jsonb_typeof(p.showcase_games) = 'array'
  and r.showcase @> p.showcase_games          -- only adds picks back
  and r.showcase <> p.showcase_games;          -- and only where something is missing
