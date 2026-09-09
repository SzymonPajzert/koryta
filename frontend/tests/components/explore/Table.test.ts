import { describe, it, expect, vi, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick } from "vue";
import ExploreTable from "../../../app/components/explore/Table.vue";
import PartyChip from "../../../app/components/PartyChip.vue";
import { SEARCH_ALL_TOOLTIP } from "../../../app/composables/usePersonSearch";
import { partyColors } from "../../../shared/misc";
import type { PersonRich } from "../../../shared/model";

// Vuetify's overlay machinery observes its activator, and happy-dom ships no
// ResizeObserver - without this the first v-menu open throws instead of
// rendering a list.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/** The two columns /eksploruj/tabela and /eksploruj/nowe now declare where
 * there used to be four: Imię i nazwisko + Partie, and Firmy + Ostatnie
 * zatrudnienie + Wybory. */
const MERGED_HEADERS = [
  { title: "Osoba", key: "name", sortable: true },
  { title: "Historia", key: "latestEmploymentStart", sortable: true },
];

/** Everything the four columns used to carry, on one person, so that the
 * assertions below can say "nothing was dropped on the way" rather than
 * "the markup parses". */
const person = (): PersonRich => ({
  id: "p1",
  type: "person",
  name: "Jan Kowalski",
  parties: ["PiS", "Konfederacja"],
  companies: ["FIRMA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"],
  elections: [
    {
      year: "2018",
      location: "Gdynia",
      teryt: "2262",
      position: "Rada miasta",
      committee: "KWW Testowy Komitet",
    },
  ],
  latestEmploymentStart: "2019-03-01",
  experience: 4,
});

/** What /eksploruj/tabela declares for the two columns that now answer for
 * more than one sort key apiece. */
const SORTABLE_HEADERS = [
  { title: "Osoba", key: "name", sortable: true },
  { title: "Firmy", key: "latestEmploymentStart", sortable: true },
  { title: "Oceny", key: "stats.votes.interesting", sortable: true },
];

const mountTable = (props: Record<string, unknown> = {}) =>
  mountSuspended(ExploreTable, {
    props: {
      headers: MERGED_HEADERS,
      items: [person()],
      totalItems: 1,
      pending: false,
      hideDefaultFooter: true,
      ...props,
    },
  });

type Wrapper = Awaited<ReturnType<typeof mountTable>>;

