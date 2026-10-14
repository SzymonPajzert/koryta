import { describe, it, expect, vi, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount } from "@vue/test-utils";
import { nextTick } from "vue";
import Filters from "../../../app/components/form/EksplorujTabelaFilters.vue";
import {
  AA_TEXT,
  brand,
  contrastRatio,
  ink,
  readableInkOn,
  surface,
  themeColors,
} from "../../../shared/colors";
import { partyColors } from "../../../shared/misc";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

// Vuetify's overlay machinery observes its activator, and happy-dom ships no
// ResizeObserver - without this the first menu or dialog open throws instead of
// rendering its contents.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Menus and dialogs are teleported to <body> and outlive their component, so a
// panel left open by one test is still on screen for the next one.
enableAutoUnmount(afterEach);

const mount = (props: Record<string, unknown> = {}) =>
  mountSuspended(Filters, {
    props: {
      availableParties: [{ title: "PiS", value: "PiS" }],
      availableRegions: [{ title: "Mazowieckie", value: "teryt14" }],
      availableCompanies: [{ title: "Spółka", value: "company-1" }],
      ...props,
    },
  });

type Wrapper = Awaited<ReturnType<typeof mount>>;

/** The bar carries two of these - a menu activator for md and up, a fullscreen
 * dialog activator below it, both in the DOM at once because a display class
 * and not a `v-if` decides which is visible. They say the same thing, and this
 * asks the desktop one: `findAll` would otherwise hand back whichever sits
 * first in the DOM, so a label that drifted on the other activator would go
 * unnoticed here. */
const toggle = (wrapper: Wrapper) => {
  const button = wrapper.find(".v-btn.d-none.d-md-inline-flex");
  if (!button.exists()) throw new Error("no desktop filters button");
  return button;
};

const phoneToggle = (wrapper: Wrapper) => wrapper.find(".v-btn.d-md-none");

const railChips = (wrapper: Wrapper) =>
  wrapper.findAll(".tabela-query-bar__rail .v-chip");

const workRow = (wrapper: Wrapper) =>
  wrapper.find("[data-testid='tabela-work-row']");

/** The overlay that is open right now, wherever it was teleported to. A menu
 * that has been opened and closed stays in the document. */
const openOverlayText = () =>
  [...document.querySelectorAll(".v-overlay--active .v-overlay__content")]
    .map((el) => el.textContent)
    .join(" ");

const sortButton = (wrapper: Wrapper) => {
  const button = wrapper
    .findAll(".v-btn")
    .find((candidate) =>
      candidate.attributes("aria-label")?.startsWith("Sortowanie"),
    );
  if (!button) throw new Error("no sort button");
  return button;
};

/** Everything Vuetify teleported to <body>, dialog contents included. */
const overlayText = () =>
  document.querySelector(".v-overlay-container")?.textContent ?? "";

