import { describe, it, expect } from "vitest";
import {
  anchorToken,
  generateChunksLower,
  nameMatchesTokens,
  nameWords,
  searchTokens,
} from "~~/shared/search";

describe("generateChunksLower", () => {
  it("indexes the whole name, so typing all of it finds the person", () => {
    // What the e2e specs do, and what the seed fixture had silently stopped
    // supporting: it carried suffixes ("owak", "wak") from an older scheme, so
    // `array-contains` against "anna nowak" matched nothing.
    expect(generateChunksLower("Anna Nowak")).toContain("anna nowak");
  });

  it("indexes each word, so a surname alone finds them too", () => {
    const chunks = generateChunksLower("Anna Nowak");
    expect(chunks).toContain("nowak");
    expect(chunks).toContain("anna");
  });

  it("indexes prefixes, which is what makes it a search-as-you-type index", () => {
    const chunks = generateChunksLower("Anna Nowak");
    expect(chunks).toContain("a");
    expect(chunks).toContain("ann");
    expect(chunks).toContain("anna n");
    expect(chunks).toContain("now");
  });

  it("does not index suffixes, which is the shape the fixture had drifted to", () => {
    const chunks = generateChunksLower("Anna Nowak");
    expect(chunks).not.toContain("owak");
    expect(chunks).not.toContain("wak");
  });

  it("folds case, since the query is lowercased before it is matched", () => {
    expect(generateChunksLower("Krzysztof Wójcik")).toContain(
      "krzysztof wójcik",
    );
    expect(generateChunksLower("ORLEN")).toContain("orlen");
  });

  it("flattens the whitespace the register puts in a name", () => {
    // One person arrived behind a stray tab and a handful of companies carry
    // their full style across two lines. Split on the literal space, the word
    // after the break kept the break on its front and nothing anybody could
    // type ever reached it.
    const chunks = generateChunksLower("   \t Grzegorz Franciszek Franczak");
    expect(chunks).toContain("grzegorz");
    expect(chunks).toContain("grzegorz franciszek franczak");

    expect(
      generateChunksLower("PEC SPÓŁKA Z OGRANICZONĄ \nODPOWIEDZIALNOŚCIĄ"),
    ).toContain("odpowiedzialnością");
  });

  it("handles a single word without repeating itself", () => {
    const chunks = generateChunksLower("Orlen");
    expect(chunks).toContain("orlen");
    expect(new Set(chunks).size).toBe(chunks.length);
  });

  it("indexes each part of a double surname, and the whole of it", () => {
    // The person ingest renames "Bogusława Kupczak Wiśniowska" to the hyphen
    // PKW gives, and "wiśniowska" has to go on finding her.
    const chunks = generateChunksLower("Bogusława Kupczak-Wiśniowska");
    expect(chunks).toContain("kupczak");
    expect(chunks).toContain("wiśniowska");
    expect(chunks).toContain("wiś");
    expect(chunks).toContain("kupczak-wiśniowska");
    expect(chunks).toContain("bogusława kupczak-wiśniowska");
    expect(new Set(chunks).size).toBe(chunks.length);
  });

  it("cuts a hyphenated name of one word too", () => {
    const chunks = generateChunksLower("Bielsko-Biała");
    expect(chunks).toContain("biała");
    expect(chunks).toContain("bielsko-biała");
  });

  it("indexes every part of a word with several hyphens, and no empty ones", () => {
    const chunks = generateChunksLower("Jan Nowak-Kowalski-Rudnik");
    expect(chunks).toContain("kowalski");
    expect(chunks).toContain("rudnik");
    expect(chunks).not.toContain("kowalski-rudnik");

    // A hyphen standing for a dash, between two spaces, adds nothing: every
    // chunk is a prefix of the name or of one of its words, as before.
    const dashed = "ewa kukulska - zając";
    const words = dashed.split(" ");
    expect(
      generateChunksLower("Ewa Kukulska - Zając").every(
        (chunk) =>
          dashed.startsWith(chunk) ||
          words.some((word) => word.startsWith(chunk)),
      ),
    ).toBe(true);
  });

  it("gives a name without a hyphen exactly the index it had, in order", () => {
    // What a stored index is compared against: reordered, every one of the
    // 18,000 would read as out of date and be rewritten for nothing.
    expect(generateChunksLower("Jan Nowak")).toEqual([
      "",
      "j",
      "ja",
      "jan",
      "jan ",
      "jan n",
      "jan no",
      "jan now",
      "jan nowa",
      "jan nowak",
      "n",
      "no",
      "now",
      "nowa",
      "nowak",
    ]);
  });

  it("puts the parts after everything it carried before", () => {
    expect(generateChunksLower("Anna Nowak-Rudnik").slice(-6)).toEqual([
      "r",
      "ru",
      "rud",
      "rudn",
      "rudni",
      "rudnik",
    ]);
  });
});

describe("searchTokens", () => {
  it("splits on whitespace and folds case", () => {
    expect(searchTokens("Andrzej Namysło")).toEqual(["andrzej", "namysło"]);
  });

  it("drops the padding a typed query collects", () => {
    // A trailing space used to be searched for literally: "nowak " is not a
    // chunk of "Anna Nowak", so pressing space after a surname emptied the menu.
    expect(searchTokens("  anna   nowak ")).toEqual(["anna", "nowak"]);
  });

  it("gives an empty query no tokens, which every name answers", () => {
    expect(searchTokens("   ")).toEqual([]);
    expect(nameMatchesTokens("Anna Nowak", [])).toBe(true);
  });
});