/** `text()` is `textContent`, so it comes back with every newline the template
 * is indented with. Any assertion that spans two elements - the pill's label
 * and the date beside it - has to flatten it first. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const headerCell = (wrapper: Wrapper, title: string) => {
  const cell = wrapper
    .findAll("thead th")
    .find((th) => th.text().includes(title));
  if (!cell) throw new Error(`no header cell for ${title}`);
  return cell;
};

describe("ExploreTable's merged person and history cells", () => {
  it("puts the whole row into two cells", async () => {
    const wrapper = await mountTable();

    const cells = wrapper.findAll("tbody td");
    expect(cells).toHaveLength(2);

    const personCell = cells[0]!;
    expect(personCell.text()).toContain("Jan Kowalski");
    expect(personCell.text()).toContain("PiS");
    expect(personCell.text()).toContain("Konfederacja");

    const historyCell = cells[1]!;
    // `shortCompanyName` takes the legal form out, which is what lets a
    // company chip fit a phone at all.
    expect(historyCell.text()).toContain("FIRMA");
    expect(historyCell.text()).not.toContain("SPÓŁKA Z OGRANICZONĄ");
    expect(historyCell.text()).toContain("2018");
    expect(historyCell.text()).toContain("Gdynia");
    // The date used to be a column of its own behind `hidden-sm-and-down`, so
    // a phone never saw it. It rides with the employers now, as a month and a
    // year - the ISO day was precision nobody reads a table by - and it says
    // which date it is, which a bare „od marca 2019” under a row of employers
    // did not.
    expect(flat(historyCell.text())).toContain(
      "Ostatnie zatrudnienie od marca 2019",
    );
  });

  /** Five e2e specs treat `a.text-primary.cursor-pointer` in the first row as
   * "the table has finished loading", and the drawer opens off its click. The
   * merge moved the link inside a flex wrapper; it must not have moved it out
   * of that selector. */
  it("keeps the name a link that focuses the person", async () => {
    const wrapper = await mountTable();

    const link = wrapper.get("tbody td a.text-primary.cursor-pointer");
    expect(link.text()).toContain("Jan Kowalski");

    await link.trigger("click");
    expect(wrapper.emitted("focus")?.[0]?.[0]).toMatchObject({ id: "p1" });
  });

  /** `text-primary` is that locator and nothing else now: sage is a fill, and
   * as the ink of every name in the table it measured 1.85:1 against the white
   * row. `.person-name` is what the scoped stylesheet repaints in `ink.sage`
   * (6.43:1); the weight is the second half of the treatment, and there is no
   * third - the underline is on the hover and the focus ring only, because the
   * name carries no `to` and is not a link. A class assertion rather than a
   * colour one: the test environment has no viewport and applies no scoped
   * CSS. */
  it("paints the name with the ink token rather than the fill", async () => {
    const wrapper = await mountTable();

    const link = wrapper.get("tbody td a.text-primary.cursor-pointer");
    expect(link.classes()).toContain("person-name");
    expect(link.classes()).toContain("font-weight-bold");
  });

  /** The drawer-less pages (`disableFocus`) print the name as plain text, and
   * it was the same unreadable sage. */
  it("paints an unlinked name the same way", async () => {
    const wrapper = await mountTable({ disableFocus: true });

    const name = wrapper.get("tbody td .person-name");
    expect(name.element.tagName).toBe("SPAN");
    expect(name.classes()).toContain("text-primary");
  });

  /** A person with no employer and no election gets an empty cell rather than
   * a stray "Ostatnie zatrudnienie:" label over an empty chip row. */
  it("leaves the history cell empty when there is nothing to put in it", async () => {
    const wrapper = await mountSuspended(ExploreTable, {
      props: {
        headers: MERGED_HEADERS,
        items: [
          {
            ...person(),
            companies: [],
            elections: [],
            latestEmploymentStart: null,
          },
        ],
        totalItems: 1,
        pending: false,
        hideDefaultFooter: true,
      },
    });

    const cells = wrapper.findAll("tbody td");
    expect(cells[1]!.text()).toBe("");
  });
});

/** /eksploruj/tabela declares a „Wybory” column and hides it below 960px;
 * /eksploruj/nowe declares none at all. The same markup answers all three
 * cases, and it has to draw the chips exactly once in each.
 *
 * The assertions are on classes rather than on what is on screen, and that is
 * not laziness: jsdom has no viewport, so a test that asked whether the chips
 * are visible would have stayed green while a phone had neither copy. */
describe("ExploreTable's elections column", () => {
  const WITH_ELECTIONS = [
    { title: "Osoba", key: "name", sortable: true },
    { title: "Firmy", key: "latestEmploymentStart", sortable: true },
    // `sortable: false` is the point of the column, not decoration:
    // `elections` is not a key server/api/nodes/index.get.ts maps, so a click
    // would reach Firestore's `orderBy` verbatim and answer with an empty
    // table.
    { title: "Wybory", key: "elections", sortable: false },
  ];

  /** The regression this replaces: the in-cell copy was behind a `v-if` on the
   * header list, and the column is declared at every width - it hides itself
   * with `hidden-sm-and-down`. So the `v-if` was false on a phone as well, the
   * column was `display: none` there, and the elections were on no screen
   * narrower than 960px at all. */
  it("keeps the in-cell chips, hidden from md up, when the page declares a column", async () => {
    const wrapper = await mountTable({ headers: WITH_ELECTIONS });

    const cells = wrapper.findAll("tbody td");
    expect(cells).toHaveLength(3);

    // Employers and the date stay where they were...
    expect(cells[1]!.text()).toContain("FIRMA");
    expect(flat(cells[1]!.text())).toContain(
      "Ostatnie zatrudnienie od marca 2019",
    );

    // ...and the chips are in both places, each with the class that takes it
    // off the width the other one answers for.
    const inCell = cells[1]!.get(".elections-cell");
    expect(inCell.text()).toContain("Gdynia");
    expect(inCell.classes()).toContain("d-md-none");

    const column = cells[2]!.get(".elections-cell");
    expect(column.text()).toContain("2018");
    expect(column.text()).toContain("Gdynia");
    expect(column.classes()).not.toContain("d-md-none");
  });

  /** /eksploruj/nowe declares no „Wybory” column at any width, so the in-cell
   * copy is the only one there is and must not hide itself from anybody. */
  it("keeps them visible at every width for a page that declares none", async () => {
    const wrapper = await mountTable();

    const cells = wrapper.findAll("tbody td");
    expect(cells).toHaveLength(2);

    const inCell = cells[1]!.get(".elections-cell");
    expect(inCell.text()).toContain("Gdynia");
    expect(inCell.classes()).not.toContain("d-md-none");
  });
});

