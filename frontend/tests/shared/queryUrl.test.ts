import { describe, it, expect } from "vitest";
import {
  describeQuery,
  hasWikipediaOptions,
  hideVotedOptions,
  queryChips,
  shareQuery,
  shareUrl,
  visibilityOptions,
  type TableQuery,
} from "../../shared/queryUrl";

const lookup = {
  region: (teryt: string) =>
    ({ teryt1261: "Kraków", teryt1465: "Warszawa" })[teryt],
  company: (id: string) => ({ "c-mpk-krakow": "MPK Kraków" })[id],
};

/** The link from UDOSTEPNIANIE.md: what an editor actually pastes today. */
const OWNERS_QUERY: TableQuery = {
  sortBy: "stats.votes.interesting",
  sortDesc: "true",
  category: "szpitale",
  currentlyEmployed: "selected",
  visibility: "private",
  hideVoted: "no_votes",
  itemsPerPage: 100,
  page: 3,
};

describe("shareQuery", () => {
  it("drops filters sitting at their neutral value", () => {
    // These three reach the url whenever somebody flips a filter there and
    // back; none of them narrows anything.
    expect(
      shareQuery({
        category: "szpitale",
        visibility: "all",
        hideVoted: "all",
        currentlyEmployed: "all",
      }),
    ).toEqual({ category: "szpitale" });
  });

  it("drops empty, null and absent values", () => {
    expect(
      shareQuery({ teryt: "", party: [], place: null, category: undefined }),
    ).toEqual({});
  });

  it("drops the page and the row count", () => {
    // The recipient never scrolled those three pages, so the parameters
    // describing where the sharer got to are noise to them.
    expect(shareQuery(OWNERS_QUERY)).not.toHaveProperty("page");
    expect(shareQuery(OWNERS_QUERY)).not.toHaveProperty("itemsPerPage");
  });

  it("keeps minVotes=0, which does narrow the table", () => {
    // The api turns it into a Firestore `>=`, and a range filter drops every
    // document without the field.
    expect(shareQuery({ minVotes: 0 })).toEqual({ minVotes: "0" });
  });

  it("drops a sort direction with nothing to sort by", () => {
    expect(shareQuery({ sortDesc: "true" })).toEqual({});
    expect(shareQuery({ sortBy: "name", sortDesc: "false" })).toEqual({
      sortBy: "name",
    });
  });

  it("keeps a repeated filter as an array, without duplicates", () => {
    expect(shareQuery({ party: ["PiS", "KO", "PiS"] })).toEqual({
      party: ["PiS", "KO"],
    });
  });
});

describe("shareUrl", () => {
  it("gives the canonical address for the owner's query", () => {
    expect(shareUrl(OWNERS_QUERY, "https://koryta.pl")).toBe(
      "https://koryta.pl/eksploruj/tabela?category=szpitale" +
        "&currentlyEmployed=selected&visibility=private&hideVoted=no_votes" +
        "&sortBy=stats.votes.interesting&sortDesc=true",
    );
  });

  it("orders the keys the same way whatever order they arrive in", () => {
    // A hash of the query is the next step in UDOSTEPNIANIE.md, and it can
    // only be stable if this string is.
    const one: TableQuery = { category: "szpitale", teryt: "teryt1261" };
    const other: TableQuery = { teryt: "teryt1261", category: "szpitale" };
    expect(shareUrl(one, "https://koryta.pl")).toBe(
      shareUrl(other, "https://koryta.pl"),
    );
  });

  it("keeps the path alone when nothing is filtered", () => {
    expect(shareUrl({ page: 2, visibility: "all" }, "https://koryta.pl")).toBe(
      "https://koryta.pl/eksploruj/tabela",
    );
  });

  it("takes a trailing slash off the origin, and works without one", () => {
    expect(shareUrl({ category: "koleje" }, "https://koryta.pl/")).toBe(
      "https://koryta.pl/eksploruj/tabela?category=koleje",
    );
    expect(shareUrl({ category: "koleje" })).toBe(
      "/eksploruj/tabela?category=koleje",
    );
  });

  it("adds the paging back when the sharer asks for it", () => {
    expect(
      shareUrl(OWNERS_QUERY, "https://koryta.pl", { withPaging: true }),
    ).toContain("&itemsPerPage=100&page=3");
  });
});

