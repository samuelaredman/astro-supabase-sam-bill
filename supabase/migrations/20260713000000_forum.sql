-- ─────────────────────────────────────────────────────────────────────────────
--  Forum (MVP: "Updates"): a staff-authored post type with threaded user comments.
--  Posting is restricted to site_admins (see RLS + the requireAdmin API guard);
--  any signed-in user may comment. Modeled on the recommendations/lists social
--  pattern, trimmed to the MVP (no post/comment votes or reactions yet).
--
--  Forward-compat columns are included now so the eventual full forum (suggestion
--  box, megathreads, game-specific threads) needs UI/RLS changes only, not a
--  schema redo:
--    • category  — 'announcement' | 'discussion' | 'suggestion' | … (open text)
--    • pinned    — sticky posts / megathreads
--    • is_locked — freeze commenting on a post
--    • game_id   — future game-specific threads (nullable)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. forum_posts
CREATE TABLE IF NOT EXISTS forum_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'announcement',
  pinned      BOOLEAN NOT NULL DEFAULT false,
  is_locked   BOOLEAN NOT NULL DEFAULT false,
  game_id     UUID REFERENCES games(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS forum_posts_profile_idx    ON forum_posts (profile_id);
CREATE INDEX IF NOT EXISTS forum_posts_category_idx   ON forum_posts (category);
CREATE INDEX IF NOT EXISTS forum_posts_game_idx       ON forum_posts (game_id);
-- Primary listing order: pinned first, then newest.
CREATE INDEX IF NOT EXISTS forum_posts_listing_idx    ON forum_posts (pinned DESC, created_at DESC);

ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;

-- Anyone may read posts.
CREATE POLICY "forum_posts_select" ON forum_posts FOR SELECT USING (true);

-- Only site_admins may write, and only as themselves. (API routes use the admin
-- client and additionally gate on requireAdmin; these policies are defense-in-depth.)
CREATE POLICY "forum_posts_insert" ON forum_posts FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM site_admins sa
    WHERE sa.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);
CREATE POLICY "forum_posts_update" ON forum_posts FOR UPDATE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM site_admins sa
    WHERE sa.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);
CREATE POLICY "forum_posts_delete" ON forum_posts FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM site_admins sa
    WHERE sa.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

-- 2. forum_comments (threaded)
CREATE TABLE IF NOT EXISTS forum_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES forum_posts(id)    ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id)       ON DELETE CASCADE,
  parent_id   UUID REFERENCES forum_comments(id)          ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS forum_comments_post_id_idx   ON forum_comments (post_id);
CREATE INDEX IF NOT EXISTS forum_comments_parent_id_idx ON forum_comments (parent_id);

ALTER TABLE forum_comments ENABLE ROW LEVEL SECURITY;

-- Anyone may read comments.
CREATE POLICY "forum_comments_select" ON forum_comments FOR SELECT USING (true);

-- Any signed-in user may comment as themselves.
CREATE POLICY "forum_comments_insert" ON forum_comments FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- Authors may edit their own comments.
CREATE POLICY "forum_comments_update" ON forum_comments FOR UPDATE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- Authors may delete their own comments; site_admins may delete any (moderation).
CREATE POLICY "forum_comments_delete" ON forum_comments FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM site_admins sa
    WHERE sa.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

-- 3. Add forum_post_id to notifications (comment-on-post / reply notifications)
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS forum_post_id UUID REFERENCES forum_posts(id) ON DELETE SET NULL;
