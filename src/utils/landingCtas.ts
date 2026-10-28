/**
 * Rotating sign-up nudges shown on the logged-out home page (mirrors the
 * first-review phrase list). One is assigned per visitor, uniformly at random,
 * CLIENT-SIDE (the anon home page is CDN-cached, so a server-side pick would
 * show one fixed phrase to everyone). The chosen `id` is remembered in
 * localStorage and, once the visitor signs up on the same device, recorded on
 * `profiles.signup_cta` via /api/profile/signup-cta.
 *
 * Because assignment is uniform random, each id gets ~equal exposure, so raw
 * signup counts per id are directly comparable (a cheap A/B/n test — no
 * impression logging needed). Keep ids STABLE so the text can be reworded
 * without losing the experiment history.
 */
export interface LandingCta {
  id: string;
  text: string;
  /** 'f-key': pressing F (when not typing) jumps to sign-up. Flavour, only on this phrase. */
  easterEgg?: 'f-key';
}

export const LANDING_CTAS: LandingCta[] = [
  { id: 'big_tech', text: "Don't give big tech more of your money — join a community that actually plays." },
  { id: 'taste', text: "Follow reviewers who share your taste, not an algorithm's." },
  { id: 'honest', text: "Real scores from real players. No sponsored nonsense." },
  { id: 'backlog', text: "Rate what you've played. Build the backlog you'll actually finish." },
  { id: 'press_f', text: "Press F to sign up.", easterEgg: 'f-key' },
  { id: 'hot_takes', text: "Your hot takes deserve a home." },
  { id: 'gatekeep', text: "We could gatekeep… but we'd rather you join." },
  { id: 'one_of_us', text: "One of us. One of us. \u{1F441} Join the community." },
];

export const LANDING_CTA_IDS: string[] = LANDING_CTAS.map((c) => c.id);
