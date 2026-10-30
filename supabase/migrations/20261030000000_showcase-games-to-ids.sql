-- profiles.showcase_games: rewrite legacy {id, title, …} snapshots to game IDs
-- ------------------------------------------------------------------------
-- Since Oct 29 (6b1d2fd) the profile page hydrates showcase_games as an array
-- of games.id strings and skips anything else, so the 60 profiles that still
-- held {id, title, cover_img_url, slug} objects rendered an empty showcase.
-- This rewrites each entry to its game id, keeping order and dropping exact
-- duplicates.
--
-- Some old entries hold a raw IGDB id instead of a games.id (picked from an
-- IGDB search result before it was imported). Those are mapped through
-- games.igdb_id, so import those games first or they get dropped — a NOTICE
-- says how many were dropped.
--
-- Safe to re-run: only touches profiles that still contain an object entry.
-- The pre-change values are kept in profiles_showcase_backup_20261030
-- (service role only); drop it once the showcases look right. Rollback:
--   update profiles p set showcase_games = b.showcase_games
--   from profiles_showcase_backup_20261030 b where p.id = b.id;

create table if not exists profiles_showcase_backup_20261030 as
select id, showcase_games from profiles
where jsonb_typeof(showcase_games) = 'array'
  and exists (select 1 from jsonb_array_elements(showcase_games) o where jsonb_typeof(o) = 'object');

alter table profiles_showcase_backup_20261030 enable row level security;
revoke all on profiles_showcase_backup_20261030 from anon, authenticated;

do $$
declare
  before_count int;
  after_count int;
  updated int;
begin
  create temp table showcase_fix on commit drop as
  with targets as (
    select id from profiles
    where jsonb_typeof(showcase_games) = 'array'
      and exists (select 1 from jsonb_array_elements(showcase_games) o where jsonb_typeof(o) = 'object')
  ), e as (
    select p.id as pid, x.ord,
      case when jsonb_typeof(x.elem) = 'string' then x.elem #>> '{}' else x.elem ->> 'id' end as gid
    from profiles p
    join targets t on t.id = p.id
    cross join lateral jsonb_array_elements(p.showcase_games) with ordinality x(elem, ord)
  ), resolved as (
    -- CASE guards the casts: Postgres doesn't short-circuit join conditions.
    select e.pid, e.ord, coalesce(g1.id, g2.id)::text as game_id
    from e
    left join games g1 on g1.id = (case when e.gid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then e.gid::uuid end)
    left join games g2 on g2.igdb_id = (case when e.gid ~ '^[0-9]{1,9}$' then e.gid::int end)
  ), firsts as (
    select pid, game_id, min(ord) as ord from resolved where game_id is not null group by pid, game_id
  )
  select t.id as pid,
    (select count(*) from e where e.pid = t.id)::int as before_n,
    coalesce((select jsonb_agg(to_jsonb(f.game_id) order by f.ord) from firsts f where f.pid = t.id), '[]'::jsonb) as showcase
  from targets t;

  select coalesce(sum(before_n), 0), coalesce(sum(jsonb_array_length(showcase)), 0)
    into before_count, after_count from showcase_fix;

  update profiles p set showcase_games = f.showcase
  from showcase_fix f where p.id = f.pid;
  get diagnostics updated = row_count;

  raise notice 'showcase_games: % profiles rewritten, % entries -> % (% dropped as unresolvable)',
    updated, before_count, after_count, before_count - after_count;
end $$;
