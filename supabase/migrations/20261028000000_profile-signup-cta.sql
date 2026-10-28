-- Records which logged-out landing nudge (src/utils/landingCtas.ts) a visitor
-- saw before they signed up. Written once, just after signup, via
-- /api/profile/signup-cta. NULL = no attribution (signed up elsewhere, or
-- before this shipped). A cheap A/B/n test: phrases are shown at equal random
-- weight, so raw signup counts per value are directly comparable.
alter table public.profiles
  add column if not exists signup_cta text;

comment on column public.profiles.signup_cta is
  'Landing-page sign-up nudge id (landingCtas.ts) shown before this account signed up; NULL if none. Set once by /api/profile/signup-cta.';
