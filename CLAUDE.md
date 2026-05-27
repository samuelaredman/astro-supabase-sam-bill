# CLAUDE.md — Chekpoint.gg

## What this product is

Chekpoint is a community game review site. Users create accounts, score games 1–10,
write reviews, follow other reviewers, react and comment on reviews, manage a personal
watchlist, and organize into groups. The feed surfaces recent and hot-take reviews.
Discovery happens via game pages, reviewer profiles, genre/platform/developer pages,
and search. Groups have shared watchlists, gaming sessions, and member management.

This file is the source of truth for any AI agent working in this repo.
Read it fully before writing or modifying any code.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Astro 5, `output: 'server'` — full SSR, no static pages unless explicitly noted |
| Hosting | Netlify (serverless functions via `@astrojs/netlify` adapter) |
| Database + Auth | Supabase (Postgres + GoTrue + Storage) |
| CSS | Tailwind v4 via Vite plugin — NOT PostCSS. Uses `@tailwindcss/vite` in `astro.config.ts` |
| Language | TypeScript strict mode (`astro/tsconfigs/strict`) |
| Site URL | https://chekpoint.gg |

---

## File map

```
src/
  utils/
    database.ts         ← All Supabase client factories. Read before any DB work.
    igdb.ts             ← IGDB API helpers (cover URLs, search)
  pages/
    api/                ← Netlify serverless endpoints. One file = one endpoint.
      auth/             ← signup, signin, signout, confirm, reset-password, update-password
      reviews/          ← create, update, delete, vote, react
      comments/         ← create
      groups/           ← create, update, delete, join, leave, avatar, banner
                           invite/(send, respond)
                           members/(remove, update-role)
                           sessions/(create, delete)
                           watchlist/toggle
      profile/          ← update, avatar, banner
      notifications/    ← count, mark-read
      follows/          ← toggle, notify
      games/            ← search, import, platforms
      watchlist/        ← toggle
      reports/          ← create
      contact.ts
    games/[slug].astro
    reviewers/[username].astro
    reviewers/[username]/games.astro
    reviews/[id].astro
    groups/[id]/(index, settings, top-games, top-rated).astro
    groups/(index, create).astro
    index.astro, search.astro, hot-takes.astro, rankings.astro
    discover.astro, following.astro, notifications.astro
    profile.astro, settings.astro
    signin.astro, signup.astro, forgot-password.astro, reset-password-confirm.astro
    welcome.astro, contact.astro, terms.astro, privacy.astro
  components/
    Layout.astro        ← Wraps all non-standalone pages. OG, nav, theme CSS vars.
    ReviewCard.astro    ← Feed card used on index, game, reviewer, search pages.
    Header.astro
    Footer.astro
    EditModal.astro     ← Review edit overlay
    ReportModal.astro   ← Report overlay
  styles/
    globals.css         ← CSS custom properties, resets
    shared.css          ← Reusable utility classes
supabase/
  migrations/           ← Applied in timestamp order. Source of truth for schema history.
  types.ts              ← ⚠️ STALE — only has boilerplate `frameworks` table. Do NOT use
                           for column reference. Tables below are the source of truth.
```

---

## Database schema

> ⚠️ `supabase/types.ts` is stale and inaccurate. Do not trust it for column names or types.
> After every migration run: `supabase gen types typescript --local > supabase/types.ts`
> The `as any` casts in the codebase are a workaround for this — they are not
> permission to skip verifying that columns exist before querying them.

### Core tables

