# Pomysły na gry /gry — brainstorm 2026-08-28

Daily games (wordle-style, mobile, shareable) and/or single-use video formats
(iwantcheckmate-style). Core requirement: the mechanic runs on koryta data;
bonus for games that also collect data. Existing: Połączenia (shipped),
Korytle (stub), 6 uścisków / six degrees (planned flagship).

## Ranked after review round 1

### 1. Kim jestem? — CV guess-who ⭐ flagship
Daily politician, career revealed entry by entry (oldest first, employer
redacted to category before unmasking), guess anytime via person-search
autocomplete; fewer clues = better score. Curated around one *weird* entry
per day (Duda at Małopolska ARR, Sikorski consulting for the Saudis post-2014)
— the weird entry is also the unit of a video. Reveal screen links the full
timeline to profile pages + "coś się nie zgadza? zgłoś".
Curation-heavy; acceptable.

### 2. Kiedy? — timeline slider ⭐
"Prezes spółki X odchodzi" → guess *when* on a 2007–2026 slider, score decays
with distance. Purchasable hints that cap the score: party of the leaver
(cheap), party of the successor (expensive — different parties ⇒ you've
bracketed a government handover). Round 1 is always an anchor everyone knows
(tutorial + landmark); all rounds render on one shared timeline that fills up
with markers — end screen is a player-drawn history of the revolving door.
Greyed-out hint ("brak danych") doubles as a crowdsourcing prompt.
**Variant:** real newspaper headline from the crawled news corpus → guess the
publication date. Self-dating ground truth, infinite supply, names can be
redacted as difficulty dial.

### 3. Ta sama osoba? — entity-resolution reCAPTCHA (data collector)
KRS card vs election card, same name: swipe tak / nie / nie wiem.
Papers-Please deduction on evidence deltas (age off by one, middle initial).
Timed arcade mode — 60 s, how many pairs — with a leaderboard; combo
multiplier that resets on a miss vs salted known-answer pairs, so speed never
beats accuracy; "nie wiem" always outscores a wrong guess. Drains the
uncertain-confidence band of the existing matching pipeline; 3 concordant
votes from high-accuracy players = link evidence (never auto-merge).
Best placed as a 3-pair bonus round after the fun dailies.

### 4. Dwie prawdy i koryto — two truths and a lie (data collector)
Known politician, three career facts, one fabricated (sampled from the fact
distribution of same-party/region peers — hard precisely when typical). Reveal
sources the truths, red-stamps the fake. End-of-daily: submit tomorrow's
politician — demand signal if already in the graph, crawl request if not.
Hard constraint: fakes stay quarantined (revealed in-session, never indexed,
mundane rather than damning); LLM-generated lies need a human glance
(a "fake" that is accidentally true is the embarrassing failure mode).
Strongest video format of the batch.

### 5. Wyżej/Niżej — higher-lower
Two cards, one stat (board seats per person to start), tap higher/lower,
streak. Daily seeded 10-pair run + endless arcade for video. Cheapest build.
Needs work on fun categories — let users suggest the next category. Skip
near-tie pairs; mind undercounted CVs being scored as truth ("co najmniej N").

### 6. Zgadnij spółkę — company guess-who
Kim jestem? engine, company as the mystery; clues from categories/is_public
and board-churn aggregates ("11 zarządów w 8 lat"). Parked low: unclear who'd
play — company names aren't recognizable the way faces are.

### 7. Karuzela — where did they land? (parked)
"X leaves the ministry — where do they work now?" 4 options with same-slice
distractors. Parked: the honest insight is the answer is *unguessable*; maybe
a Milionerzy-parody sketch, not a game.

### 8. Mapka — Worldle for okręgi (cut)
Territory silhouette + distance arrows, second stage "name the poseł". Cut:
weakest thesis link, no good second stage; tradle-of-regions variant also
failed to be fun (revealed attributes are inspected, not reasoned from).

## Cross-cutting
- **1v1 / collab mode**: Szymon wants head-to-head play vs other political
  YouTubers (GeoGuessr-duel / chess-YT model). Every pitch should name its
  versus variant. Naturals: Kim jestem? as fastest-finger buzz duel (wrong
  buzz locks you out), Kiedy? as closest-slider-wins, 6-degrees as a
  shortest-path race.
- One daily-quiz engine (seeded pick, streak, emoji share) skins most of these.
- Every reveal deep-links to profile pages — games as distribution channel.
- Every daily ends with the feedback hook; thousands of eyes = free QA pass.
- Daily picks come from the famous pool (people_enriched) or it's a rage-quit.

## What worked / what didn't (Szymon's reactions, round 1)
Liked: famous people as subject; graded-feedback guessing (closeness, clue
count); intuition/deduction anyone can attempt over insider recall; humor;
data-collection hooks; time pressure + rankings; specific weird facts as
video units. Disliked: entities nobody recognizes (companies, regions);
multiple choice gated on specific knowledge; attribute-reveal quizzes with no
deduction.
