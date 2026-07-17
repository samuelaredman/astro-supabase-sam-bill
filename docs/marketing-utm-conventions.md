# UTM tagging conventions

UTM parameters are query-string tags you append to **links that point to chekpoint.gg**
(Reddit posts, DMs, Discord, newsletters, warppoint, etc.). GA4 reads them automatically —
no site code needed — and turns them into Source / Medium / Campaign dimensions so you can
tell *which* post or channel actually drove traffic and signups.

They live entirely in the URL you paste elsewhere. Nothing here touches the app or collects
extra data, so there's no GDPR impact beyond the analytics consent gate already in place.

## Format

```
https://chekpoint.gg/<path>?utm_source=<source>&utm_medium=<medium>&utm_campaign=<campaign>
```

Optional: `utm_content` (to A/B two links in the same post), `utm_term` (paid keywords — not
needed for our manual/organic use).

## Rules

- **Always lowercase.** GA4 is case-sensitive: `Reddit` and `reddit` become two separate
  sources. Pick lowercase and never deviate.
- **No spaces.** Use hyphens: `patient-gamers`, not `patient gamers`.
- **Only tag links to our own site.** Never add UTMs to links pointing elsewhere.
- **Don't UTM-tag internal links** (nav between our own pages) — it resets attribution.

## Value vocabulary

Keep these lists tight so reports stay clean. Extend deliberately, not ad-hoc.

| Param | Meaning | Allowed values (extend as needed) |
|-------|---------|-----------------------------------|
| `utm_source` | Where the link lives | `reddit`, `discord`, `twitter`, `bluesky`, `warppoint`, `newsletter`, `dm` |
| `utm_medium` | Type of channel | `social`, `referral`, `email`, `dm` |
| `utm_campaign` | The specific push | freeform, kebab-case, e.g. `launch-2026-07`, `r-patientgamers-intro` |

## Examples

```
# A Reddit post in r/patientgamers
https://chekpoint.gg/?utm_source=reddit&utm_medium=social&utm_campaign=r-patientgamers-intro

# The landing-page URL sent in a DM (current real use case)
https://chekpoint.gg/?utm_source=dm&utm_medium=dm&utm_campaign=personal-outreach

# A specific game page shared to Discord
https://chekpoint.gg/games/hollow-knight?utm_source=discord&utm_medium=social&utm_campaign=game-share
```

## Where to see the results in GA4

Reports → Acquisition → Traffic acquisition, then set the dimension to
Session source / medium or Session campaign. Cross-reference with the `sign_up` and
`review_posted` key events to see which campaigns convert, not just which bring clicks.
