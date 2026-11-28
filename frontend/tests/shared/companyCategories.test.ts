import { describe, it, expect } from "vitest";
import {
  companyCategories,
  companyCategoryValues,
  categoryFilterUrl,
  categoryMatchesQuery,
  categoryTitle,
  isKnownCategory,
  isOwner,
  isRegisterFact,
  isSector,
  isStatus,
  withRegisterFactsFrom,
} from "../../shared/companyCategories";
import { companyEditSchema } from "../../shared/api";

/** This module is the site's *vocabulary* of sectors, nothing more.
 *
 * Which company belongs to which sector is decided by the pipelines, in
 * `data/pipelines/src/entities/company_categories.py`, and tested there against
 * real KRS numbers - see `entities/tests/test_company_categories.py`. It used
 * to be decided here by matching PKD prefixes, and the tests that pinned that
 * moved with the logic.
 */
describe("companyCategories", () => {
  it("offers the sectors the filter knows about, in the pipelines' order", () => {
    // The order matches `COMPANY_CATEGORIES` in
    // data/pipelines/src/entities/company_categories.py, which is the order a
    // company's categories are stored in.
    expect(companyCategories.map((c) => c.value)).toEqual([
      "szpitale",
      "przychodnie",
      "wodociagi",
      "cieplownictwo",
      "energetyka",
      "odpady",
      "koleje",
      "komunikacja-miejska",
      "sport",
      "obronnosc",
      "skarb-panstwa",
      "w-likwidacji",
      "w-upadlosci",
    ]);
  });

  it("gives every category a Polish title", () => {
    for (const category of companyCategories) {
      expect(category.title.trim().length).toBeGreaterThan(0);
      expect(category.title).not.toBe(category.value);
    }
  });

  it("has no duplicate values", () => {
    expect(new Set(companyCategoryValues).size).toBe(
      companyCategoryValues.length,
    );
  });

  it("exposes the values as a non-empty tuple, which z.enum needs", () => {
    expect(companyCategoryValues.length).toBeGreaterThan(0);
    expect(companyCategoryValues).toEqual(
      companyCategories.map((c) => c.value),
    );
  });
});

describe("categoryTitle", () => {
  it("names a category the site knows", () => {
    expect(categoryTitle("koleje")).toBe("Koleje");
    expect(categoryTitle("wodociagi")).toBe("Wodociągi i kanalizacja");
  });

  it("falls back to the stored value for one it does not", () => {
    // The pipelines and the site deploy separately, so a node can carry a
    // category this build has never heard of. Showing the raw value beats an
    // empty chip: it is visible that something needs adding here.
    expect(categoryTitle("lotniska")).toBe("lotniska");
  });
});

describe("categoryFilterUrl", () => {
  it("points at the table filtered to that sector", () => {
    expect(categoryFilterUrl("koleje")).toBe(
      "/eksploruj/tabela?category=koleje",
    );
  });

  it("escapes a value that is not URL-safe", () => {
    expect(categoryFilterUrl("a b&c")).toBe(
      "/eksploruj/tabela?category=a%20b%26c",
    );
  });

  it("builds a working url for every category the site offers", () => {
    for (const category of companyCategories) {
      const url = new URL(
        categoryFilterUrl(category.value),
        "https://koryta.pl",
      );
      expect(url.pathname).toBe("/eksploruj/tabela");
      expect(url.searchParams.get("category")).toBe(category.value);
    }
  });
});

describe("categoryMatchesQuery", () => {
  /** The categories `query` names, by title. */
  const named = (query: string) =>
    companyCategories
      .filter((c) => categoryMatchesQuery(c.value, query))
      .map((c) => c.title);

  it("takes the cases a reader writes a category in", () => {
    expect(named("skarbu państwa")).toEqual(["Skarb Państwa"]);
    expect(named("spółki skarbu państwa")).toEqual(["Skarb Państwa"]);
    expect(named("szpitali")).toEqual(["Szpitale"]);
    expect(named("kolejowe")).toEqual(["Koleje"]);
    expect(named("energetyki")).toEqual(["Energetyka"]);
    expect(named("komunikacji miejskiej")).toEqual([
      "Komunikacja miejska i autobusowa",
    ]);
    expect(named("upadłość")).toEqual(["W upadłości"]);
  });

  it("takes them without Polish letters", () => {
    // As typed into the box in November 2026.
    expect(named("spolkach skarbu panstwa")).toEqual(["Skarb Państwa"]);
    expect(named("wodociagi")).toEqual(["Wodociągi i kanalizacja"]);
  });

  it("matches the start of each word, as the box does while it is typed into", () => {
    expect(named("spółki s")).toEqual(["Skarb Państwa"]);
    expect(named("w likw")).toEqual(["W likwidacji"]);
  });

  it("leaves a company's name to the companies", () => {
    // A word the category has no form of takes it off the menu.
    expect(named("szpital górno")).toEqual([]);
    expect(named("energa")).toEqual([]);
    expect(named("skarbek")).toEqual([]);
    expect(named("")).toEqual([]);
  });

  it("is false for a category the site does not know", () => {
    expect(categoryMatchesQuery("tramwaje", "tramwaje")).toBe(false);
  });
});