| Table | Column | Type | Nullable | Default |
|-------|--------|------|----------|---------|
| `profiles` | `id` | uuid PK | NO | gen_random_uuid() |
| | `auth_user_id` | uuid UNIQUE FK→auth.users | NO | — |
| | `username` | text UNIQUE | NO | — |
| | `avatar_url` | text | YES | — |
| | `banner_url` | text | YES | — |
| | `favorite_game_id` | uuid FK→games | YES | — |
| `games` | `id` | uuid PK | NO | gen_random_uuid() |
| | `title` | text | NO | — |
| | `slug` | text UNIQUE | YES | — |
| | `game_description` | text | YES | — |
| | `cover_img_url` | text | YES | — |
| | `date_released` | date | YES | — |
| | `igdb_id` | int | YES | — |
| | `search_vector` | tsvector | YES | — |
| | `title_search` | tsvector | YES | — |
| `platforms` | `id` | uuid PK | NO | uuid_generate_v4() |
| | `name` | text UNIQUE | NO | — |
| | `slug` | text UNIQUE | NO | — |
| | `igdb_id` | int | YES | — |
| | `banner_url` | text | YES | — |
| `genres` | `id` | uuid PK | NO | gen_random_uuid() |
| | `name` | text UNIQUE | NO | — |
| | `slug` | text | YES | — |
| | `igdb_id` | int | YES | — |
| `developers` | `id` | uuid PK | NO | uuid_generate_v4() |
| | `name` | text UNIQUE | NO | — |
| | `slug` | text UNIQUE | NO | — |
| | `country` | text | YES | — |
| | `description` | text | YES | — |
| | `website_url` | text | YES | — |
| | `logo_url` | text | YES | — |
| | `founded_year` | int | YES | — |
| | `igdb_id` | int | YES | — |

> ⚠️ The table is named `developers`, not `studios`. There is no `studios` table.

### Junction tables (game relationships)

| Table | Columns | PK / Constraint |
|-------|---------|-----------------|
| `game_genres` | `game_id→games`, `genre_id→genres` | PK(game_id, genre_id) |
| `game_platforms` | `game_id→games`, `platform_id→platforms` | PK(game_id, platform_id) |
| `game_companies` | `game_id→games`, `company_id→developers`, `role text` | PK(game_id, company_id, role) |

`game_companies.role` distinguishes developer vs publisher relationships for the same company on the same game.

### Review system

| Table | Column | Type | Nullable | Notes |
|-------|--------|------|----------|-------|
| `reviews` | `id` | uuid PK | NO | |
| | `profile_id` | uuid FK→profiles | NO | |
| | `game_id` | uuid FK→games | NO | |
| | `score` | int | NO | 1–10 integers only |
| | `title` | text | YES | |
| | `body` | text | NO | Was VARCHAR — see Known Pitfalls |
| | `status` | text | NO | `'published'` or `'draft'` |
| | `platform_played_on` | uuid FK→platforms | YES | Column is `platform_played_on`, not `platform_id` |
| | `play_time_hours` | int | YES | |
| | `contains_spoilers` | bool | NO | |
| | `published_at` | timestamptz | YES | |
| | `created_at` | timestamptz | YES | |
| `review_votes` | `id` | uuid PK | NO | gen_random_uuid() |
| | `profile_id` | uuid FK→profiles | NO | |
| | `review_id` | uuid FK→reviews | NO | |
| | `vote` | smallint | NO | +1 or -1 only |
| `review_reactions` | `id` | uuid PK | NO | |
| | `review_id` | uuid FK→reviews | NO | |
| | `profile_id` | uuid FK→profiles | NO | |
| | `reaction_type` | text | NO | |
| `review_comments` | `id` | uuid PK | NO | |
| | `review_id` | uuid FK→reviews | NO | |
| | `profile_id` | uuid FK→profiles | NO | |
| | `body` | text | NO | Was VARCHAR with CHECK constraint — see Known Pitfalls |
| `comment_votes` | `id` | uuid PK | NO | gen_random_uuid() |
| | `profile_id` | uuid FK→profiles | NO | |
| | `comment_id` | uuid FK→review_comments | NO | |
| | `vote` | smallint | NO | +1 or -1 only |
| `review_media` | `id` | uuid PK | NO | |
| | `review_id` | uuid FK→reviews | NO | |
| `platform_reviews` | `id` | uuid PK | NO | gen_random_uuid() |
| | `platform_id` | uuid FK→platforms | YES | |
| | `profile_id` | uuid FK→profiles | YES | |
| | `score` | smallint | YES | |
| | `body` | text | YES | |
| | `created_at` | timestamptz | YES | |

### Constraints that affect application logic