/** The share dialog's contents do not exist until the overlay has settled. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const buttonNamed = (wrapper: Wrapper, label: string) =>
  wrapper
    .findAll(".v-btn")
    .find((candidate) => candidate.text().trim() === label);

describe("the table's query bar", () => {
  it("counts the filters it is hiding, so none of them work in secret", async () => {
    const wrapper = await mount();
    expect(toggle(wrapper).text()).toBe("Filtry");

    // Two narrowing filters, and two that are set to the value that narrows
    // nothing - those must not be counted.
    await wrapper.setProps({
      party: ["PiS"],
      teryt: "teryt14",
      visibility: "all",
      hideVoted: "all",
    });
    expect(toggle(wrapper).text()).toBe("Filtry (2)");

    await wrapper.setProps({ visibility: "private" });
    expect(toggle(wrapper).text()).toBe("Filtry (3)");
  });

  it("does not count an empty selection as a filter", async () => {
    const wrapper = await mount();
    await wrapper.setProps({ party: [], place: [], teryt: null });
    expect(toggle(wrapper).text()).toBe("Filtry");
  });

  it("names every filter on the rail, in Polish and in full", async () => {
    const wrapper = await mount({
      teryt: "teryt14",
      category: "szpitale",
      minVotes: 5,
    });

    // The region by name rather than by teryt code: `availableRegions` is what
    // resolves one into the other, and it is a prop for exactly this.
    expect(railChips(wrapper).map((chip) => chip.text())).toEqual([
      "Region: Mazowieckie",
      "Szpitale",
      "Min. 5 głosów",
    ]);
  });

  it("says so when nothing is narrowing the table", async () => {
    const wrapper = await mount();

    expect(railChips(wrapper)).toHaveLength(0);
    expect(wrapper.text()).toContain("Wszystkie osoby w bazie");
  });

  it("clears one filter from its chip, and only that one", async () => {
    const wrapper = await mount({ teryt: "teryt14", category: "szpitale" });

    const region = railChips(wrapper).find((chip) =>
      chip.text().includes("Mazowieckie"),
    );
    // VChip's own label for the x is the English „Close”, and it is the same
    // string on all six chips - a reader arriving at it by keyboard would be
    // told nothing about which filter it drops.
    expect(region!.get(".v-chip__close").attributes("aria-label")).toBe(
      "Usuń filtr: Region: Mazowieckie",
    );
    await region!.get(".v-chip__close").trigger("click");

    expect(wrapper.emitted("update:teryt")?.[0]).toEqual([null]);
    expect(wrapper.emitted("update:category")).toBeUndefined();
  });

  /** Ten filters are ten writable computeds over `route.query`, and ten writes
   * in one tick would each start from the same url with the last one winning.
   * The page clears them in a single write; the bar only asks. */
  it("asks the page to clear everything at once", async () => {
    const wrapper = await mount({ teryt: "teryt14", category: "szpitale" });

    await buttonNamed(wrapper, "Wyczyść")!.trigger("click");

    expect(wrapper.emitted("clear")).toHaveLength(1);
  });

  /** One chip is one x away from being gone; a second button for it would be
   * a wider bar for nothing. */
  it("offers no clear-all until there are two filters to clear", async () => {
    const wrapper = await mount({ teryt: "teryt14" });
    expect(buttonNamed(wrapper, "Wyczyść")).toBeUndefined();

    await wrapper.setProps({ category: "szpitale" });
    expect(buttonNamed(wrapper, "Wyczyść")).toBeDefined();
  });

  it("counts the rows at every width", async () => {
    const wrapper = await mount({ totalItems: 1284 });
    // Grouped, and with the non-breaking space `Intl` puts there: the work
    // row a line below says „sprawdzono ... z 1 284 osób”, so the same total
    // spelled „1284” above it read as a second, different number.
    expect(wrapper.text()).toContain("1\u00a0284 osoby");
  });

  /** /eksploruj/autograf/[type] mounts this bar over a chart, with no table
   * and no total to report. A count of nothing would be a lie about an empty
   * search. */
  it("prints no count where the page gave it none", async () => {
    const wrapper = await mount();
    expect(wrapper.find(".tabela-query-bar__count").exists()).toBe(false);
  });

  it("opens the whole filter set on the button", async () => {
    const wrapper = await mount();

    await toggle(wrapper).trigger("click");
    await nextTick();

    // The three most used public filters are the top of the panel.
    expect(openOverlayText()).toContain("Region osoby");
    expect(openOverlayText()).toContain("Typ podmiotu");
    expect(openOverlayText()).toContain("Zatrudnienie");
  });

  /** The width decision is made in css, because Vuetify's `useDisplay()` under
   * SSR starts from a placeholder 1280px and corrects only when suspense
   * resolves. jsdom cannot say which of the two activators is on screen, but it
   * can say that there are exactly two and that each carries the class that
   * hides it at the other width - drop one of those classes and every reader
   * gets two „Filtry” buttons side by side. */
  it("carries one activator per width, each gated in css", async () => {
    const wrapper = await mount({ teryt: "teryt14" });

    const activators = wrapper
      .findAll(".v-btn")
      .filter((button) => button.text().startsWith("Filtry"));
    expect(activators).toHaveLength(2);
    expect(toggle(wrapper).text()).toBe("Filtry (1)");
    expect(phoneToggle(wrapper).text()).toBe("Filtry (1)");
  });

  /** A guest cannot set these from here, but the api honours them all the same:
   * `hideVoted`, `minVotes` and `minEmploymentDate` are applied to everybody,
   * and `visibility=private` answers a signed-out reader with an empty result
   * set. Hiding the chip would leave them looking at a table that had been cut
   * from under them by a link, with nothing on screen to name it or take it
   * off. */
  it("names an administrative filter to a guest, and lets them clear it", async () => {
    const wrapper = await mount({
      showVisibility: false,
      visibility: "private",
      hideVoted: "no_votes",
    });

    expect(toggle(wrapper).text()).toBe("Filtry (2)");
    expect(railChips(wrapper).map((chip) => chip.text())).toEqual([
      "Tylko szkice",
      "Bez ocenionych",
    ]);

    await railChips(wrapper)[0]!.get(".v-chip__close").trigger("click");
    expect(wrapper.emitted("update:visibility")?.[0]).toEqual(["all"]);
  });

  /** ...but its body is not a button for them: the panel gates „Weryfikacja”
   * on the same prop, so opening it would answer the click with a panel that
   * does not hold the filter that was clicked. */
  it("does not offer a guest a panel that cannot hold the filter", async () => {
    const wrapper = await mount({
      showVisibility: false,
      visibility: "private",
      category: "szpitale",
    });

    const chips = railChips(wrapper);
    const admin = chips.find((chip) => chip.text() === "Tylko szkice");
    const open = chips.find((chip) => chip.text() === "Szpitale");
    expect(admin!.classes()).not.toContain("v-chip--link");
    expect(open!.classes()).toContain("v-chip--link");
  });
});

