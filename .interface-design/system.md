# koryta.pl design decisions

The interface-design skill reads this file before UI work. It is also the place
to look for anyone changing the site's look.

**Only decisions Szymon made go in here**, each with the date and where he made
it. An agent that wants a new rule proposes it as a task on /admin/zadania. An
agent never accepts the skill's "save these patterns?" offer on its own: the
patterns in the code today are mostly defaults, not decisions (see the
2026-10-14 review below).

Colour values never go here. They live in `frontend/shared/colors.ts`.

## Decided

- **Lists someone works through** use the quiet rail. Each row has a 4px left
  edge in the row's colour, the open row gets a tinted header, and a strip of
  facts runs across its top. Colour is the signal on every row, not one block
  that draws the eye. Picked 2026-09-24 out of three rendered variants of
  `AdminExpandRow` („szyna” over „karta” and „podział”). Used on
  /admin/rewizje, /admin/opinie and /qa.
- **Palette: not picked yet** (task pick-site-palette). The direction so far
  is calm green-on-green on a cream or mint paper. Rounds 1-4 of mocks ran
  2026-09-30, and „2 Oliwka” and „4 Mięta” are the finalists. Contrasting
  accent hues (plum, indigo) were rejected.
- **No colour changes until the palette is picked** (2026-10-10). A change may
  move a colour into a token at the value it already has. It must not change
  what a reader sees. Coloured treatments on the site today, such as the home
  call to action's blue pane, are part of that pending colour redesign. They
  are not patterns to copy (2026-10-14).
- **Sage is a fill, never text.** `brand.primary` (#a8c79f) measures 1.85:1 as
  text on white. Text and thin indicators (tabs, progress bars, icons on white)
  use the `ink.*` tokens from `shared/colors.ts`. Adopted 2026-10-14.
- **Reuse the site's components instead of re-implementing them**, e.g.
  `CardEmploymentHistory` and `ExploreLoginBanner` (2026-10-14).
- **The logged-in contributor comes first.** Szymon is the site's main user.
  When a change trades the logged-in page against the logged-out one, the
  logged-in page wins: do not add a click to a daily action to save a
  hypothetical visitor some pixels (2026-08-29).
- **Too much text: hide it cleverly, don't delete it.** Explanations and method
  go behind the (i) bubble that `PageSection` offers (`#info`), not into the
  page's flow. This comes from the UX reports of the reader Szymon asked to be
  prioritised (2026-09-09). Adopted 2026-10-14.
- **A person with no party is grey on the graph**, not blue (2026-10-09,
  report wg0ZscDc).
- **Redesign round 1 is accepted, site-wide changes first** (2026-10-15). The
  six directions rendered on 10-14/15 go in, in this order:
  1. the site-wide changes: type system, one edge style, header and footer;
  2. then page by page: chips on feed and history, the company page, the
     table, home.

  Exact values (type scale, radii, weights) are written here once Szymon has
  approved the implemented screenshots, not before.
- **Home headline**: „Sprawdzamy, którymi stanowiskami w publicznych spółkach
  podzielili się politycy”, with no full stop. It replaces „Jesteśmy
  największym, ogólnopolskim i niezależnym agregatorem koryciarstwa”
  (2026-10-15).
- **The person page's graph opens on „2 kroki”**, as today. Szymon: "it looks
  cooler, we can change it later" (2026-10-15).
- **A long person bio folds on phones**: it shows four lines, followed by
  „Pokaż więcej”, which opens the rest in place. It is hidden, not cut.
  Computers show the whole bio. Szymon: "I think it's a good idea"
  (2026-10-15).

  The button goes once the bio is open, with no „Pokaż mniej” to fold it
  back, and it carries a chevron down. Szymon: "Don't keep the pokaż mniej
  toggle for now, sure, let's add a chevron" (2026-10-15).
- **/eksploruj/tabela on desktop: one summary line per person**, e.g.
  „8 spółek ▾ · ostatnio <company> · 2023-2024 · 12 lat pracy · 8 startów”.
  Each row's „N spółek ▾” opens its companies in place, and a single
  „Rozwiń wszystkie” toggle opens every row at once. This was picked over the
  rendered list of three posts per person (2026-10-15).

  Columns are divided by thin lines, because without them it is sometimes
  hard to read (2026-10-15). The summary line is aligned sub-columns, each
  divided by the same neutral hairline: count | latest post | date | years.
- **The wordmark „koryta.pl” is set entirely in bold** in the app bar, not
  „koryta” bold and „.pl” regular. Szymon: "I prefer the whole koryta.pl to
  be bolded" (2026-10-15).
- **The footer stays as it was before the redesign** (logo, the sentence
  about the project, the socials and the two link columns on the sage band),
  not the slim row of round 1. Szymon: "yes for now, we can redesign it
  later" (2026-10-16).
- **The top bar is ruled off by a firm line, and lifted by a soft shadow once
  the page scrolls** (option „A + B”, picked 2026-10-15 from three rendered
  options). The line is a neutral black at .2, firmer than the site's .12
  hairline, because the bar is the one edge with nothing else to frame it.
  The shadow uses Vuetify's `scroll-behavior="elevate"`.
- **The hairline is .24, not round 1's .12**: every record and panel edge,
  the table's lines and the top bar's line are one neutral black at .24, so a
  card still reads as a box. The type system and the sentence-case menu stay
  as round 1 set them, and the typeface stays Roboto. Picked 2026-10-23 out of
  seven rendered versions („2 teraz + wyraźniejsze linie”), after Szymon
  preferred main's firmer boxes on the blog (2026-10-16).
- **Admin page titles follow the public pages' title rule**: the h1 is
  40/700, 28 on phones, not a smaller 28 for working pages. Szymon: "Let's
  keep the admin pages like public pages for now" (2026-10-15).
- **The site's text uses the plain hyphen „-”**, never „–” or „—”, in prose
  and in date ranges alike. Szymon: "This is very AI and I think people
  start noticing it" (2026-10-16).

## How UI changes are made

- Judge a layout by its screenshots, not by its markup. Render 2-3 variants at
  desktop and 375px, with production's numbers rather than invented fixtures.
  Do not copy another page's markup, because the house style is not a standard
  (2026-09-23/24).
- Show Szymon the screenshots and wait for his pick before updating tests,
  retaking baselines or committing (2026-10-14).
- UI work on koryta uses the interface-design skill:
  /interface-design:interface-design while designing and building, and
  /interface-design:design-review on the screenshots before they are shown
  to Szymon. Szymon: "Remember to use interface-design skill" (2026-10-15).

## Not decided yet

- The exact values of the accepted directions, pending his OK on the
  implemented screenshots.
- The smaller questions in decide-design-review-2026-10-14 (wording, order,
  toggles, an extra font weight, the „Zgłoś” icon on phones).