| Table | Constraint name | Rule |
|-------|----------------|------|
| `reviews` | `reviews_one_published_per_game` | UNIQUE(profile_id, game_id) WHERE status='published' — one published review per user per game |
| `review_votes` | `review_votes_profile_review_unique` | UNIQUE(profile_id, review_id) — one vote per user per review |
| `review_reactions` | `review_reactions_review_id_profile_id_reaction_type_key` | UNIQUE(review_id, profile_id, reaction_type) |
| `comment_votes` | `comment_votes_profile_id_comment_id_key` | UNIQUE(profile_id, comment_id) |
| `follows` | `follows_follower_id_following_id_key` | UNIQUE(follower_id, following_id) |
| `watchlist` | `watchlist_profile_id_game_id_key` | UNIQUE(profile_id, game_id) |
| `platform_reviews` | `platform_reviews_platform_id_profile_id_key` | UNIQUE(platform_id, profile_id) — one platform review per user per platform |
| `groups` | `groups_invite_code_key` | UNIQUE(invite_code) |
| `group_members` | `group_members_group_id_profile_id_key` | UNIQUE(group_id, profile_id) |
| `group_invites` | `group_invites_group_id_invited_profile_id_key` | UNIQUE(group_id, invited_profile_id) |
| `reports` | `reports_reporter_id_content_type_content_id_key` | UNIQUE(reporter_id, target_type, target_id) — one report per user per content item |

> ⚠️ `review_votes` currently has two redundant UNIQUE indexes on (profile_id, review_id):
> `review_votes_one_per_review` and `review_votes_profile_review_unique`. Functionally
> identical — one should be dropped in a future cleanup migration.

### Social tables

| Table | Column | Type | Nullable | Default |
|-------|--------|------|----------|---------|
| `follows` | `id` | uuid PK | NO | gen_random_uuid() |
| | `follower_id` | uuid FK→profiles | NO | — |
| | `following_id` | uuid FK→profiles | NO | — |
| | `notify` | bool | NO | false |
| | `created_at` | timestamptz | YES | now() |
| `watchlist` | `id` | uuid PK | NO | — |
| | `profile_id` | uuid FK→profiles | NO | — |
| | `game_id` | uuid FK→games | NO | — |
| `notifications` | `id` | uuid PK | NO | gen_random_uuid() |
| | `profile_id` | uuid FK→profiles | NO | — |
| | `actor_profile_id` | uuid FK→profiles | YES | — |
| | `type` | text | NO | — |
| | `read` | bool | NO | false |
| | `review_id` | uuid FK→reviews | YES | — |
| | `comment_id` | uuid FK→review_comments | YES | — |
| | `game_id` | uuid FK→games | YES | — |
| | `group_id` | uuid FK→groups | YES | — |
| | `created_at` | timestamptz | YES | now() |

### Groups tables

| Table | Column | Type | Nullable | Default |
|-------|--------|------|----------|---------|
| `groups` | `id` | uuid PK | NO | uuid_generate_v4() |
| | `name` | text | NO | — |
| | `description` | text | YES | — |
| | `avatar_url` | text | YES | — |
| | `banner_url` | text | YES | — |
| | `visibility` | text | NO | `'public'` |
| | `invite_code` | text UNIQUE | YES | — |
| | `created_by` | uuid FK→profiles | NO | — |
| | `created_at` | timestamptz | NO | now() |
| `group_members` | `id` | uuid PK | NO | uuid_generate_v4() |
| | `group_id` | uuid FK→groups | NO | — |
| | `profile_id` | uuid FK→profiles | NO | — |
| | `role` | text | NO | `'member'` |
| | `joined_at` | timestamptz | NO | now() |
| `group_sessions` | `id` | uuid PK | NO | uuid_generate_v4() |
| | `group_id` | uuid FK→groups | NO | — |
| | `game_id` | uuid FK→games | NO | — |
| | `played_at` | date | NO | — |
| | `notes` | text | YES | — |
| | `created_by` | uuid FK→profiles | NO | — |
| `group_session_members` | `id` | uuid PK | NO | uuid_generate_v4() |
| | `session_id` | uuid FK→group_sessions | NO | — |
| | `profile_id` | uuid FK→profiles | NO | — |
| `group_watchlist` | `id` | uuid PK | NO | uuid_generate_v4() |
| | `group_id` | uuid FK→groups | NO | — |
| | `game_id` | uuid FK→games | NO | — |
| | `added_by` | uuid FK→profiles | NO | — |
| | `added_at` | timestamptz | NO | now() |
| | `notes` | text | YES | — |
| `group_invites` | `id` | uuid PK | NO | uuid_generate_v4() |
| | `group_id` | uuid FK→groups | NO | — |
| | `invited_by` | uuid FK→profiles | NO | — |
| | `invited_profile_id` | uuid FK→profiles | NO | — |
| | `status` | text | NO | `'pending'` |
| | `created_at` | timestamptz | NO | now() |
| | `expires_at` | timestamptz | YES | — |