describe("the query bar's sort control", () => {
  /** Below 960px „Oceny” and „Wybory” are `hidden-sm-and-down` and their
   * header sorts go with them, so this button is the only thing on the page
   * that can say how the table is ordered. Hidden behind `d-none d-md-inline`
   * it left a phone reader with an icon and an arrow and no name for either. */
  it("names the sort at every width", async () => {
    const wrapper = await mount({
      sortBy: [{ key: "stats.votes.interesting", order: "desc" }],
    });

    const button = sortButton(wrapper);
    expect(button.text()).toBe("Oceny");
    // Nothing inside it may be hidden at a width: the label is the whole
    // point of the button on a phone.
    expect(button.find(".d-none").exists()).toBe(false);
    expect(button.attributes("aria-label")).toBe("Sortowanie: Suma ocen");
  });

  /** A freshly loaded table is in whatever order the api returned. The arrow
   * was drawn from `order !== "asc"`, so with no sort at all it pointed down
   * and claimed an order the rows are not in. */
  it("claims no direction until something is sorted", async () => {
    const wrapper = await mount({ sortBy: [] });

    expect(sortButton(wrapper).text()).toBe("Sortowanie");
    expect(sortButton(wrapper).find(".v-btn__append").exists()).toBe(false);

    await wrapper.setProps({ sortBy: [{ key: "name", order: "asc" }] });
    expect(sortButton(wrapper).text()).toBe("Nazwisko");
    expect(sortButton(wrapper).find(".v-btn__append").exists()).toBe(true);
  });

  /** /eksploruj/tabela dropped its „Widoczność” column, and this menu is the
   * only place the sort behind it is left: `visibility` maps onto
   * `stats.isApproved` in the api, and a link that already carries
   * `?sortBy=visibility` has no header to put an arrow on any more. */
  it("keeps the visibility sort for a signed-in reader", async () => {
    const wrapper = await mount({ sortBy: [], showVisibility: true });

    await sortButton(wrapper).trigger("click");
    await nextTick();

    expect(openOverlayText()).toContain("Status");
  });

  /** „Status” orders by a flag a guest cannot see behind: every row they are
   * served is published, so it would sort the whole table into one bucket. */
  it("hides it from a guest", async () => {
    const wrapper = await mount({ sortBy: [], showVisibility: false });

    await sortButton(wrapper).trigger("click");
    await nextTick();

    expect(openOverlayText()).toContain("Nazwisko");
    expect(openOverlayText()).not.toContain("Status");
  });
});

describe("the query bar's share card", () => {
  /** The checkbox compared `shareUrl(query, "", { withPaging: true })` against
   * the plain one, and the bar's `query` carried no paging at all - so the two
   * strings were always equal and „Dołącz stronę i liczbę wierszy” could never
   * be reached, whatever page the reader was standing on. */
  it("offers the reader's page to the link when there is one", async () => {
    // Page 2 at the row count the table starts with: nothing but the page
    // number is worth adding, and that is enough for the offer to be real.
    const wrapper = await mount({ showShare: true, sortBy: [], page: 2 });

    await wrapper.get("[aria-label='Udostępnij ten widok']").trigger("click");
    await settle();

    expect(overlayText()).toContain("Dołącz stronę i liczbę wierszy");

    const checkbox = document.querySelector<HTMLInputElement>(
      '.v-overlay-container input[type="checkbox"]',
    );
    checkbox!.click();
    await settle();

    expect(
      document.querySelector<HTMLInputElement>(
        '.v-overlay-container input[type="text"]',
      )?.value,
    ).toContain("page=2");
  });

  /** ...and not on the first page at the row count the table starts with,
   * where ticking it would produce the address it already shows. */
  it("keeps it away from an unpaged first page", async () => {
    const wrapper = await mount({ showShare: true, sortBy: [], page: 1 });

    await wrapper.get("[aria-label='Udostępnij ten widok']").trigger("click");
    await settle();

    expect(overlayText()).not.toContain("Dołącz stronę");
  });
});

