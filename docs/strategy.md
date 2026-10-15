# Content strategy (background for Cadence)

This is the content strategy the app supports. It explains *why* the rules in `docs/SRS.md` exist. If anything here disagrees with the SRS, the SRS wins for the software.

## The person and the goal

- AI engineering student who also does UI/UX design, interested in game dev, AR and accessibility.
- Lives in Algiers (timezone Africa/Algiers; weekend is Friday–Saturday). Uses an iPhone and a PC.
- Goals: freelance design clients and building a community; open to jobs and internships.
- Time budget: about 3 h 40 min per week, including replies and check-ins.
- Old problem: posted in bursts, then disappeared for weeks because replying to everyone was exhausting.

## Core principles (research-backed)

- **Consistency beats volume.** Posting every week without gaps clearly outperforms bursty posting (Willow, 43,738 LinkedIn posts). Weeks with zero Instagram posts grow below an account's own baseline (Buffer, 2.1M posts).
- **Frequency:** the biggest gain on Instagram is moving from 1–2 to 3–5 posts per week; on TikTok from 1 to 2–5 per week; LinkedIn 2–5 per week is the sweet spot (Buffer studies).
- **Formats:** carousels and Reels lead Instagram engagement; DM sends are Instagram's top ranking signal; content with another app's watermark loses reach, so files are exported clean and uploaded natively to each app.
- **Habits:** if-then plans ("when X, I do Y") strongly improve follow-through (Gollwitzer & Sheeran 2006, d = 0.65). Habits took a median of 66 days to form; missing one day didn't hurt, repeated gaps did (Lally et al. 2010). Hence: fixed triggers for every task, "never miss twice", and a big review around week 10.

## Platforms and cadence

| Phase | Instagram feed | TikTok | LinkedIn | Move up when |
| --- | --- | --- | --- | --- |
| 1 · Habit (weeks 1–4) | 2/week: 1 Reel + 1 carousel | 2/week: same pieces | 1/week | 4 weeks with no missed post |
| 2 · Grow (weeks 5–10) | 3/week: add a leftovers post | 3/week | 1/week | Weekly time stays under 4 h |
| 3 · Stretch (week 11+) | 3–4/week | 3–5/week | 2/week | Decided at the week 10 review |

TikTok starts in week 1. Everything is scheduled days ahead on Friday night in each app's own scheduler; on posting days the owner only shows up for reply windows.

## Weekly rhythm (local time)

| When | What |
| --- | --- |
| Sunday–Thursday, daytime | Capture as you go in daylight: outfits, campus, desk, bits of real work for LinkedIn |
| Sunday 18:00 | Shot list for the week |
| Monday 18:00 | Capture one piece of real work for LinkedIn (Tuesday 21:00 fallback: reflection post) |
| Tuesday 19:00 | Instagram Reel live; 15-min reply window. TikTok same video at 21:00 |
| Wednesday ~12:00 | LinkedIn work piece live; reply in the evening |
| Thursday 18:00 | Instagram carousel live; 15-min reply window. TikTok photo mode at 21:00 |
| Friday 20:00 | Weekly report + follower snapshot (3 numbers) |
| Friday 20:15 | Batch night with Claude: plan, judge ideas, edit, write captions |
| Friday ~22:00 | Schedule all of next week's posts |
| Saturday | One 20-min catch-up reply slot |
| First Saturday of the month, 11:00 | Monthly review (~60 min) |

## Content pillars

Personal Instagram and TikTok stay personal for now; real work lives on LinkedIn only. Revisit at week 10.

| Pillar | What it is | Where |
| --- | --- | --- |
| life_style | Outfits, daily life, student moments | Instagram, TikTok |
| student_life | Light, aesthetic glimpses of studying and building; no tutorials | Instagram, TikTok |
| pov_journey | Opinions, reflections, milestones | All three (career angle on LinkedIn) |
| work_lessons | Real projects, process, tips | LinkedIn only, for now |