### Other tables

| Table | Purpose |
|-------|---------|
| `contact_submissions` | Contact form entries — triggers email to team via Edge Function |
| `reports` | User reports on content. `target_type` + `target_id` fields. UNIQUE(reporter_id, target_type, target_id) |

---

## RLS — who can read and write what

**All tables have RLS enabled.** The admin client (`getSupabaseAdmin()`) bypasses all
policies. The anon client and user client are subject to them.

### Publicly readable without auth (anon client can SELECT)

| Table | Policy |
|-------|--------|
| `profiles` | All rows |
| `games` | All rows |
| `platforms` | All rows |
| `genres` | All rows |
| `developers` | All rows |
| `game_genres`, `game_platforms`, `game_companies` | All rows |
| `reviews` | Only where `status = 'published'` — drafts are invisible to anon |
| `review_comments` | All rows |
| `review_votes` | All rows |
| `review_reactions` | All rows |
| `comment_votes` | All rows |
| `review_media` | All rows |
| `follows` | All rows |
| `watchlist` | All rows |

### Auth required to read

| Table | Rule |
|-------|------|
| `notifications` | Own rows only (`profile_id = current user's profile id`) |
| `groups` | Rows where `visibility = 'public'` OR user is a member |
| `group_members` | Only if user is a member of that group |
| `group_sessions` | Only if user is a member of that group |
| `group_session_members` | Only if user is a member of the parent group |
| `group_watchlist` | Only if user is a member of that group |
| `group_invites` | Only if user is the invitee OR is group admin/owner |

### No SELECT policy (blocked entirely)

`contact_submissions`, `platform_reviews`, `reports` — no SELECT policy defined,
so all reads are blocked regardless of auth state. Use admin client if reads are needed.

### Writes

All write operations (INSERT/UPDATE/DELETE) on user-owned data require the row's
`profile_id` to match the current user's profile. This check uses the DB function
`get_my_profile_id()` internally. Since API routes use the admin client for all
DB operations, these policies are bypassed — but the auth check at the top of
every route still enforces that the user is logged in.

---

## DB functions and triggers

### Triggers — invisible side effects, know these before writing migrations

| Trigger | Table | Event | What it does |
|---------|-------|-------|-------------|
| `handle_new_user` | `auth.users` | AFTER INSERT | **Auto-creates a `profiles` row** on signup. Sets `auth_user_id = NEW.id`, `username = raw_user_meta_data->>'username'` or email prefix. Never manually insert profiles on signup — this trigger handles it. |
| `enforce_group_limit` | `groups` | BEFORE INSERT | Raises exception if `created_by` user already has 10 groups. INSERT will hard-fail with a DB exception — handle this in the API route. |
| `contact_submissions` | `contact_submissions` | AFTER INSERT | Fires HTTP POST to `notify-contact` Edge Function to email the team. |
| `on_report_insert` | `reports` | AFTER INSERT | Fires HTTP POST to `notify-report` Edge Function to email the team. |

### DB functions — callable from SQL and RLS policies

| Function | Returns | Purpose |
|----------|---------|---------|
| `get_my_profile_id()` | uuid | Returns `profiles.id` for the current auth user. Used throughout RLS policies. |
| `is_group_member(gid)` | bool | True if current user is in the group. |
| `is_group_admin_or_owner(gid)` | bool | True if current user has role 'admin' or 'owner' in the group. |
| `check_group_limit()` | trigger | Enforces max 10 groups per user (called by `enforce_group_limit` trigger). |
| `search_games(query, ...)` | records | Full-text + trigram game search. Combines exact match, prefix, LIKE, `ts_rank`, and `similarity()` into a ranked result. Used by the game search API. |