describe("the query bar's work row", () => {
  it("stays away from a page that has nothing to verify", async () => {
    const wrapper = await mount({ visibility: "private" });

    expect(workRow(wrapper).exists()).toBe(false);
    // ...and the verification filter is still named somewhere: with no work
    // row to hold it, the chip belongs on the rail.
    expect(railChips(wrapper).map((chip) => chip.text())).toContain(
      "Tylko szkice",
    );
  });

  it("stays away from a reader who cannot act on it", async () => {
    const wrapper = await mount({ showProgress: true, showVisibility: false });

    expect(workRow(wrapper).exists()).toBe(false);
  });

  it("offers the four verification filters one click from the page", async () => {
    const wrapper = await mount({ showProgress: true });

    expect(
      workRow(wrapper)
        .findAll(".v-btn")
        .map((button) => button.text()),
    ).toEqual(
      expect.arrayContaining([
        "Widoczność",
        "Bez ocenionych",
        "Od kiedy",
        "Min. głosy",
      ]),
    );
  });

  /** „+ Głosy” next to „+ Min. głosy” made the reader open one of them to find
   * out which was which - the cost the work row exists to remove. The unset
   * shortcut is named after what setting it does, exactly as its chip is. */
  it("names each shortcut after what it sets", async () => {
    const wrapper = await mount({ showProgress: true });

    const labels = workRow(wrapper)
      .findAll(".v-btn")
      .map((button) => button.text());
    expect(labels).not.toContain("Głosy");
    expect(labels.filter((label) => label.includes("głos"))).toEqual([
      "Min. głosy",
    ]);
  });

  it("turns a set filter into a chip and takes its shortcut away", async () => {
    const wrapper = await mount({ showProgress: true, hideVoted: "no_votes" });

    const row = workRow(wrapper);
    expect(row.findAll(".v-chip").map((chip) => chip.text())).toEqual([
      "bez ocenionych",
    ]);
    expect(row.findAll(".v-btn").map((button) => button.text())).not.toContain(
      "Bez ocenionych",
    );

    // The same filter must not also sit on the rail above: one filter drawn
    // twice reads as two.
    expect(railChips(wrapper)).toHaveLength(0);
  });

  it("clears a verification filter from its chip", async () => {
    const wrapper = await mount({ showProgress: true, minVotes: 5 });

    await workRow(wrapper).get(".v-chip__close").trigger("click");

    expect(wrapper.emitted("update:minVotes")?.[0]).toEqual([null]);
  });

  /** In the mock the body of a set chip did nothing, so „min. 5 głosów” could
   * only be changed by clearing it and starting over. */
  it("opens the same one-control menu from a set chip", async () => {
    const wrapper = await mount({ showProgress: true, minVotes: 5 });

    await workRow(wrapper).get(".v-chip").trigger("click");
    await nextTick();

    expect(openOverlayText()).toContain("Min. głosy łącznie");
    // Exactly that one control, not the whole panel.
    expect(openOverlayText()).not.toContain("Region osoby");
  });
});

/** Every filter at once, so that one mount holds one chip of every kind the
 * rail can draw. */
const EVERY_FILTER = {
  place: ["company-1"],
  teryt: "teryt14",
  companyTeryt: "teryt14",
  category: "szpitale",
  party: ["PiS"],
  currentlyEmployed: "any",
  visibility: "private",
  hideVoted: "no_votes",
  minEmploymentDate: "2024-01-15",
  minVotes: 5,
};

/** Every colour a class on a chip can name. The two brand fills are added
 * back: Vuetify has them and `themeColors` deliberately does not, and they are
 * exactly what a chip must not be painting its label with. */
const theme: Record<string, string> = {
  ...themeColors,
  primary: brand.primary,
  secondary: brand.secondary,
};

/** `rgb(7, 59, 118)` back to `#073b76`: an inline colour is read out of the
 * element, and both jsdom and happy-dom hand hex back as rgb. */
const hex = (colour: string) => {
  const parsed = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(colour);
  return parsed
    ? `#${parsed
        .slice(1)
        .map((channel) => Number(channel).toString(16).padStart(2, "0"))
        .join("")}`
    : colour;
};