describe("isKnownCategory", () => {
  it("accepts the offered values and rejects anything else", () => {
    expect(isKnownCategory("szpitale")).toBe(true);
    expect(isKnownCategory("koleje")).toBe(true);
    expect(isKnownCategory("lotniska")).toBe(false);
    expect(isKnownCategory("")).toBe(false);
    expect(isKnownCategory("Koleje")).toBe(false);
  });
});

describe("companyEditSchema.categories", () => {
  it("accepts a proposal naming known categories", () => {
    const parsed = companyEditSchema.safeParse({
      name: "PKP Szybka Kolej Miejska w Trójmieście",
      categories: ["koleje"],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.categories).toEqual(["koleje"]);
  });

  it("accepts an empty selection, which means 'none of these'", () => {
    // Clearing the categories is the only way to correct a company the
    // pipelines filed under the wrong sector, so it has to be proposable.
    const parsed = companyEditSchema.safeParse({
      name: "Instytut Badawczy Dróg i Mostów",
      categories: [],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.categories).toEqual([]);
  });

  it("leaves the field absent when the proposal says nothing about it", () => {
    const parsed = companyEditSchema.safeParse({ name: "Szpital Powiatowy" });
    expect(parsed.success).toBe(true);
    expect(parsed.data && "categories" in parsed.data).toBe(false);
  });

  it("rejects a category no filter could ever reach", () => {
    const parsed = companyEditSchema.safeParse({
      name: "Port Lotniczy Poznań-Ławica",
      categories: ["lotniska"],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Nieznana kategoria");
  });

  it("rejects a typo among otherwise valid categories", () => {
    const parsed = companyEditSchema.safeParse({
      name: "Coś",
      categories: ["koleje", "wodociagii"],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts every value the site offers", () => {
    const parsed = companyEditSchema.safeParse({
      name: "Wszystko naraz",
      categories: [...companyCategoryValues],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("isSector", () => {
  it("is every category but the owner and the statuses", () => {
    // Filed beside a company's sector: counted as one, a post at PGE would
    // be on the home page's „Branże” twice.
    expect(companyCategoryValues.filter((value) => !isSector(value))).toEqual([
      "skarb-panstwa",
      "w-likwidacji",
      "w-upadlosci",
    ]);
    expect(isSector("energetyka")).toBe(true);
    expect(isSector("hutnictwo")).toBe(false);
  });
});

describe("isOwner", () => {
  it("is Skarb Państwa alone, not everything that is not a sector", () => {
    expect(companyCategoryValues.filter(isOwner)).toEqual(["skarb-panstwa"]);
    // A value this build does not know is neither. Read as an owner, a new
    // sector in a payload would land on a company a person had pinned.
    expect(isOwner("hutnictwo")).toBe(false);
  });
});

describe("isStatus", () => {
  it("is liquidation and bankruptcy, apart", () => {
    expect(companyCategoryValues.filter(isStatus)).toEqual([
      "w-likwidacji",
      "w-upadlosci",
    ]);
    expect(isStatus("w-restrukturyzacji")).toBe(false);
  });
});

describe("isRegisterFact", () => {
  it("is the owner and the statuses, and nothing this build does not know", () => {
    expect(companyCategoryValues.filter(isRegisterFact)).toEqual([
      "skarb-panstwa",
      "w-likwidacji",
      "w-upadlosci",
    ]);
    expect(isRegisterFact("hutnictwo")).toBe(false);
  });
});

describe("withRegisterFactsFrom", () => {
  it("keeps the sectors and takes the owner from the other side", () => {
    // PGE, pinned to „Energetyka” by hand: the payload's own sectors do not
    // get past the pin, its owner does.
    expect(
      withRegisterFactsFrom(["energetyka"], ["cieplownictwo", "skarb-panstwa"]),
    ).toEqual(["energetyka", "skarb-panstwa"]);
  });

  it("drops an owner the other side does not name", () => {
    // A stake the list stops naming goes from a page somebody edited too.
    expect(
      withRegisterFactsFrom(["energetyka", "skarb-panstwa"], ["energetyka"]),
    ).toEqual(["energetyka"]);
  });

  it("gives a company filed under no sector its owner", () => {
    // An empty pin says "none of these sectors" and nothing about the owner.
    expect(withRegisterFactsFrom([], ["skarb-panstwa"])).toEqual([
      "skarb-panstwa",
    ]);
  });

  it("files the owner after the sectors, wherever it stood", () => {
    expect(
      withRegisterFactsFrom(["skarb-panstwa", "koleje"], ["skarb-panstwa"]),
    ).toEqual(["koleje", "skarb-panstwa"]);
  });

  it("takes the status from the other side too", () => {
    // A hospital pinned to „Szpitale” by hand still says it is being wound up,
    // and stops saying so when the register does.
    expect(
      withRegisterFactsFrom(["szpitale"], ["przychodnie", "w-likwidacji"]),
    ).toEqual(["szpitale", "w-likwidacji"]);
    expect(
      withRegisterFactsFrom(["szpitale", "w-likwidacji"], ["szpitale"]),
    ).toEqual(["szpitale"]);
  });

  it("keeps a value this build does not know on the sectors' side", () => {
    expect(
      withRegisterFactsFrom(["lotniska"], ["hutnictwo", "skarb-panstwa"]),
    ).toEqual(["lotniska", "skarb-panstwa"]);
  });
});