/** „Lata pracy” and „Notatki” stopped being columns and stayed sort keys in
 * the menus of the two that absorbed them. Both numbers have to be printed
 * somewhere, or the table can be ordered by a value the reader cannot see. */
describe("ExploreTable's absorbed columns", () => {
  /** Both facts of the „Firmy” caption, whitespace flattened: they are two
   * spans with an icon apiece, so `text()` comes back with the newlines the
   * template is indented with. */
  const facts = (wrapper: Wrapper) =>
    flat(wrapper.get("tbody td .employment-facts").text());

  it("prints when the last job started and how long the person has worked", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [{ ...person(), experience: 11 }],
    });

    expect(facts(wrapper)).toBe(
      "Ostatnie zatrudnienie od marca 2019 11 lat pracy",
    );
    // The day stays behind the tooltip: „Ostatnie zatrudnienie: 2019-03-01 ·
    // 11 lat pracy” was the old caption, and it is the ISO string, not the
    // words, that a scanned row has no use for.
    expect(wrapper.text()).not.toContain("2019-03-01");
  });

  /** The reader who read the bare „od lipca 2026” as a fact about the row
   * rather than about its newest job gets the words back - at the widths that
   * have room for them. 390px is why they were cut, so the label carries the
   * breakpoint and the date does not.
   *
   * On the class rather than on what is on screen, for the reason the
   * elections chips above are: jsdom has no viewport, so a test that asked
   * whether the label is visible would stay green with it on a phone. */
  it("holds the label back to md and prints the date at every width", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [{ ...person(), experience: 11 }],
    });

    const label = wrapper.get("tbody td .meta-pill .d-md-inline");
    expect(label.text()).toBe("Ostatnie zatrudnienie");
    expect(label.classes()).toContain("d-none");

    // The date is a text node of the pill itself, so there is no class that
    // could take it off a width.
    expect(flat(wrapper.get("tbody td .meta-pill").text())).toBe(
      "Ostatnie zatrudnienie od marca 2019",
    );
  });

  /** What the words became. An icon with no text alternative is a decoration,
   * so each fact carries a `title` saying which of the two it is - and that is
   * also what the two sort menu entries on this column are named after. */
  it("says what each icon stands for", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [{ ...person(), experience: 11 }],
    });

    const spans = wrapper.findAll("tbody td .employment-facts > span");
    expect(spans).toHaveLength(2);
    expect(spans[0]!.attributes("title")).toContain("ostatniego zatrudnienia");
    expect(spans[1]!.attributes("title")).toContain("staż");
    expect(wrapper.findAll("tbody td .employment-facts .v-icon")).toHaveLength(
      2,
    );
  });

  /** The entity pages put a register date in a pale sage pill and the length
   * of service in plain type beside it; the table row says the same two facts.
   * `bg-surface-sage` is the pair that brings `ink.sage` with it - the hue at
   * 5.57:1 on that fill, where `text-primary` on the white row was 1.85:1. */
  it("puts the date in a sage pill and the career total beside it", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [{ ...person(), experience: 11 }],
    });

    const spans = wrapper.findAll("tbody td .employment-facts > span");
    expect(spans[0]!.classes()).toContain("bg-surface-sage");
    expect(spans[0]!.classes()).toContain("meta-pill");
    // Not a second pill: two of them side by side read as one control, and a
    // row that is repeated ten times cannot afford the padding twice.
    expect(spans[1]!.classes()).not.toContain("meta-pill");
    expect(spans[1]!.classes()).toContain("text-ink-neutral");
  });

  /** `polishCounting` takes the three forms and returns the number with them;
   * a table full of „11 lata pracy” is what a wrong slot looks like. */
  it("declines the years", async () => {
    for (const [experience, expected] of [
      [1, "1 rok pracy"],
      [3, "3 lata pracy"],
      [12, "12 lat pracy"],
      [22, "22 lata pracy"],
    ] as const) {
      const wrapper = await mountTable({
        headers: SORTABLE_HEADERS,
        items: [{ ...person(), experience }],
      });

      expect(facts(wrapper)).toContain(expected);
    }
  });

  /** `shared/stats.ts` floors experience to a tenth, which used to reach the
   * table verbatim: „12.4 lat pracy”, with a dot where Polish writes a comma
   * and a noun form the numeral does not take („12,4 roku”). Whole years dodge
   * both, and the tenth was false precision anyway - it is derived from edge
   * dates that are missing a day here and a month there. */
  it("rounds the years to whole ones", async () => {
    for (const [experience, expected] of [
      [12.4, "12 lat pracy"],
      [1.6, "2 lata pracy"],
      [2.5, "3 lata pracy"],
    ] as const) {
      const wrapper = await mountTable({
        headers: SORTABLE_HEADERS,
        items: [{ ...person(), experience }],
      });

      // The whole caption, so that a tenth reappearing anywhere in it fails
      // here rather than only where the assertion happened to look.
      expect(facts(wrapper)).toBe(
        `Ostatnie zatrudnienie od marca 2019 ${expected}`,
      );
    }
  });

  /** The regression rounding would otherwise introduce: four months of work
   * are not „0 lat pracy”, which reads as a person who has never worked
   * anywhere. */
  it("says so rather than rounding a part-year down to nothing", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [{ ...person(), experience: 0.4 }],
    });

    expect(facts(wrapper)).toContain("poniżej roku");
    expect(facts(wrapper)).not.toContain("0 lat");
  });

  /** A month and a year, and only from an ISO day. Anything else is printed as
   * it arrived rather than parsed: `new Date("2016")` answers the first of
   * January, which would put a date in the table that no register recorded. */
  it("leaves a date it cannot read alone", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [{ ...person(), latestEmploymentStart: "2019", experience: 0 }],
    });

    expect(facts(wrapper)).toBe("Ostatnie zatrudnienie od 2019");
  });

  /** /eksploruj/nowe still draws a „Lata pracy” column, and the years are only
   * in the caption for the page that dropped one. */
  it("says nothing about the years for a page that still has the column", async () => {
    const wrapper = await mountTable({
      headers: [
        ...MERGED_HEADERS,
        { title: "Lata pracy", key: "experience", sortable: false },
      ],
      items: [{ ...person(), experience: 11 }],
    });

    expect(facts(wrapper)).toBe("Ostatnie zatrudnienie od marca 2019");
    expect(wrapper.findAll("tbody td")[2]!.text()).toBe("11");
  });

  it("prints the notes count under the total", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [
        { ...person(), stats: { notesCount: 2, votes: { interesting: 7 } } },
      ],
    });

    const votes = wrapper.findAll("tbody td")[2]!;
    expect(votes.text()).toContain("7");
    expect(votes.get(".text-caption").text()).toBe("2 notatki");
  });

  /** A second line on every row would make the whole table taller to print a
   * number that says what its absence already says. */
  it("stays one line for a person nobody has written a note about", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [
        { ...person(), stats: { notesCount: 0, votes: { interesting: 7 } } },
      ],
    });

    const votes = wrapper.findAll("tbody td")[2]!;
    expect(votes.text()).toBe("7");
    expect(votes.find(".text-caption").exists()).toBe(false);
  });

  /** „Liczba faktów” is one of the sorts this column's menu offers, and the
   * facts have no column of their own to be read in either - so the number
   * shares the notes' line rather than adding a third. */
  it("prints the notes and the facts on one line", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [
        {
          ...person(),
          stats: { notesCount: 2, factsCount: 5, votes: { interesting: 7 } },
        },
      ],
    });

    expect(wrapper.findAll("tbody td")[2]!.get(".text-caption").text()).toBe(
      "2 notatki · 5 faktów",
    );
  });

  it("prints the facts alone for a person with no notes", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [
        {
          ...person(),
          stats: { notesCount: 0, factsCount: 1, votes: { interesting: 7 } },
        },
      ],
    });

    expect(wrapper.findAll("tbody td")[2]!.get(".text-caption").text()).toBe(
      "1 fakt",
    );
  });
});