/** The ink and the background a chip is actually painted with.
 *
 * A `bg-*` class is Vuetify's own pairing - it writes the background and its
 * matching `on-*` ink in one rule - so that pair is read back out of the theme
 * rather than off the element: the test DOM carries no stylesheet, and a
 * `getComputedStyle` here would report the default black on nothing and pass
 * whatever we did.
 */
/** Vuetify's light `surface-variant`, which is what a `variant="flat"` chip
 * with no colour of its own is painted with - a dark grey, under an #eeeeee
 * ink. A chip that sets one of the two and not the other lands here. */
const FLAT_SURFACE = "#424242";
const FLAT_INK = "#eeeeee";

const painted = (chip: { classes: () => string[]; element: Element }) => {
  const classes = chip.classes();
  const token = classes
    .find((name) => name.startsWith("bg-"))
    ?.slice("bg-".length);
  if (token) return [theme[`on-${token}`]!, theme[token]!];

  const style = (chip.element as HTMLElement).style;
  const background = style.backgroundColor
    ? hex(style.backgroundColor)
    : classes.includes("v-chip--variant-flat")
      ? FLAT_SURFACE
      : surface.white;
  if (style.color) return [hex(style.color), background];

  // No colour of its own at all, so whatever a `text-*` class names is the
  // whole of it. This is what `variant="tonal" color="primary"` came to - the
  // tonal wash under the label is 12% of the same colour, so the bar's white
  // is the right thing to measure against, give or take a tenth in the
  // failing direction.
  const named = classes
    .find((name) => name.startsWith("text-"))
    ?.slice("text-".length);
  if (named) return [theme[named] ?? ink.strong, background];
  return [background === FLAT_SURFACE ? FLAT_INK : ink.strong, background];
};