Topic tags: ai, uiux, gamedev, ar, accessibility. Accessibility is the signature angle.

## Style

- **On camera:** face + music + on-screen text; no voiceover by default. On-screen text also makes Reels accessible with the sound off.
- **Language:** mostly English; some Darija on Instagram and TikTok; LinkedIn is English only. Each post is tagged with its language so English and Darija performance can be compared at week 4.

## Reply system

- Two windows only: 15 minutes after each post, plus one 20-minute catch-up per week.
- Reply properly to questions and thoughtful comments; like the rest.
- When three or more people ask the same thing, pin one answer and turn it into the next post.

## How Claude judges ideas

Each idea is scored 1–3 on five questions; feedback style is direct, always with at least one alternative.

| Question | Why it matters |
| --- | --- |
| Would someone send this to a friend? (forwardable) | DM sends are Instagram's top signal |
| Does it fill a gap in the balance rules? (fills_gap) | Keeps the mix on track |
| Can it be made within this week's time budget? (doable) | Protects the time limit |
| Is it clearly yours: work, face, voice or opinion? (original) | Original content gets recommended |
| Can the hook be said in one line? (hook) | Otherwise the post is usually unclear |

Verdicts: go (11+), improve (8–10, with a fix), bank (under 8; kept, not deleted). With several ideas, Claude ranks them and picks one.

## Leftover photos and clips

Themed photo dumps, B-roll with a one-line hook, "accessibility spotted in the wild", "pick one" polls, blooper reels, before/after, monthly recaps, Story fillers, and splitting one long clip into three shorts. At most one leftovers post per week.

## Check-ins and milestones

- Log each post's numbers on day 3 and day 7 (plus day 14 on TikTok), and follower counts per platform every Friday. Manual entry is fine for the MVP.

| When | Milestone | Possible decision |
| --- | --- | --- |
| Week 1 | Setup: Creator accounts, app on Home Screen, baseline follower counts | — |
| End of week 2 | First 4 Instagram posts out, no missed week | Move slots or batch time |
| End of week 4 | Phase 1 complete; compare English vs Darija | Go to Phase 2 or repeat; set follower targets for week 10 |
| End of week 6 | Topic coverage | Rebalance |
| End of week 10 | Habit checkpoint | Phase 3; whether work moves onto Instagram/TikTok |
| Every 3 months | Research refresh | Update rules |

Early strategy triggers: reach falls 3 weeks in a row on a platform; under 75% of planned posts done for 2 weeks (cut the load, don't quit); one pillar earns ~2x the sends or saves of others for 4 weeks; a platform announces a major change.

## Sources

- Buffer: how often to post on Instagram (2.1M posts) — https://buffer.com/resources/how-often-to-post-on-instagram/
- Buffer: best time to post on Instagram (9.6M posts) — https://buffer.com/resources/when-is-the-best-time-to-post-on-instagram/
- Buffer: how often to post on TikTok (11.4M posts) — https://buffer.com/resources/how-often-should-you-post-on-tiktok/
- Buffer: best time to post on TikTok (7.1M posts) — https://buffer.com/resources/best-time-to-post-on-tiktok/
- Buffer: how often to post on LinkedIn — https://buffer.com/resources/how-often-to-post-on-linkedin/
- Willow: LinkedIn consistency report — https://willow.co/blog-linkedin-consistency-report
- Socialinsider: 2026 Instagram benchmarks — https://www.socialinsider.io/instagram-benchmarks
- PetaPixel: Instagram originality policy (2026) — https://petapixel.com/2026/04/30/new-instagram-policies-target-reposted-content/
- Gollwitzer & Sheeran (2006) — https://kops.uni-konstanz.de/entities/publication/2e749bfb-8533-437c-8203-7e788c910c5f
- Lally et al. (2010), via UCL — https://www.ucl.ac.uk/news/2009/aug/how-long-does-it-take-form-habit