describe("queryChips", () => {
  it("names one chip per filter that is narrowing the table", () => {
    const chips = queryChips(
      {
        category: "szpitale",
        teryt: "teryt1261",
        place: ["c-mpk-krakow"],
        currentlyEmployed: "any",
        visibility: "all",
        page: 4,
      },
      lookup,
    );

    expect(chips.map((chip) => [chip.key, chip.label])).toEqual([
      ["place", "MPK Kraków"],
      ["teryt", "Region: Kraków"],
      ["category", "Szpitale"],
      ["currentlyEmployed", "Teraz w publicznej spółce"],
    ]);
  });

  it("flags the editor-only filters", () => {
    const chips = queryChips({
      category: "szpitale",
      visibility: "private",
      hideVoted: "no_votes",
      minVotes: 5,
      minEmploymentDate: "2021-03-01",
    });

    expect(
      Object.fromEntries(chips.map((chip) => [chip.key, chip.admin])),
    ).toEqual({
      category: false,
      visibility: true,
      hideVoted: true,
      minEmploymentDate: true,
      minVotes: true,
    });
    expect(chips.map((chip) => chip.label)).toContain("Min. 5 głosów");
    // Spelled out, not the ISO day the url carries: the rail and the share
    // sentence read this as prose, beside chips like „tylko szkice”.
    expect(chips.map((chip) => chip.label)).toContain(
      "Zatrudnieni od 1 marca 2021",
    );
  });

  it("prints an unparseable employment date as it arrived", () => {
    // The value comes from the url and nothing validates it on the way in. A
    // chip that answered „Zatrudnieni od brak daty” would name no filter, and
    // this one is closable: the reader has to recognise what they are clearing.
    const [chip] = queryChips({ minEmploymentDate: "wczoraj" });
    expect(chip?.label).toBe("Zatrudnieni od wczoraj");
    expect(chip?.short).toBe("od wczoraj");
  });

  it("counts several employers instead of naming one of them", () => {
    const [chip] = queryChips(
      { place: ["c-mpk-krakow", "c-khk", "c-arm-krakow"] },
      lookup,
    );
    expect(chip?.label).toBe("Instytucje: 3");
    expect(chip?.short).toBe("3 instytucje");
  });

  it("clears the legacy krs parameter along with place", () => {
    // A link minted before employers were keyed on node ids carries only
    // `krs`; clearing `place` alone would leave the table filtered.
    const [chip] = queryChips({ krs: ["0000123456"] }, lookup);
    expect(chip?.key).toBe("place");
    expect(chip?.clears).toEqual(["place", "krs"]);
  });

  it("names the seat filter apart from the person's region", () => {
    const chips = queryChips(
      { teryt: "teryt1261", companyTeryt: "teryt1465" },
      lookup,
    );
    expect(chips.map((chip) => chip.label)).toEqual([
      "Region: Kraków",
      "Siedziba: Warszawa",
    ]);
  });

  it("merges party and parties, which are the same filter", () => {
    // The url writes `party`, the api also accepts `parties`; two chips for
    // one filter would let the reader clear half of it.
    const chips = queryChips({ party: "PiS", parties: ["PiS", "KO"] });
    expect(chips).toHaveLength(1);
    expect(chips[0]?.label).toBe("Partie: 2");
    expect(chips[0]?.clears).toEqual(["party", "parties"]);
  });

  it("names the no-party sentinel rather than printing it", () => {
    const [chip] = queryChips({ party: ["__NONE__"] });
    expect(chip?.label).toBe("Brak partii");
  });

  it("falls back to the raw code when the region list has not arrived", () => {
    const [chip] = queryChips({ teryt: "teryt1261" });
    expect(chip?.label).toBe("Region: teryt1261");
  });

  it("words each editor toggle exactly as the menu that sets it", () => {
    // The chip is the button that opens that menu:
    // `EksplorujTabelaVerificationFields` builds its selects from these two
    // lists, so a title reworded here reaches both places or neither. It used
    // to reach neither - the chip said „Bez ocenionych” over a menu offering
    // „Brak głosu”.
    for (const [key, options] of [
      ["visibility", visibilityOptions],
      ["hideVoted", hideVotedOptions],
      ["hasWikipedia", hasWikipediaOptions],
    ] as const) {
      for (const option of options.filter((item) => item.short)) {
        const [chip] = queryChips({ [key]: option.value });
        expect(chip?.label).toBe(option.title);
        expect(chip?.short).toBe(option.short);
      }
    }
  });

  it("gives the neutral value of those toggles no chip", () => {
    // „Wszystkie” is the entry that turns the filter off; a chip for it would
    // offer an x that changes nothing.
    expect(
      queryChips({ visibility: "all", hideVoted: "all", hasWikipedia: "all" }),
    ).toEqual([]);
  });

  it("marks the Wikipedia filter as one a guest can use", () => {
    // The link is on the page for anybody to read, so the chip is not tinted
    // as an editor's and the rail lets a signed-out reader click it.
    const [chip] = queryChips({ hasWikipedia: "yes" });
    expect(chip?.admin).toBe(false);
    expect(chip?.clears).toEqual(["hasWikipedia"]);
  });
});

describe("describeQuery", () => {
  it("describes the owner's query in one line of Polish", () => {
    expect(describeQuery(OWNERS_QUERY, lookup)).toBe(
      "Szpitale · w wyszukanych podmiotach · tylko szkice · bez ocenionych" +
        " · wg sumy ocen",
    );
  });

  it("reads subject first, then place, then the narrowings", () => {
    expect(
      describeQuery(
        { teryt: "teryt1261", hideVoted: "no_votes", category: "szpitale" },
        lookup,
      ),
    ).toBe("Szpitale · Kraków · bez ocenionych");
  });

  it("names the Wikipedia filter after the subject, before the narrowings", () => {
    expect(
      describeQuery(
        { hasWikipedia: "yes", category: "szpitale", visibility: "private" },
        lookup,
      ),
    ).toBe("Szpitale · z Wikipedią · tylko szkice");
  });

  it("says so when nothing is filtered", () => {
    expect(describeQuery({ page: 2, itemsPerPage: 50 })).toBe(
      "wszystkie osoby w bazie",
    );
  });

  it("leaves out a sort key it has no Polish name for", () => {
    // Rather than pasting `wg stats.edges.all.experienceMonths` into a link
    // somebody is meant to want to click.
    expect(describeQuery({ sortBy: "stats.edges.all.experienceMonths" })).toBe(
      "wszystkie osoby w bazie",
    );
  });
});