### Game search internals
`games` has three search indexes: `search_vector` (tsvector), `title_search` (tsvector),
and a trigram index on `title`. The `search_games` function uses all three plus
`similarity()` from the `pg_trgm` extension, weighted and ranked. Do not replace
this with a simple `.ilike()` — it would be significantly worse.

---

## Supabase client rules — the most critical section

Two clients exist. Using the wrong one causes silent data failures.

| Client | How to get it | Use only for |
|--------|--------------|-------------|
| User (anon+JWT) | `createSupabaseServerClientFromContext(context)` | `auth.getUser()` only |
| Admin (service role) | `getSupabaseAdmin()` | All DB reads and writes |

```typescript
// Every API route starts exactly like this — no exceptions
const userClient = createSupabaseServerClientFromContext(context);
const { data: { user } } = await userClient.auth.getUser();
if (!user) return json({ error: "Unauthorized" }, 401);

const db = getSupabaseAdmin() as any;
```

### profiles.id ≠ auth.users.id

Always resolve the profile before using its ID as a foreign key:

```typescript
const { data: profile } = await db
  .from('profiles').select('id').eq('auth_user_id', user.id).single();
if (!profile) return json({ error: "Profile not found." }, 404);
// Use profile.id for all FK references — NEVER user.id
```

---

## Mandatory API route patterns

### Standard structure

```typescript
import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  // 1. Auth
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  // 2. Admin DB client
  const db = getSupabaseAdmin() as any;

  // 3. Resolve profile
  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: "Profile not found." }, 404);

  // 4. Validate input before touching DB
  const body = await context.request.json();
  if (!body.required_field) return json({ error: "Missing required_field." }, 400);

  // 5. DB operation with full error logging
  const { error } = await db.from('table').insert({ ... });
  if (error) {
    console.error('[route-name] insert error:', JSON.stringify(error));
    return json({ error: "Friendly message." }, 500);
  }

  return json({ success: true });
};
```

### Notification pattern — always fire-and-forget

Notification failures must never crash the primary action:

```typescript
// After the primary operation succeeds:
try {
  await db.from('notifications').insert({ ... });
} catch (e) {
  console.error('[route-name] notification error (non-fatal):', e);
}
```

### Error logging

Always log the full error object — `.message` alone often omits the constraint name:

```typescript
console.error('[route-name] operation error:', JSON.stringify(error));
```

---

## Database query rules

1. **Always specify exact columns.** `select('*')` on a join returns `data: null`
   if any selected column doesn't exist — no error is thrown.

2. **Verify column names in the schema tables above before writing any query.**
   Common mistakes caught by this: `description` vs `game_description` on games,
   `platform_id` vs `platform_played_on` on reviews, `studios` vs `developers`.

3. **For delete/update, prefer the natural unique key** over a surrogate `id`
   where there is a composite unique constraint:
   ```typescript
   // Safer — uses the natural key
   .delete().eq('profile_id', profile.id).eq('review_id', review_id)
   ```

4. **`maybeSingle()`** for lookups returning 0 or 1 rows.
   **`single()`** only when the row must exist (throws on 0 rows, causing a 500).

5. **Always destructure and check `error`** on every insert, update, and delete.

6. **Scores are integers 1–10 at the DB level.** Display with `.toFixed(1)` in
   result cards only. Never store or compare as floats.

7. **`reviews` drafts are invisible to anon.** RLS only exposes
   `status = 'published'` rows. Always filter by status in queries or you'll
   get unexpected empty results for draft reviews.

8. **One published review per user per game.** The `reviews_one_published_per_game`
   partial unique index enforces this. Inserting a second published review for the
   same user+game will throw a constraint violation.

---

## Migration rules

### Checklist before any schema change

1. `grep -r "table_name" supabase/migrations/` — find all existing constraints
   and column definitions before adding or dropping anything.