describe("anchorToken", () => {
  it("picks the longest word, the only proxy for the rarest", () => {
    expect(anchorToken(["andrzej", "namysło"])).toBe("namysło");
  });

  it("stays on the finished word while the next one is being typed", () => {
    expect(anchorToken(["andrzej", "n"])).toBe("andrzej");
  });

  it("breaks a tie towards the surname", () => {
    // "Piotr" is on four hundred people, "Pięta" on a handful.
    expect(anchorToken(["piotr", "pięta"])).toBe("pięta");
  });
});

describe("nameMatchesTokens", () => {
  it("finds a person by first and last name past their middle one", () => {
    // The whole point: two of every five people carry a middle name, and no
    // chunk of theirs spans it, so the index alone can never answer this.
    expect(
      nameMatchesTokens("Andrzej Józef Namysło", ["andrzej", "namysło"]),
    ).toBe(true);
  });

  it("still matches while the second word is being typed", () => {
    expect(nameMatchesTokens("Andrzej Józef Namysło", ["andrzej", "n"])).toBe(
      true,
    );
  });

  it("does not care what order the words were typed in", () => {
    expect(
      nameMatchesTokens("Andrzej Józef Namysło", ["namysło", "andrzej"]),
    ).toBe(true);
  });

  it("matches words by prefix, not by any substring", () => {
    expect(nameMatchesTokens("Anna Nowak", ["now"])).toBe(true);
    expect(nameMatchesTokens("Anna Nowak", ["owak"])).toBe(false);
  });

  it("needs a different word for each typed word", () => {
    expect(nameMatchesTokens("Jan Kowalski", ["jan", "jan"])).toBe(false);
    expect(nameMatchesTokens("Jan Kowalski", ["jan", "nowak"])).toBe(false);
  });

  it("takes back a word it took too early", () => {
    // Greedy in typed order would spend "Janusz" on "j" and then have nothing
    // left for "janusz"; longest first, plus the retry behind it, does not.
    expect(nameMatchesTokens("Janusz Jan", ["j", "janusz"])).toBe(true);
  });

  it("cannot match more words than the name has", () => {
    expect(nameMatchesTokens("Anna Nowak", ["anna", "maria", "nowak"])).toBe(
      false,
    );
  });

  it("matches an institution the same way", () => {
    expect(
      nameMatchesTokens("Zakład Gospodarki Komunalnej i Mieszkaniowej", [
        "zakład",
        "mieszkaniowej",
      ]),
    ).toBe(true);
  });

  it.each([
    ["wiśniowska"],
    ["kupczak wiśniowska"],
    ["kupczak-wiśniowska"],
    ["bogusława wiśniowska"],
    ["wiśniowska kupczak"],
    ["kupczak-wiś"],
    ["kupczak-"],
  ])("finds a double surname by %s, hyphen or space", (typed) => {
    // Whichever way the page is titled: the ingest renames the register's
    // space to the hyphen PKW gives, and 331 of the 430 pages titled with the
    // space on 2026-10-11 have no hyphen to be given.
    for (const name of [
      "Bogusława Kupczak-Wiśniowska",
      "Bogusława Kupczak Wiśniowska",
    ]) {
      expect(nameMatchesTokens(name, searchTokens(typed))).toBe(true);
    }
  });

  it("matches a company by a word inside a hyphenated one", () => {
    expect(
      nameMatchesTokens("Przedsiębiorstwo Wodno-Kanalizacyjne Sp. z o.o.", [
        "kanalizacyjne",
      ]),
    ).toBe(true);
  });

  it("still needs a different word for each typed word past a hyphen", () => {
    expect(nameMatchesTokens("Anna Nowak-Rudnik", ["rudnik", "rudnik"])).toBe(
      false,
    );
    expect(nameMatchesTokens("Anna Nowak-Rudnik", ["nowak-rudnicka"])).toBe(
      false,
    );
    expect(
      nameMatchesTokens("Anna Nowak-Rudnik", ["anna", "maria", "rudnik"]),
    ).toBe(false);
  });

  it("does not take a lone hyphen for a word on either side", () => {
    expect(nameMatchesTokens("Ewa Kukulska - Zając", ["kukulska-zając"])).toBe(
      true,
    );
    expect(nameMatchesTokens("Ewa Kukulska - Zając", ["ewa", "-"])).toBe(true);
  });
});

describe("nameWords", () => {
  it("cuts at hyphens as well as at whitespace, and folds case", () => {
    expect(nameWords("Bogusława  Kupczak-Wiśniowska")).toEqual([
      "bogusława",
      "kupczak",
      "wiśniowska",
    ]);
  });

  it("keeps no empty word where a hyphen stands alone or at an end", () => {
    expect(nameWords("Ewa Kukulska - Zając")).toEqual([
      "ewa",
      "kukulska",
      "zając",
    ]);
    expect(nameWords("nowak-")).toEqual(["nowak"]);
    expect(nameWords(" - ")).toEqual([]);
  });
});