/** The same party was a grey Vuetify pill in this table and its own colour
 * everywhere else on the site, because the cell drew a `v-chip` of its own
 * instead of the component that owns `partyColors`. */
describe("ExploreTable's party chips", () => {
  it("paints them with PartyChip", async () => {
    const wrapper = await mountTable();

    const chips = wrapper.findAllComponents(PartyChip);
    expect(chips.map((chip) => chip.props("party"))).toEqual([
      "PiS",
      "Konfederacja",
    ]);
    expect(wrapper.get("tbody td .party-chip").attributes("style")).toContain(
      partyColors["PiS"],
    );
  });

  /** The cap that keeps a long party name from setting the width of the whole
   * column on a phone is a scoped rule on `.party-chip`, and a scoped rule
   * reaches a child component's root element - so the class has to be on the
   * chip itself, and the ellipsis that goes with it needs the root to be an
   * inline box rather than the <div> PartyChip used to wrap it in. */
  it("keeps the phone cap on the chip's own root", async () => {
    const wrapper = await mountTable();

    const chip = wrapper.get("tbody td .party-chip");
    expect(chip.element.tagName).toBe("SPAN");
    expect(chip.classes()).toContain("chip");
  });

  /** `partyColors` names seven parties and the data has more - Razem is
   * commented out there. Without a fill of its own such a person read as bare
   * text beside a row of painted chips, which looks like a missing value. */
  it("still draws a chip for a party with no colour", async () => {
    const wrapper = await mountTable({
      items: [{ ...person(), parties: ["Razem"] }],
    });

    const chip = wrapper.get("tbody td .party-chip");
    expect(chip.text()).toBe("Razem");
    // No inline background, so the neutral fill in PartyChip's stylesheet is
    // what paints it - asserting the class rather than a computed colour,
    // which jsdom does not resolve.
    expect(chip.attributes("style")).not.toContain("background-color");
    expect(chip.classes()).toContain("chip");
  });
});

