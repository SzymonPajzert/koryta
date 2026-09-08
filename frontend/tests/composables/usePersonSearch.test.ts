import { describe, it, expect, vi, afterEach } from "vitest";
import { ref } from "vue";
import { usePersonSearch } from "../../app/composables/usePersonSearch";
import type { PersonRich } from "../../shared/model";

function person(overrides: Partial<PersonRich> = {}): PersonRich {
  return {
    id: "jan",
    type: "person",
    name: "Jan Kowalski",
    companies: [],
    elections: [],
    experience: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePersonSearch", () => {
  it("searches the bare name and the PKW register", () => {
    const { queries } = usePersonSearch(person());
    expect(queries.value).toEqual(["Jan Kowalski", "Jan Kowalski PKW"]);
  });

  it("searches the cities the person has worked in", () => {
    const { queries } = usePersonSearch(
      person({ workLocations: ["Płock", "Warszawa"] }),
    );
    expect(queries.value).toContain("Jan Kowalski Płock");
    expect(queries.value).toContain("Jan Kowalski Warszawa");
  });

  it("puts where they stood for election before where they worked", () => {
    const { queries } = usePersonSearch(
      person({
        elections: [{ location: "Kraków", position: "Rada miasta" }],
        workLocations: ["Płock"],
      }),
    );
    expect(queries.value).toEqual([
      "Jan Kowalski",
      "Jan Kowalski PKW",
      "Jan Kowalski Kraków",
      "Jan Kowalski Płock",
    ]);
  });

  it("does not search a city twice when it is both", () => {
    // A councillor employed by their own gmina, which is common.
    const { queries } = usePersonSearch(
      person({
        elections: [{ location: "Kraków", position: "Rada miasta" }],
        workLocations: ["Kraków"],
      }),
    );
    expect(
      queries.value.filter((q) => q === "Jan Kowalski Kraków"),
    ).toHaveLength(1);
  });

  it("drops the middle name from a location query", () => {
    const { queries } = usePersonSearch(
      person({ name: "Jan Maria Kowalski", workLocations: ["Płock"] }),
    );
    expect(queries.value).toContain("Jan Kowalski Płock");
  });

  it("takes cities the caller worked out itself", () => {
    const extra = ref<string[] | undefined>(["Gdańsk"]);
    const { queries } = usePersonSearch(person(), undefined, undefined, extra);
    expect(queries.value).toContain("Jan Kowalski Gdańsk");
  });

  it("caps how many tabs searchAll can open", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    const cities = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const { queries, searchAll } = usePersonSearch(
      person({ workLocations: cities }),
    );

    // Name, PKW, and six of the eight cities.
    expect(queries.value).toHaveLength(8);

    searchAll();
    // One more for rejestr.io, one for wikipedia.
    expect(open).toHaveBeenCalledTimes(10);
  });

  it("does not ask wikipedia the same question twice", () => {
    // Two names have no middle one to drop, so the short spelling was the
    // spelling - and `searchAll` opened the identical search in two tabs.
    const { searchTargets } = usePersonSearch(person());
    const wikipedia = searchTargets.value.filter(
      (target) => target.source === "wikipedia",
    );
    expect(wikipedia).toHaveLength(1);
  });

  it("offers both spellings where they differ", () => {
    const { searchTargets } = usePersonSearch(
      person({ name: "Jan Maria Kowalski" }),
    );
    const wikipedia = searchTargets.value.filter(
      (target) => target.source === "wikipedia",
    );
    expect(wikipedia.map((target) => target.label)).toEqual([
      "Wikipedia: Jan Maria Kowalski",
      "Wikipedia: Jan Kowalski",
    ]);
  });

  it("prefers the pages somebody has already found over a search for them", () => {
    const { searchTargets } = usePersonSearch(
      person({
        rejestrIo: "https://rejestr.io/osoby/1",
        wikipedia: "https://pl.wikipedia.org/wiki/Jan_Kowalski",
      }),
    );
    expect(searchTargets.value.map((target) => target.url)).toEqual([
      "https://rejestr.io/osoby/1",
      "https://pl.wikipedia.org/wiki/Jan_Kowalski",
      "https://www.google.com/search?q=Jan%20Kowalski",
      "https://www.google.com/search?q=Jan%20Kowalski%20PKW",
    ]);
  });

  it("opens exactly what it offers", () => {
    // The menu lists `searchTargets` and „otwórz wszystkie" opens them, so the
    // two cannot drift apart the way the button and the drawer once did.
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    const { searchTargets, searchAll } = usePersonSearch(
      person({ workLocations: ["Płock"] }),
    );
    searchAll();
    expect(open.mock.calls.map((call) => call[0])).toEqual(
      searchTargets.value.map((target) => target.url),
    );
  });
});