2. **Never assume a constraint name.** Postgres auto-generates names.
   Use the constraints table above or query `pg_constraint` to get the exact name.
3. `IF NOT EXISTS` / `IF EXISTS` on every `ADD COLUMN` and `DROP CONSTRAINT`.
4. Schema changes belong in migrations only — never in application code.
5. One concern per migration file. Don't bundle a type change with a feature.
6. After every migration: `supabase gen types typescript --local > supabase/types.ts`

### Migration file naming

`YYYYMMDDHHMMSS_description-kebab-case.sql`
Same-day migrations use sequential suffixes: `_000000`, `_000001`, etc.

### Schema migrations vs data migrations

**Schema migrations** (new tables, columns, constraints, RLS policies, functions, triggers)
→ Write as a `.sql` file in `supabase/migrations/`, commit it with the feature branch.
   This is the permanent record of how the DB reached its current state.

**Data migrations** (one-off backfills, renaming existing values, deleting bad data)
→ Write as a SQL code block in the chat only. The developer pastes it into the
   Supabase SQL Editor and runs it manually. Do NOT create a `.sql` file for these —
   they have no business being committed to the repo.

---

## Component patterns

### ReviewCard.astro

The most complex component. Handles votes, reactions, spoilers, delete, edit,
report, and body-click navigation via a single delegated event listener on `document`.

**Props:**

| Prop | Type | Default | Purpose |
|------|------|---------|---------|
| `review` | object | required | Full review with nested joins |
| `isLoggedIn` | bool | false | Shows/hides auth-gated actions |
| `isOwnProfile` | bool | false | Shows edit/delete, hides report menu |
| `showGame` | bool | true | Shows game cover + title row |
| `showReviewer` | bool | false | Shows avatar + username row |
| `showVotes` | bool | true | Shows vote + reaction bar |
| `currentProfileId` | string\|null | null | Determines active vote/reaction state |

**Event delegation:**
Uses `window.__rcInit` guard so the listener registers exactly once regardless
of how many cards are on the page. All card interactions bubble to `document`.
Do not add per-card `addEventListener` calls — add new interaction cases inside
the existing delegated handler.

**Vote button attributes:**
`data-review-id`, `data-vote` (+1/-1), `data-count` — must stay in sync if
HTML structure changes.

### Layout.astro

Wraps all non-standalone pages. Provides nav, theme CSS vars, and OG meta.

| Prop | Required | Notes |
|------|----------|-------|
| `title` | Yes | Page title |
| `ogImage` | No | Root-relative or absolute URL. Omits to use site default. |
| `description` | No | Meta description |

### Standalone auth pages

`signin.astro`, `signup.astro`, `forgot-password.astro`, `reset-password-confirm.astro`
do NOT use Layout.astro and define their own CSS scope.

⚠️ **`var(--accent)` resolves to the wrong color on these pages.**
Always hardcode `#6050c8` directly for purple on any standalone page.

### Inline scripts (`is:inline`)

- Pass server values with `define:vars={{ key: value }}`
- Do NOT use `import` statements — inline scripts bypass Vite
- Use `window.__flagName` guards to prevent double-registration on pages
  that render the same component multiple times

```astro
<script is:inline define:vars={{ userId, gameSlug }}>
  // userId and gameSlug are available as plain JS variables here
</script>
```

---

## CSS system

### Theme variables (globals.css / Layout.astro)

| Variable | Value | Usage |
|----------|-------|-------|
| `--accent` | `#6050c8` | Purple — buttons, active states, links |
| `--score-perfect` | gold | Score 10 |
| `--score-great` | green | Score 9 |
| `--score-teal` | teal | Score 8 |
| `--score-good` | light green | Score 7 |
| `--score-mid` | yellow | Score 5–6 |
| `--score-orange` | orange | Score 3–4 |
| `--score-low` | red | Score 1–2 |
| `--bg-card`, `--bg-hover` | — | Card and hover backgrounds |
| `--border`, `--border-subtle` | — | Border hierarchy |
| `--text-primary`, `--text-secondary`, `--text-tertiary` | — | Text hierarchy |