/** „Widoczność” was the last of the count-style columns and a two-value flag.
 * The badge that replaces it marks the exception only: most rows are
 * published, so a positive badge would be a word repeated down the whole
 * table. */
describe("ExploreTable's draft badge", () => {
  it("marks an unpublished person beside their name", async () => {
    const wrapper = await mountTable({
      draftWithName: true,
      items: [{ ...person(), visibility: false }],
    });

    expect(wrapper.findAll("tbody td")[0]!.text()).toContain("szkic");
  });

  /** A badge that has to be spotted while scanning ten rows, in the one pair
   * `shared/colors.ts` measured for it: `ink.warning` on `surface.warning` is
   * 5.54:1, where `#fb8c00` as the label's ink was 2.37:1. */
  it("paints the badge in the measured warning pair", async () => {
    const wrapper = await mountTable({
      draftWithName: true,
      items: [{ ...person(), visibility: false }],
    });

    const badge = wrapper
      .findAll("tbody td .v-chip")
      .find((chip) => chip.text() === "szkic");
    expect(badge!.classes()).toContain("bg-surface-warning");
  });

  it("says nothing about a published one", async () => {
    const wrapper = await mountTable({
      draftWithName: true,
      items: [{ ...person(), visibility: true }],
    });

    expect(wrapper.findAll("tbody td")[0]!.text()).not.toContain("szkic");
  });

  /** Opt-in, because /eksploruj/nowe queues nothing but drafts - it hardcodes
   * `visibility: "private"` - and dropped its own „Widoczność” column
   * precisely because every row of it said the same word. */
  it("stays off for a page that did not ask for it", async () => {
    const wrapper = await mountTable({
      items: [{ ...person(), visibility: false }],
    });

    expect(wrapper.text()).not.toContain("szkic");
  });
});

/** The tooltip on the pink button is the only warning that a click opens a
 * dozen browser tabs and needs the pop-up blocker off. At 2000ms nobody ever
 * reached it, which is the same as not having written it. */
