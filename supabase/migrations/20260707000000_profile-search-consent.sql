-- GDPR-compliant, opt-in consent for search-engine discovery.
-- When true, the user has explicitly consented to having their public profile
-- and authored content (reviews, recommendations, lists, comments) indexed by
-- search engines. Default false so no existing or new user is indexed without
-- an affirmative, informed opt-in. search_indexable_at records when consent was
-- granted, as an audit trail. Withdrawal is handled in application code by
-- setting search_indexable = false (and clearing the timestamp).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS search_indexable boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS search_indexable_at timestamptz;

COMMENT ON COLUMN public.profiles.search_indexable IS
  'GDPR opt-in consent: user allows search-engine indexing of their public profile and authored content. Default false.';
COMMENT ON COLUMN public.profiles.search_indexable_at IS
  'Timestamp consent was last granted; NULL when consent has never been given or has been withdrawn.';