### Score color helper

`scoreClass(score)` → one of: `score-perfect`, `score-great`, `score-teal`,
`score-good`, `score-mid`, `score-orange`, `score-low`.

Currently duplicated in `ReviewCard.astro` and `games/[slug].astro`.
**Do not add a third copy** — extract to `src/utils/format.ts` when next touched.

---

## Known pitfalls and silent failure modes

| Pattern | Why it fails silently |
|---------|----------------------|
| `select('col')` on a non-existent column | Returns `data: null`, code treats as "no row found" and proceeds incorrectly |
| Anon client for DB writes | RLS blocks it, returns empty data with no JS error |
| `var(--accent)` on standalone auth pages | Resolves to wrong color, no visual error at dev time |
| `single()` when row may not exist | Throws, causes unhandled 500 |
| `.eq('col', null)` after a failed select | Matches nothing or everything depending on PostgREST version |
| `(supabase as any)` casts | Workaround for stale types only — does NOT confirm the column exists |
| Notification insert in main try/catch | Notification failure crashes the entire request |
| `review_comments.body` history | Previously had a VARCHAR CHECK constraint that silently rejected long comments. Now `text`. Always grep migrations before inserting into a column for the first time. |
| Querying draft reviews with anon client | RLS hides `status != 'published'` rows — result looks like the review doesn't exist |
| Inserting a second published review | `reviews_one_published_per_game` constraint throws — handle this case in the API route |
| Creating an 11th group | `enforce_group_limit` trigger throws a DB exception — handle this case in the API route |
| `game_description` vs `description` | The column on `games` is `game_description`, not `description` |
| `platform_played_on` vs `platform_id` | The FK column on `reviews` is `platform_played_on` |
| `developers` vs `studios` | The table is `developers`. There is no `studios` table. |

---

## Environment variables

```
SUPABASE_DATABASE_URL        Supabase project URL
SUPABASE_ANON_KEY            Public anon key (safe for SSR, never expose client-side)
SUPABASE_SERVICE_ROLE_KEY    Service role — server only, bypasses all RLS
IGDB_CLIENT_ID               IGDB API credentials
IGDB_CLIENT_SECRET           IGDB API credentials
```

Local: `.env` file. Production: Netlify environment settings.

---

## Commands

```bash
npm run dev          # Dev server at localhost:4321
npm run build        # astro check (TypeScript) + astro build
npm run preview      # Preview production build locally
npm test             # Vitest unit tests
npm run test:watch   # Vitest in watch mode
```

---

## Testing

Vitest is used for unit tests. It reuses the Vite config with zero extra TypeScript
setup. Test files live at `src/**/*.test.ts`.

**What we test:** Pure utility functions and input validation logic.
**What we don't test:** Supabase queries, API routes, or UI (integration tests are future scope).

### Utilities to extract into `src/utils/format.ts`

These functions are currently duplicated across pages. Canonical versions to extract:

```typescript
export function scoreClass(score: number): string {
  if (score === 10) return 'score-perfect';
  if (score >= 9) return 'score-great';
  if (score >= 8) return 'score-teal';
  if (score >= 7) return 'score-good';
  if (score >= 5) return 'score-mid';
  if (score >= 3) return 'score-orange';
  return 'score-low';
}

export function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
}

export function getVoteCounts(votes: any): { up: number; down: number } {
  const arr = Array.isArray(votes) ? votes : votes ? [votes] : [];
  return {
    up: arr.filter((v: any) => v.vote === 1).length,
    down: arr.filter((v: any) => v.vote === -1).length,
  };
}

export function igdbImage(url: string | null | undefined, size = 't_cover_big'): string | null {
  if (!url) return null;
  const clean = url.startsWith('//') ? `https:${url}` : url;
  return clean.replace(/t_[a-z0-9_]+/, size);
}
```

---

## Git workflow

- `main` → production, auto-deploys to chekpoint.gg via Netlify
- Feature branches → Netlify branch preview URLs
- Both devs work on separate branches, merge to main via PR
- PRs require a read-through before merge — no direct pushes to main
- Branch naming: `feature/description`, `fix/description`