describe("ExploreTable's search tooltips", () => {
  const searchTooltip = (wrapper: Wrapper) => {
    const tooltip = wrapper
      .findAllComponents({ name: "VTooltip" })
      .find((candidate) => candidate.props("text") === SEARCH_ALL_TOOLTIP);
    if (!tooltip) throw new Error("no search tooltip");
    return tooltip;
  };

  /** A bound rather than the number: what matters is that a reader who pauses
   * over the button reaches the warning, not that the delay is exactly 200. */
  it("opens fast enough to be read, beside the name", async () => {
    const wrapper = await mountTable({ searchWithName: true });

    expect(
      Number(searchTooltip(wrapper).props("openDelay")),
    ).toBeLessThanOrEqual(500);
  });

  /** And in the „Eksploruj” column /eksploruj/nowe still draws. The column
   * header was the argument for a slow tooltip there, but it explains the
   * magnifier next to this button - it says nothing about the tabs. */
  it("opens fast enough in the Eksploruj column too", async () => {
    const wrapper = await mountTable({
      headers: [
        ...MERGED_HEADERS,
        { title: "Eksploruj", key: "explore", sortable: false },
      ],
    });

    expect(
      Number(searchTooltip(wrapper).props("openDelay")),
    ).toBeLessThanOrEqual(500);
  });
});

describe("ExploreTable's searchWithName", () => {
  afterEach(() => vi.restoreAllMocks());

  /** /eksploruj/tabela dropped the "Eksploruj" column: its magnifier opened
   * the drawer, which is what the name link has always done. The pink button
   * beside it opens the search engines, which nothing else on the row does, so
   * that one had to land somewhere - here, on the name it searches for. */
  it("opens the searches from the name cell when the page asks for it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const wrapper = await mountTable({ searchWithName: true });

    const button = wrapper.get("tbody td .v-btn");
    // The cell is capped at 120px on a phone and shares 343px with the history
    // one, so the button exists only from md up - and by a class rather than a
    // `useDisplay()` test, which under SSR starts from a placeholder 1280px.
    expect(button.classes()).toContain("hidden-sm-and-down");

    await button.trigger("click");

    expect(open).toHaveBeenCalled();
    expect(wrapper.emitted("action:explored")?.[0]?.[0]).toMatchObject({
      id: "p1",
    });
    // The drawer opens with the tabs, exactly as the column's button did.
    expect(wrapper.emitted("focus")?.[0]?.[0]).toMatchObject({ id: "p1" });
  });

  /** Both buttons were painted in a fill colour: the search icon in blush
   * (1.37:1 on white) and the magnifier in sage (1.85:1), which is under the
   * 3:1 an icon needs to be seen at all. Both move to a dark ink of their own
   * rather than growing a fill: a filled disc on every row would put the
   * loudest element of the name cell on a utility action. */
  it("paints the row's buttons where they can be seen", async () => {
    const wrapper = await mountTable({
      headers: [
        ...MERGED_HEADERS,
        { title: "Eksploruj", key: "explore", sortable: false },
      ],
    });

    const [search, focus] = wrapper.findAll("tbody td:last-child .v-btn");
    // `ink.neutral` at 6.50:1 on the white row, and no fill behind it: blush
    // is a fill colour and has no dark end in the palette that does not also
    // mean "error".
    expect(search!.classes()).toContain("text-ink-neutral");
    expect(search!.classes()).not.toContain("bg-secondary");
    expect(focus!.classes()).toContain("text-ink-sage");
  });

  it("leaves the name cell alone by default", async () => {
    const wrapper = await mountTable();

    expect(wrapper.find("tbody td .v-btn").exists()).toBe(false);
  });

  /** /eksploruj/nowe still declares an "Eksploruj" column and is the page the
   * two buttons were written for; the new prop is opt-in so that page renders
   * exactly as it did. */
  it("still draws the Eksploruj column for a page that declares it", async () => {
    const wrapper = await mountTable({
      headers: [
        ...MERGED_HEADERS,
        { title: "Eksploruj", key: "explore", sortable: false },
      ],
    });

    expect(wrapper.findAll("tbody td")).toHaveLength(3);
    expect(wrapper.findAll("tbody td:last-child .v-btn")).toHaveLength(2);
  });
});

