# Pomysły na gry /gry — brainstorm 2026-08-28

Daily games (wordle-style, mobile, shareable) and/or single-use video formats
(iwantcheckmate-style). Core requirement: the mechanic runs on koryta data;
bonus for games that also collect data. Existing: Połączenia (shipped),
Korytle (stub), 6 uścisków / six degrees (planned flagship).

## Categories

- **Manual examples?** — does content need hand-curation per day/round, or is
  it sampled from the graph automatically?
- **Collects data?** — does playing produce data (labels, priors, leads,
  freshness signals) the pipeline can consume?
- **Data ready?** — can it run on today's graph, or is it gated on new data
  (edge dates, interpersonal edges, digitized declarations)?
- **1v1** — how well it works head-to-head for YouTuber collabs.
- **Video** — strength as a single-use video format.
- **Build** — implementation cost given the shared daily-quiz engine.
- **Timed** — does a solve-timer fit? *core* = the timer IS the score;
  *secondary* = show the jigsy.app-style daily average after finishing
  ("dzisiejsza średnia 2:41 — szybciej niż 68% graczy") as a social stat;
  *no* = timing is meaningless. The average-time display itself is an
  engine-level feature: record start→finish on every daily and even untimed
  games get a compare hook (see https://jigsy.app/daily/).

| Game | Manual examples? | Collects data? | Data ready? | 1v1 | Video | Build | Timed |
|---|---|---|---|---|---|---|---|
| Kim jestem? | yes — daily pick curated | weak (QA eyes) | mostly (pool, dates) | buzz duel | strong | med | secondary (time + clue count) |
| Kiedy? | no (sampled; anchors light) | weak (hint-gap prompts) | partial (edge dates) | closest slider | ok | low | secondary |
| Ta sama osoba? | no (pipeline queue) | STRONG — core purpose | yes | arcade board | weak | low-med | CORE (60 s arcade) |
| Dwie prawdy | partial (review fakes) | medium (submissions) | yes | party format | strongest | low | fun stat (avg hesitation) |
| Krata | partial (criteria design) | medium (leads) | yes | strong | strong | med | secondary (avg completion) |
| Majątek | yes, until a pipeline | STRONG — digitization | no (PDFs unparsed) | strong | strong | low UI, high data | no |
| Kontexto | no | weak | no (interpersonal edges) | ok | ok | med | secondary (avg guesses/time) |
| 16-0 | partial (score formulas) | none | partial (tenure, pay) | strongest | strongest | high | draft clock in 1v1 only |
| Czyj człowiek? | no | medium (crowd priors) | mostly (provenance) | good | ok | low | secondary (speedrun board) |
| Wyrzutek | no (famous-pool filter) | weak | yes | speed duel | ok | low | CORE — time-to-tap is the solo score |
| Prognoza | yes (weekly slate) | unique (crowd forecasts) | yes (crawler resolves) | strong | resolution show | med | no (weeks-scale) |
| Ile uścisków? | no (famous pairs) | weak | no (interpersonal edges) | good | shorts — strong | low | fun stat (avg hesitation) |
| Koryto czy nie? | no (sampled + anonymized) | STRONG — model labels | yes | debate format | ok | low-med | secondary (deck time) |
| Pająk | light (cluster pick) | none | yes (bipartite edges) | closer-tap duel | strong (reveal anim) | med | core-ish (round clock) |
| Kalendarium | no (corpus-sampled + scrub) | none | yes (article dates) | same-deck run | ok | low-med | secondary |
| Wyżej/Niżej | partial (categories) | weak (suggestions) | yes (undercount risk) | ok | good | lowest | secondary (arcade) |
| Kto to powiedział? | partial (quote pick) | none | external corpus | buzz duel | good | low | secondary (solo buzz time) |
| Drabinka | no (stat pick) | none | votes yes / majątek gated | same-deck score | ok | low | secondary |
| Zgadnij spółkę | no (churn sort) | weak | yes | weak | weak | low | secondary |
| Karuzela | no (auto distractors) | freshness votes | partial (dates) | quiz duel | shorts | low | no |
| Mapka | no | none | yes (geojson) | weak | weak | low-med | secondary |
| Rozplątanka | — | none | no | — | — | — | — |
| Ile? | no | none | yes | ok | weak | lowest | no |
| Co było pierwsze? | no | none | yes (dated edges) | ok | weak | lowest | secondary |
| Łańcuch | no | leads (disputed edges) | partial | battle-native | strong | med | core-ish (shot clock) |

## Liked

### 1. Kim jestem? — CV guess-who ⭐ flagship
Daily politician, career revealed entry by entry (oldest first, employer
redacted to category before unmasking), guess anytime via person-search
autocomplete; fewer clues = better score. Curated around one *weird* entry
per day (Duda at Małopolska ARR, Sikorski consulting for the Saudis post-2014)
— the weird entry is also the unit of a video. Reveal screen links the full
timeline to profile pages + "coś się nie zgadza? zgłoś".
Curation-heavy; acceptable.
**Variant (Szymon, anidle.net):** attribute-feedback mode — each guess
returns a scorecard vs the hidden target: partia ✓/✗, województwo
match/adjacent, wiek ↑/↓, arena (Sejm/Senat/samorząd/spółka) ✓/✗, liczba rad
nadzorczych ↑/↓, aktywny od ↑/↓; triangulate (Poeltl/LoLdle family).
Opposite supply economics to clue-reveal: zero curation, any famous-pool
person works — so anidle-mode is the everyday daily, CV-reveal the curated
special. The attribute grid doubles as a tutorial of what koryta tracks.

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

### 5. Krata — Immaculate Grid for polityka ⭐ (round 2, liked)
3×3 grid; rows and columns are criteria (partia × "zasiadał w spółce skarbu
państwa" / "był w rządzie" / "kandydował na prezydenta"). Fill each cell with
a person satisfying both, scored by *rarity* — the obvious answer everyone
picked scores low, the obscure dig scores high. Versus: alternate turns
claiming cells, tic-tac-toe rules — natural YouTuber-collab format.
Data hook: a valid answer the graph can't confirm is a player-donated lead.
**Rarity scoring:** blend of (a) crowd pick-rate per cell (Immaculate Grid
style — self-calibrating, exploit-proof, but cold-start noisy) and (b) a
fame prior we can compute and IG can't: corpus mention count + Wikipedia
pageviews + position prominence, taken as a percentile *within the cell's
eligible set* (so all-obscure cells don't punish). Bayesian blend
(α·prior + picks)/(α + players): launch on pure prior, crowd takes over
with volume. Unverified lead-answers score at cell median ("sprawdzamy"),
trued up when the lead verifies — retroactive points as a retention loop.
Crowd scores settle at midnight; share card carries the settled number.
Bonus reveal stat: eligible-set size per cell ("214 poprawnych odpowiedzi").

### 6. Majątek — Price is Right on oświadczenia majątkowe ⭐ (round 2, liked)
A politician plus one line of their real asset declaration ("oszczędności",
"zegarki", "metraż domu") — guess the number on a slider, scored by
closeness, five lines a day. Versus: both guess, closer takes the point;
the collab fun is the face when the real number drops. Data hook: the biggest
of any idea — declarations are public PDFs largely not in the graph, so the
game funds their digitization.

### 7. Kontexto — graph-distance guesser ⭐ (round 2, liked; data-gated)
Guess the mystery politician; every wrong guess answers with its distance in
the connection graph ("Morawiecki — 3 uściski od celu, najkrótsza droga przez
spółkę energetyczną"). Triangulate through the network; solving the daily IS
learning who's connected to whom. Versus: same target, fewer guesses wins.
**Variant (Szymon):** pathfinding A→B — at each step choose: reveal the
closest company link, the closest personal link (game finds it), or name a
middle person yourself and search from both ends (3+3 beats 6).
**Prerequisite:** both need denser person↔person edges than the graph has —
materialize co-board-membership and co-candidacy (see co-candidate-edges
branch) as first-class interpersonal edges; family/social ties are the gap.

### 8. 16-0 — koryto fantasy draft ⭐ (round 2, liked; friend's variant)
The 38-0/82-0 sports-YT draft format, Polish number: 16 województw. Draft a
five-role crew — Lider (highest office), Teczkowy (appointments across
sectors/transitions), Marketingowiec (mentions in the crawled corpus),
Finansjer (paid seat-years; hospital paid/unpaid signal), Prawnik (rada
nadzorcza count) — each slot under a seeded daily constraint roll ("z woj.
podkarpackiego", "nigdy niewybrany, tylko powoływany"). Crew then plays all
16 voivodeships: aggregate score vs that region's best home crew, computed
from the graph. Win = painted map + scoreline share ("13-3 🗺️"); 16-0 is the
perfect run. Every loss links to the real person who beat you.
Versus mode (= idea D, Transfer): snake draft from a shared pool with pick
denial, same rolls, most voivodeships wins — the YouTuber-collab format.
Runs on person↔institution edges we already have; weak spots are tenure
dates and salaries (Majątek digitization would feed Finansjer). Main design
cost: score formulas funny enough to argue about, defensible enough to lose to.

### 9. Czyj człowiek? — guess the party from the CV ⭐ (round 2, Szymon's idea)
Anonymous employment history (party-explicit entries stripped, dates kept —
dates + ministry is the learnable era signal), guess the party from ~6 chips.
Three lives, endless seeded daily run, leaderboard; share = distance reached
("23 🐷🐷🐷"). Ramp from obvious sector captures to local government and
switchers (scored by the party of the appointment shown). Every ~10th card:
unscored "nikt nie wie" round — crowd votes collect priors on undocumented
affiliations (the same provenance data that gates Kontexto/Kiedy? hints).
Versus: same seeded run, most cards before the third miss.

### 10. Wyrzutek — odd one out ⭐ (round 2, liked; famous-pool only)
Four politicians, three share a hidden graph link (same board, committee,
foundation), one doesn't belong — tap the wyrzutek, reveal draws the actual
edge triangle. Inverse of Połączenia's grouping. Hard mode: the odd one
shares a decoy link with two of them. Constraint from review: only very
known politicians — nobody cares about guessing around a local radny.
Versus: speed tap, wrong tap locks out.

### 11. Prognoza — Polymarket for the revolving door ⭐ (round 2, strong like)
Weekly slate of yes/no bets on *upcoming* events: "Czy prezes spółki X
przetrwa do końca kwartału?", "Czy stanowisko po wiceministrze Y dostanie
ktoś z partii Z?" Lock predictions; the crawler + graph resolve them
automatically when the news lands; calibration score builds over weeks.
Retention no daily has (open loops pull people back); the community aggregate
is publishable content ("87% graczy dało prezesowi trzy miesiące — wytrzymał
sześć tygodni"). Versus: standing leaderboard vs another YouTuber's public
picks, resolved on camera monthly. Risks: slow burn, no instant
gratification; needs reliable crawler resolution or unsettled bets rot.
Unique data angle: crowd forecasts are themselves a new dataset.

### 12. Ile uścisków? — guess the graph distance ⭐ (round 2, very good)
Two famous politicians, one question: how many handshakes apart in the graph?
Stepper 1–6, near-miss scoring; the reveal draws the actual shortest path
node by node ("Ziobro → spółka → ktoś → Tusk"). Instant, concrete reward —
you always learn a real, often absurd chain, which is the shareable-shorts
moment (Szymon: "unexpected results and shareable shorts"). Kontexto's data
in a 10-second casual costume — same interpersonal-edge prerequisite, lighter
mechanic. Versus: closer guess takes the point; tie broken by predicting the
link type.

### 13. Koryto czy nie? — anonymized appointment judgment ⭐ (round 2, liked)
One real appointment per card, ANONYMIZED (Szymon's requirement): no names —
just the CV/qualifications history, the seat, and the timing relative to
elections. Swipe: koryto / uzasadniona nominacja. Scored by consensus —
points for landing with the majority. Reveal: the name unmasks (vote first,
gasp second), community split ("74% mówi koryto"), and the scoring model's
verdict as a third voice. Anonymization also cleans the labels — verdicts
about the appointment, not partisan feelings about the name. Data hook:
every swipe is a calibration label for the scoring models; hard
crowd-vs-model disagreements are the cards worth editorial attention.
Framing rule: "oceń nominację", never "osądź człowieka".

### 14. Pająk — tap the center of the network (Szymon's seed, centroidgame.com)
A real subgraph drawn as ANONYMOUS dots + edges in a circular layout (nodes
pinned on a ring so visual position carries zero signal — force-directed
layouts would leak the answer into the picture's middle). One tap: who holds
this network together? Truth = highest betweenness centrality. Five rounds,
per-round clock, scored by centrality-rank closeness, percentile end screen.
Reveal: names unmask, web colors by centrality, "przez tę osobę przechodzi
61% połączeń" + profile link; ring→force-layout animation is a ready-made
short. Pure visual deduction — zero knowledge needed. Runs on today's
bipartite person↔institution edges (no interpersonal-edge gate); curation =
picking famous-adjacent daily clusters ("sieć wokół Orlenu").
Versus: same web, closer tap wins.

### 15. Kalendarium — Chronle for political events ⭐ (Szymon's pick)
Wikitrivia insertion loop over REAL political events from the scraped
article corpus: timeline starts with one anchor; draw a headline card, tap
where it slots in; correct locks it in, wrong = strike, 3 strikes out.
Daily deck of ~8, share = how far you got. Relative ordering, not absolute
dating (contrast: Kiedy? headline variant) — zero knowledge floor, only
"which came first" intuition. Publication dates are ground truth; supply
needs event dedup (cluster by time+entities, pick one headline) and a scrub
pass for date giveaways in headline text. Difficulty = date spread between
cards. Reveals link the articles on /zrodla — distribution for sources.
Replaces the cut Co było pierwsze? (person-level ordering had no hook;
public events tap shared memory). Versus: same deck, longer run wins.

### 16. Drabinka — insertion ladder by exact stat ⭐ (Uszereguj reworked via timdle.com)
Timdle's mechanic over politicians: order by an exact quantity — daily stat
rotates: głosy w ostatnich wyborach (exact counts in election data — runs
today), majątek (gated on the declarations pipeline — Majątek synergy),
lata w polityce. Draw a politician card, insert it into the growing ladder;
correct → card flips revealing the exact number, +n points where n = ladder
size so far; wrong → deduction, floored at zero, card slides to its true
slot. Difficulty rises structurally — every locked card adds a boundary to
thread. Fixes what sank drag-4 Uszereguj: a reward beat per placement (the
flip) + escalating stakes. Share: score + longest clean streak.
Versus: same deck, higher score wins.

## Ok tier

### 17. Wyżej/Niżej — higher-lower
Two cards, one stat (board seats per person to start), tap higher/lower,
streak. Daily seeded 10-pair run + endless arcade for video. Cheapest build.
Needs work on fun categories — let users suggest the next category. Skip
near-tie pairs; mind undercounted CVs being scored as truth ("co najmniej N").

### 18. Kto to powiedział? — quote guesser (round 2, ok-tier)
Real quote (Sejm stenograms + crawled interviews), autocomplete the speaker,
graded feedback ("ta sama partia, inna dekada"); 3-second Sejm audio clip as
hard mode. Versus: buzz duel, wrong buzz locks you out. Verdict: fine but
sits far from koryta's own data — supply is public transcripts, not the graph.

### 19. Zgadnij spółkę — company guess-who
Kim jestem? engine, company as the mystery; clues from categories/is_public
and board-churn aggregates ("11 zarządów w 8 lat"). Parked low: unclear who'd
play — company names aren't recognizable the way faces are.

## Parked / cut — kept for reference, not discarded

### 20. Karuzela — where did they land? (parked)
"X leaves the ministry — where do they work now?" 4 options with same-slice
distractors. Parked: the honest insight is the answer is *unguessable*; maybe
a Milionerzy-parody sketch, not a game.

### 21. Mapka — Worldle for okręgi (cut)
Territory silhouette + distance arrows, second stage "name the poseł". Cut:
weakest thesis link, no good second stage; tradle-of-regions variant also
failed to be fun (revealed attributes are inspected, not reasoned from).

### 22. Rozplątanka — untangle two shuffled CVs (cut)
Two careers merged into one anonymous timeline, drag entries apart, name
both people. Cut: the employment data isn't good enough to build
confusable-pair tangles.

### 23. Ile? — Price is Right on graph aggregates (cut)
Slider-guess churn stats ("ilu prezesów w 8 lat?"). Cut: no intuition
anchor — closeness-guessing needs quantities people have priors about
(money, age), not abstract aggregates. Refines why Majątek works.

### 24. Co było pierwsze? — order two career events (cut)
One politician, two CV entries, tap which came first; 3-lives streak.
Cut: no hook ("I don't see it").

### 25. Łańcuch — connection chain battle (cut)
Alternate naming graph-connected people/institutions on a shot clock,
Cine2Nerdle-style. Cut: requires recall of low-level graph data players
don't have (same failure as Karuzela — insider knowledge as the mechanic).

## Video ideas

- **Race-to-find datapoint (Szymon, 2026-08-28):** DougDoug video — GeoGuessr
  + 4 streamers race to find something ASAP. Liked as a format. Koryta
  translation: **Szperacz** — a data scavenger hunt where creators race to
  find a target IN the site ("polityk z 5 radami naraz", "spółka z pełną
  wymianą rady w miesiąc po wyborach"), screensharing the dig. The site is
  the game board — the video is a product demo, racers are a QA pass, and
  found oddities are editorial leads. Possibly the stream-mode of
  Krata/Łańcuch rather than a separate game.

- **Który AI gra najlepiej?** — pit LLMs against each other in the 1v1 modes
  (Krata cell-claiming, Kontexto race, 16-0 draft) and see which model plays
  koryta games best. AI-vs-AI is proven YT content, and it doubles as a
  benchmark of the games' mechanics before humans play them.
- Weird-CV singles from Kim jestem? curation (Duda/MARR, Sikorski/Saudis).
- Ile uścisków? shorts — one absurd chain between a famous pair per short.
- 16-0 collab draft vs another political YouTuber (the flagship collab).
- Prognoza monthly resolution episode — on-camera settling of public picks.
- Endless Wyżej/Niżej dare run ("nie zbijesz 15").
- Dwie prawdy as host-and-guest / street-interview format.

## Cross-cutting
- **1v1 / collab mode**: Szymon wants head-to-head play vs other political
  YouTubers (GeoGuessr-duel / chess-YT model). Every pitch should name its
  versus variant. Naturals: Kim jestem? as fastest-finger buzz duel (wrong
  buzz locks you out), Kiedy? as closest-slider-wins, 6-degrees as a
  shortest-path race.
- One daily-quiz engine (seeded pick, streak, emoji share) skins most of these.
- The engine should record solve time on every daily and show the day's
  average + percentile after finishing (jigsy.app/daily pattern) — a free
  compare hook even for games where time isn't the score.
- Engine patterns from amountle.dev (Szymon, 2026-08-28): (1) N short rounds
  with a per-round time limit that forces a decision — bounded sessions,
  built-in tension; (2) end screen shows today's percentile placement;
  (3) end-of-daily cross-promo — "other games to play today" links each
  daily into the next. The cross-promo IS the compounding loop that turns
  many small games into one habit; the /gry hub is the loop, not a menu.
- Hub layout (Szymon, actorle.com/fill-the-grid): games listed in a left
  rail (drawer/bottom-sheet on phone) so users switch freely; per-game
  "played today" ticks make the rail the loop UI — it shows what's left.
  At the bottom: **zaproponuj grę** — feeds an ideas queue / demand signal.
  Twist: it can run this doc's own process — show two elevator pitches,
  visitors vote which is more interesting; the tally prioritizes the roadmap.
- Silent anonymous accounts (amountle pattern): auto-provision identity on
  first play, upgrade to a real account later (Firebase anonymous auth +
  linkWithCredential). Load-bearing for the data collectors — Ta sama osoba?
  vote weighting and Prognoza calibration need stable identity before the
  user ever signs up.
- Every reveal deep-links to profile pages — games as distribution channel.
- Every daily ends with the feedback hook; thousands of eyes = free QA pass.
- **Recognizability floor (Szymon, via anidle's flaw):** the daily target's
  fame is the floor on the game's audience — an unknown answer doesn't just
  lose the day, it teaches players the game can betray them, which kills the
  streak habit. Rule: obscurity may appear in the player's ANSWER (Krata
  rarity digs, unknown middlemen on an Ile uścisków? path) but never in the
  game's QUESTION (the target to identify). Enforcement is free: the fame
  score built for Krata's rarity prior (corpus mentions + Wikipedia
  pageviews) doubles as a hard threshold every daily target must clear.
  Daily picks come from the famous pool (people_enriched) or it's a rage-quit.

## What worked / what didn't (Szymon's reactions)
Round 1 — liked: famous people as subject; graded-feedback guessing
(closeness, clue count); intuition/deduction anyone can attempt over insider
recall; humor; data-collection hooks; time pressure + rankings; specific
weird facts as video units. Disliked: entities nobody recognizes (companies,
regions); multiple choice gated on specific knowledge; attribute-reveal
quizzes with no deduction.
Round 2 — refinements: closeness-guessing needs an intuition anchor (money,
age — not abstract churn counts); famous-pool constraint applies everywhere;
close-to-the-graph beats adjacent public data (quotes); forward-looking
prediction with automatic resolution is a strong new genre; versus modes are
now a standing requirement (collabs).