describe("the query bar's chip colours", () => {
  /** The complaint this answers, measured: `variant="tonal" color="primary"`
   * paints the label in the colour itself, and primary is a pale fill - 12px
   * of #a8c79f on the white bar is 1.85:1 against the 4.5:1 AA asks for. Every
   * chip is checked rather than one, because each filter picks its own hue. */
  it("keeps every chip's label readable on the colour under it", async () => {
    const wrapper = await mount(EVERY_FILTER);

    const chips = railChips(wrapper);
    expect(chips).toHaveLength(10);
    for (const chip of chips) {
      const [ink, background] = painted(chip);
      // The chip's own words as the assertion message: ten of them are checked
      // here and a bare „expected 1.85 to be at least 4.5” would not say which.
      expect(
        contrastRatio(ink, background),
        chip.text(),
      ).toBeGreaterThanOrEqual(AA_TEXT);
      // The failure itself and not only its ratio: neither brand colour is a
      // text colour, and both were being used as one here.
      expect(ink, chip.text()).not.toBe(brand.primary);
      expect(ink, chip.text()).not.toBe(brand.secondary);
    }
  });

  /** One icon on the rail, on the one chip whose label does not name its own
   * filter: „Szpitale” is a bare sector name, where „Region: Małopolskie”,
   * „Zatrudnieni od 1 marca 2021” and „Min. 5 głosów” each say what they are
   * narrowing. An icon on those repeated the word beside it and spent the
   * width of a glyph doing it, on a rail that shares one line with the
   * heading, the „Filtry” button, the count and the sort. */
  it("gives an icon only to the chip whose label is a bare name", async () => {
    const wrapper = await mount(EVERY_FILTER);

    const withIcon = railChips(wrapper).filter((chip) =>
      chip.find(".v-chip__prepend .v-icon").exists(),
    );
    expect(withIcon.map((chip) => chip.text())).toEqual(["Szpitale"]);
  });

  /** The same colour the row below paints the person's party with, and the
   * same `readableInkOn` call: black on Konfederacja's navy is 1.29:1, so the
   * ink is measured against the fill rather than fixed. */
  it("paints a single party in the party's own colour", async () => {
    const wrapper = await mount({ party: ["Konfederacja"] });

    const [ink, background] = painted(railChips(wrapper)[0]!);
    expect(background).toBe(partyColors.Konfederacja!.toLowerCase());
    expect(ink).toBe(readableInkOn(partyColors.Konfederacja!));
    expect(contrastRatio(ink, background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  /** „Partie: 2” has no one party to take a colour from, and painting it with
   * the first would say the filter is narrower than it is. */
  it("leaves a multi-party filter without a party colour", async () => {
    const wrapper = await mount({ party: ["PiS", "PO"] });

    const chip = railChips(wrapper)[0]!;
    expect(chip.text()).toBe("Partie: 2");
    expect(chip.classes()).toContain("bg-surface-muted");
    expect((chip.element as HTMLElement).style.backgroundColor).toBe("");
  });

  /** The filter and the rows it leaves behind in one colour: „Tylko szkice”
   * carries the amber the table's `szkic` badge does, „Tylko opublikowane” the
   * green of a published row. */
  it("colours the visibility chip after what it leaves on the table", async () => {
    const wrapper = await mount({ visibility: "private" });
    expect(railChips(wrapper)[0]!.classes()).toContain("bg-surface-warning");

    await wrapper.setProps({ visibility: "public" });
    expect(railChips(wrapper)[0]!.classes()).toContain("bg-surface-success");
  });

  /** The work row draws the same four filters as chips of its own, and they
   * were the `blue-grey` ones - #607d8b on white, 4.37:1, which never
   * passed. */
  it("keeps the work row's chips readable too", async () => {
    const wrapper = await mount({ showProgress: true, minVotes: 5 });

    const chip = workRow(wrapper).find(".v-chip");
    const [ink, background] = painted(chip);
    expect(contrastRatio(ink, background)).toBeGreaterThanOrEqual(AA_TEXT);
    // „min. 5 głosów” says what it filters, so it carries no icon either.
    expect(chip.find(".v-chip__prepend .v-icon").exists()).toBe(false);
  });
});

describe("the filter panel's groups", () => {
  /** The entity page's group heading, brought over: a small uppercase label
   * with a count on the right. The panel opened from a shared link then says
   * which of its three blocks is doing the narrowing before any control in it
   * has been read. */
  it("counts what is set in each group beside its heading", async () => {
    const wrapper = await mount({
      teryt: "teryt14",
      category: "szpitale",
      currentlyEmployed: "any",
      visibility: "private",
      // Zero is a filter and the strictest one there is: the api turns
      // `minVotes` into a Firestore `>=`, which drops everybody with no votes
      // field at all. Counted, or the section that is hiding them says „1
      // filtr” while two are set.
      minVotes: 0,
      party: ["PiS"],
    });

    await toggle(wrapper).trigger("click");
    await nextTick();

    const text = openOverlayText();
    expect(text).toContain("Osoba i podmiot");
    expect(text).toContain("3 filtry");
    expect(text).toContain("Weryfikacja");
    expect(text).toContain("2 filtry");
    expect(text).toContain("Więcej filtrów");
    expect(text).toContain("1 filtr");
  });

  /** „Wszystkie osoby” under „Zatrudnienie” is the absence of a filter, and a
   * „0 filtrów” beside a section nobody has touched is noise on a panel whose
   * whole point was to stop being one. */
  it("says nothing beside a group nobody has touched", async () => {
    const wrapper = await mount();

    await toggle(wrapper).trigger("click");
    await nextTick();

    expect(openOverlayText()).not.toContain("0 filtr");
  });

  /** The same colour as the chip on the rail and as the party column in the
   * table: a party is one colour on this page, wherever it is named. */
  it("paints the chosen parties in the party's own colour", async () => {
    const wrapper = await mount({ party: ["Konfederacja"] });

    await toggle(wrapper).trigger("click");
    await nextTick();

    const chip = document.querySelector(
      ".v-overlay--active .v-autocomplete .v-chip",
    );
    expect(chip).toBeTruthy();
    const [ink, background] = painted({
      classes: () => [...chip!.classList],
      element: chip!,
    });
    expect(background).toBe(partyColors.Konfederacja);
    expect(contrastRatio(ink, background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  /** Several of the parties the filter offers have no colour in
   * `shared/misc` - Razem's is commented out - and a flat chip with no
   * background of its own falls back to Vuetify's `surface-variant`, #424242
   * in the light theme, under near-black ink. */
  it("keeps a party with no colour of its own readable", async () => {
    const wrapper = await mount({ party: ["Razem"] });

    await toggle(wrapper).trigger("click");
    await nextTick();

    const chip = document.querySelector(
      ".v-overlay--active .v-autocomplete .v-chip",
    );
    expect(partyColors.Razem).toBeUndefined();
    const [ink, background] = painted({
      classes: () => [...chip!.classList],
      element: chip!,
    });
    expect(contrastRatio(ink, background)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