describe("ExploreTable's scoreOnPhone", () => {
  /** At 390px the merged column set measures 447px against a 358px viewport
   * and the "Oceny" header lands at x=363, off screen: the number cannot be
   * read and the sort behind it cannot be tapped. */
  it("prints the total under the name, below md only", async () => {
    const wrapper = await mountTable({
      scoreOnPhone: true,
      items: [{ ...person(), stats: { votes: { interesting: 7 } } }],
    });

    const line = wrapper.get("tbody td .d-md-none");
    expect(line.text()).toBe("Suma ocen: 7");
  });

  it("says nothing about the score by default", async () => {
    const wrapper = await mountTable();

    expect(wrapper.text()).not.toContain("Suma ocen");
  });

  /** Both at once would be two identical lines on a phone. /eksploruj/nowe
   * asks for the unconditional one; nothing asks for both, and the cell must
   * not fall apart if something does. */
  it("does not double up with scoreWithName", async () => {
    const wrapper = await mountTable({
      scoreWithName: true,
      scoreOnPhone: true,
    });

    expect(
      wrapper
        .get("tbody td")
        .text()
        .match(/Suma ocen/g),
    ).toHaveLength(1);
  });
});

describe("ExploreTable's per-column sort menus", () => {
  /** The regression the menus would otherwise introduce. The arrow used to
   * paint only where `sortBy[0].key === column.key`, so ordering by a key the
   * column covers but is not named after left the table reordered and every
   * header unmarked. */
  it("marks Firmy as sorted when the order came from its own menu", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      sortBy: [{ key: "experience", order: "desc" }],
    });

    const firmy = headerCell(wrapper, "Firmy");
    expect(firmy.text()).toContain("lata pracy");
    expect(firmy.find(".opacity-0").exists()).toBe(false);

    // ...and no other column claims it.
    expect(headerCell(wrapper, "Oceny").find(".opacity-0").exists()).toBe(true);
  });

  it("marks Oceny as sorted by the facts count", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      sortBy: [{ key: "factsCount", order: "desc" }],
    });

    const oceny = headerCell(wrapper, "Oceny");
    expect(oceny.text()).toContain("liczba faktów");
    expect(oceny.find(".opacity-0").exists()).toBe(false);
  });

  it("marks Oceny as sorted by the notes count", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      sortBy: [{ key: "notesCount", order: "desc" }],
    });

    const oceny = headerCell(wrapper, "Oceny");
    expect(oceny.text()).toContain("liczba notatek");
    expect(oceny.find(".opacity-0").exists()).toBe(false);
  });

  /** The column's own key needs no qualifier - the title is already the name
   * of that sort - and printing one would widen every header for nothing. */
  it("adds no qualifier when the sort is the column's own key", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      sortBy: [{ key: "latestEmploymentStart", order: "asc" }],
    });

    const firmy = headerCell(wrapper, "Firmy");
    expect(firmy.text().trim()).toBe("Firmy");
    expect(firmy.find(".opacity-0").exists()).toBe(false);
  });

  /** The <th> sorts on Enter as well as on a click, and only the click is
   * stopped for us. A keyboard reader opening this menu was reordering the
   * table on the column's own key on the way in. */
  it("does not sort when the menu is opened from the keyboard", async () => {
    const wrapper = await mountTable({ headers: SORTABLE_HEADERS, sortBy: [] });

    await headerCell(wrapper, "Firmy")
      .get("button")
      .trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("update:sortBy")).toBeUndefined();
  });

  /** /eksploruj/nowe declares every column `sortable: false` and orders its
   * queue from its own two buttons. A menu there would emit an `update:sortBy`
   * that page does not listen for: a control that visibly does nothing. */
  it("offers no menu on a column the page does not let you sort", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS.map((header) => ({
        ...header,
        sortable: false,
      })),
    });

    expect(headerCell(wrapper, "Firmy").find("button").exists()).toBe(false);
  });

  it("sorts on the key the menu entry names, not on the column key", async () => {
    const wrapper = await mountTable({ headers: SORTABLE_HEADERS, sortBy: [] });

    await headerCell(wrapper, "Firmy").get("button").trigger("click");
    await nextTick();

    // Vuetify hangs its own sort toggle off the <th>, so opening the menu must
    // not also reorder the table on `latestEmploymentStart`.
    expect(wrapper.emitted("update:sortBy")).toBeUndefined();

    const entry = [...document.querySelectorAll(".v-list-item")].find((el) =>
      el.textContent.includes("lat pracy"),
    );
    (entry as HTMLElement).click();
    await nextTick();

    // `experience` verbatim: server/api/nodes/index.get.ts has no allow-list
    // and hands anything else to a Firestore orderBy, which answers with an
    // empty table rather than an error.
    expect(wrapper.emitted("update:sortBy")?.[0]?.[0]).toEqual([
      { key: "experience", order: "desc" },
    ]);
  });
});
