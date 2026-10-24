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
- **A party a logged-out reader is not shown** is a chip in its place, as
  tall as a party chip: „???” in black on the „Inne” chip's grey, with six
  small dots of the parties' colours at its edges and corners (none under the
  marks), no icon, linking to the sign in; one sign-in banner under the list.
  Never the party's name or colour. Picked 2026-10-24 for the company page's
  „Obecny skład” and an unpublished person's teaser, over rounds of renders:
  the label („możliwe powiązania”, „partia”, then „???”), the backdrop (blur,
  party-colour gradients, bands, pie, dense dots) and the icon (lock, question
  mark, shield, eye).

## How UI changes are made

- Judge a layout by its screenshots, not by its markup. Render 2-3 variants at
  desktop and 375px, with production's numbers rather than invented fixtures.
  Do not copy another page's markup, because the house style is not a standard
  (2026-09-23/24).
- Show Szymon the screenshots and wait for his pick before updating tests,
  retaking baselines or committing (2026-10-14).

## Not decided yet

Type scale, weights, button case, depth strategy (borders, shadows, tints),
radius scale, spacing base and chip usage. The 2026-10-14 design review
proposed directions for each. They are proposals until Szymon picks them in
decide-design-review-2026-10-14, so do not treat them as rules.
