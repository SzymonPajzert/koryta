import { describe, it, expect } from "vitest";
import {
  anchorChunk,
  anchorToken,
  generateChunksLower,
  indexedWords,
  krsNumberQuery,
  nextAnchorChunk,
  reachesBeyondTown,
  nameChunksToWrite,
  nameMatchesTokens,
  nameWords,
  searchableText,
  searchTokens,
  townChunk,
} from "~~/shared/search";

describe("searchableText", () => {
  it("cuts the punctuation a register name is written with as a space does", () => {
    expect(searchableText('STADNINA KONI "KRASNE"')).toBe(
      "stadnina koni krasne",
    );
    expect(searchableText('HUTA"KOŚCIUSZKO" W UPADŁOŚCI')).toBe(
      "huta kościuszko w upadłości",
    );
    expect(searchableText("SZPITAL IM.PROF.STANISŁAWA SZYSZKO")).toBe(
      "szpital im prof stanisława szyszko",
    );
    expect(searchableText("INSTYTUT GERIATRII,REUMATOLOGII")).toBe(
      "instytut geriatrii reumatologii",
    );
    expect(searchableText("...DOMARO (Wodzisław Śląski)")).toBe(
      "domaro wodzisław śląski",
    );
    expect(searchableText("ERNST & YOUNG „POLSKA”")).toBe("ernst young polska");
  });

  it("keeps the hyphen, which the index cuts on its own terms", () => {
    expect(searchableText("Władysław Kosiniak-Kamysz")).toBe(
      "władysław kosiniak-kamysz",
    );
    expect(searchableText("Ewa Kukulska - Zając")).toBe("ewa kukulska - zając");
  });

  it("composes a letter stored with its accent as a separate mark", () => {
    // How one hospital in Świecie is stored: "S" followed by U+0301.
    expect(searchableText("W ŚWIECIU")).toBe("w świeciu");
  });

  it("leaves a name without any of it as trimming, flattening and lowercasing did", () => {
    // Which keeps every such name's stored index from reading as out of date.
    for (const name of [
      "Anna Nowak",
      "   \t Grzegorz Franciszek Franczak",
      "PEC SPÓŁKA Z OGRANICZONĄ \nODPOWIEDZIALNOŚCIĄ",
      "Bielsko-Biała",
    ]) {
      expect(searchableText(name)).toBe(
        name.trim().replace(/\s+/g, " ").toLowerCase(),
      );
    }
  });
});

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

  it("indexes the word in quotes by itself", () => {
    // Searched for as „krasne” on 2026-10-28, and found only typed in quotes.
    const chunks = generateChunksLower('STADNINA KONI "KRASNE"');
    expect(chunks).toContain("krasne");
    expect(chunks).toContain("kras");
    expect(chunks).toContain("stadnina koni krasne");
    expect(chunks.some((chunk) => chunk.includes('"'))).toBe(false);
  });

  it("cuts a word at a quote glued to it", () => {
    const chunks = generateChunksLower(
      'HUTA"KOŚCIUSZKO" W UPADŁOŚCI LIKWIDACYJNEJ (Chorzów)',
    );
    expect(chunks).toContain("huta");
    expect(chunks).toContain("kościuszko");
  });

  it("gives words glued by full stops and commas a chunk each", () => {
    const chunks = generateChunksLower(
      "SZPITAL KLINICZNY IM.PROF.STANISŁAWA SZYSZKO",
    );
    expect(chunks).toContain("prof");
    expect(chunks).toContain("stanisława");
    expect(
      generateChunksLower("INSTYTUT GERIATRII,REUMATOLOGII I REHABILITACJI"),
    ).toContain("reumatologii");
  });

  it("puts a company's town into the whole name, and into marked chunks of its own", () => {
    // The town of the company's seat: typed after the name it tells apart
    // one of 34 alike, but a reader typing the town alone wants the town, not
    // every company based there.
    const chunks = generateChunksLower(
      "PRZEDSIĘBIORSTWO WODOCIĄGÓW I KANALIZACJI (Myślibórz)",
      "place",
    );
    expect(chunks).toContain(
      "przedsiębiorstwo wodociągów i kanalizacji myślibórz",
    );
    expect(chunks).toContain("wodociągów");
    expect(chunks).not.toContain("myślibórz");
    expect(chunks).not.toContain("myśl");
    expect(chunks).toContain(townChunk("myślibórz"));
    expect(chunks).toContain(townChunk("myśl"));
    expect(chunks.some((chunk) => /[()]/.test(chunk))).toBe(false);
  });

  it("marks each part of a hyphenated town, and each word of a town of two", () => {
    const hyphenated = generateChunksLower(
      'ZAKŁAD REMONTOWY "REKOM" (Kędzierzyn-Koźle)',
      "place",
    );
    expect(hyphenated).toContain(townChunk("kędzierzyn"));
    expect(hyphenated).toContain(townChunk("koźle"));
    expect(hyphenated).not.toContain("koźle");
    const twoWords = generateChunksLower("WIND T1 (Jelenia Góra)", "place");
    expect(twoWords).toContain(townChunk("jelenia"));
    expect(twoWords).toContain(townChunk("góra"));
  });

  it("gives a region's seat the same treatment as a company's town", () => {
    const chunks = generateChunksLower("Powiat świdnicki (Świdnica)", "region");
    expect(chunks).toContain("świdnicki");
    expect(chunks).toContain(townChunk("świdnica"));
    expect(chunks).not.toContain("świdnica");
  });

  it("keeps a person's bracket as words of the name", () => {
    // A pseudonym is what somebody is called, not where they are.
    const chunks = generateChunksLower(
      "Bartosz Kopania (Pablo Morales)",
      "person",
    );
    expect(chunks).toContain("morales");
    expect(chunks).toContain("pablo");
    expect(chunks.some((chunk) => chunk.startsWith(townChunk("")))).toBe(false);
  });

  it("keeps a register bracket in capitals as words of the name", () => {
    // Not a town: what the place is called, short.
    expect(
      generateChunksLower(
        "Ośrodek Pomocy Społecznej w Legionowie (OPS)",
        "place",
      ),
    ).toContain("ops");
    expect(
      generateChunksLower(
        "GDAŃSKA INFRASTRUKTURA (W SKRÓCIE: GIWK SP. Z O.O.)",
        "place",
      ),
    ).toContain("giwk");
  });

  it("indexes the words of a bracket inside the name like any other", () => {
    const chunks = generateChunksLower(
      "Zarząd Transportu Miejskiego (ZTM) w Warszawie",
      "place",
    );
    expect(chunks).toContain("ztm");
    expect(chunks).toContain("warszawie");
  });

  it("takes the last bracket for the town, when a name has two", () => {
    const chunks = generateChunksLower(
      "STOWARZYSZENIE NA RZECZ BUDOWY DRÓG EKSPRESOWYCH S-8 (PRZEZ SIERADZ-ŁÓDŹ) I S-14 (Łask)",
      "place",
    );
    expect(chunks).toContain("sieradz");
    expect(chunks).toContain("łódź");
    expect(chunks).not.toContain("łask");
    expect(chunks).toContain(townChunk("łask"));
    // A bracket with small letters in it before the end is a word of the name.
    const hospital = generateChunksLower(
      "SZPITAL (dawniej Miejski) W KŁODZKU (Kłodzko)",
      "place",
    );
    expect(hospital).toContain("dawniej");
    expect(hospital).toContain("kłodzku");
    expect(hospital).toContain(townChunk("kłodzko"));
    expect(hospital).not.toContain(townChunk("dawniej"));
  });

  it("knows no town without the node's type", () => {
    expect(generateChunksLower("WARS (Warszawa)")).toContain("warszawa");
  });
});

describe("nameChunksToWrite", () => {
  it("has nothing to write over the index the name already has", () => {
    // Which is what ends the trigger's own write: it fires again on it.
    const name = "Bogusława Kupczak-Wiśniowska";
    expect(nameChunksToWrite(name, generateChunksLower(name))).toBeUndefined();
  });

  it("rewrites an index cut the old way, though the name has not changed", () => {
    // What every hyphenated name stored before carries: no chunk past its
    // first hyphen. "ka" to "kamysz" are the five appended for it - "k" was
    // there already, off "kosiniak-kamysz".
    const name = "Władysław Kosiniak-Kamysz";
    const old = generateChunksLower(name).slice(0, -5);
    expect(old).toContain("k");
    expect(old).not.toContain("ka");
    expect(nameChunksToWrite(name, old)).toContain("kamysz");
  });

  it("rewrites a missing index, and one stored as anything but the array", () => {
    expect(nameChunksToWrite("Anna Nowak", undefined)).toContain("nowak");
    expect(nameChunksToWrite("Anna Nowak", { 0: "anna" })).toContain("nowak");
  });

  it("rewrites the same chunks in another order", () => {
    // Exact rather than as a set: one write for a page some other writer
    // ordered differently, against a check as cheap as a string compare.
    const chunks = generateChunksLower("Anna Nowak");
    expect(nameChunksToWrite("Anna Nowak", [...chunks].reverse())).toEqual(
      chunks,
    );
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

  it("drops quotes and brackets typed around a word, as the index drops them", () => {
    expect(searchTokens('stadnina koni "krasne"')).toEqual([
      "stadnina",
      "koni",
      "krasne",
    ]);
    expect(searchTokens('"widawa')).toEqual(["widawa"]);
    expect(searchTokens('" ( )')).toEqual([]);
  });

  it("keeps a typed hyphen inside its word", () => {
    expect(searchTokens("Kupczak-Wiśniowska")).toEqual(["kupczak-wiśniowska"]);
  });
});

describe("krsNumberQuery", () => {
  it.each([
    ["0000029741"],
    [" 0000029741 "],
    ["0000 029 741"],
    ["KRS 0000029741"],
    ["krs: 0000029741"],
    ["krs0000029741"],
  ])("reads %s as KRS 0000029741", (typed) => {
    expect(krsNumberQuery(typed)).toBe("0000029741");
  });

  it.each([
    // On its way to "0000029741": KRS 297 is another company altogether.
    ["00000297"],
    ["29741"],
    ["000002974100"],
    ["0000029741x"],
    ["sanikom 0000029741"],
    ["krs"],
    [""],
  ])("reads %s as no KRS number", (typed) => {
    expect(krsNumberQuery(typed)).toBeUndefined();
  });
});

describe("indexedWords", () => {
  it("leaves out a company's town, and nothing else", () => {
    expect(
      indexedWords(
        'PRZEDSIĘBIORSTWO GOSPODARKI KOMUNALNEJ "SANIKOM" (Lubawka)',
        "place",
      ),
    ).toEqual(["przedsiębiorstwo", "gospodarki", "komunalnej", "sanikom"]);
    expect(
      indexedWords("Zarząd Transportu Miejskiego (ZTM) w Warszawie", "place"),
    ).toContain("ztm");
  });

  it("cuts a surname at an apostrophe, as the index does", () => {
    expect(indexedWords("Kajetan Ludwik D'obyrn", "person").at(-1)).toBe(
      "obyrn",
    );
  });

  it("keeps a person's bracket", () => {
    expect(
      indexedWords("Bartosz Kopania (Pablo Morales)", "person").at(-1),
    ).toBe("morales");
  });

  it("is a word of the index each, prefixes included", () => {
    const name = 'AMW TOWARZYSTWO BUDOWNICTWA SPOŁECZNEGO "KWATERA" (Warszawa)';
    const chunks = generateChunksLower(name, "place");
    for (const word of indexedWords(name, "place")) {
      expect(chunks).toContain(word);
    }
  });
});

describe("nextAnchorChunk", () => {
  it("asks for the longest other word once the anchor's pass is full", () => {
    // „warszawa” is the anchor, and Warsaw holds more than one pass reads.
    expect(anchorChunk(["paged", "warszawa"])).toBe("warszawa");
    expect(nextAnchorChunk(["paged", "warszawa"])).toBe("paged");
    expect(nextAnchorChunk(["przedsiębiorstwo", "darłowo"])).toBe("darłowo");
  });

  it("asks nothing for a word of one or two letters, typed on the way", () => {
    expect(nextAnchorChunk(["piotr", "w"])).toBeUndefined();
    expect(nextAnchorChunk(["piotr", "wa"])).toBeUndefined();
    expect(nextAnchorChunk(["piotr", "wyb"])).toBe("wyb");
  });

  it("asks nothing where no other word was typed", () => {
    expect(nextAnchorChunk(["warszawa"])).toBeUndefined();
    expect(nextAnchorChunk(["jan", "jan"])).toBeUndefined();
  });
});

describe("reachesBeyondTown", () => {
  it("keeps a company a word of its name was typed for", () => {
    expect(
      reachesBeyondTown("ORLEN PROJEKT (Płock)", "place", ["orlen", "płock"]),
    ).toBe(true);
    expect(
      reachesBeyondTown(
        'PRZEDSIĘBIORSTWO GOSPODARKI KOMUNALNEJ "SANIKOM" (Lubawka)',
        "place",
        ["lubawka", "s"],
      ),
    ).toBe(true);
  });

  it("drops a company only its town was typed for, two words of it or one hyphen", () => {
    expect(
      reachesBeyondTown("TAURON EKOENERGIA (Jelenia Góra)", "place", [
        "jelenia",
        "góra",
      ]),
    ).toBe(false);
    expect(
      reachesBeyondTown(
        "SEVEN SYSTEM (Bielsko-Biała)",
        "place",
        searchTokens("bielsko-biała"),
      ),
    ).toBe(false);
  });
});

describe("townChunk", () => {
  it("marks a chunk so that nothing typed can ask for it", () => {
    // `searchableText` leaves a query letters, digits and hyphens only.
    const marked = townChunk("lubawka");
    expect(marked).not.toBe("lubawka");
    expect(searchTokens(marked)).toEqual(["lubawka"]);
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

describe("anchorChunk", () => {
  it("anchors as anchorToken does where nothing is hyphenated", () => {
    expect(anchorChunk(["andrzej", "namysło"])).toBe("namysło");
    expect(anchorChunk(["piotr", "pięta"])).toBe("pięta");
  });

  it("picks the word as typed, then the longest of its parts", () => {
    // Not "przedsiębiorstwo", the longest part of any word: 697 companies
    // carry it, past the 500 the second pass reads.
    expect(anchorChunk(["przedsiębiorstwo", "usługowo-produkcyjne"])).toBe(
      "produkcyjne",
    );
    expect(anchorChunk(["małgorzata", "kidawa-błońska"])).toBe("błońska");
  });

  it("cuts a single hyphenated word, which a page titled with a space carries in parts", () => {
    expect(anchorChunk(["kupczak-wiśniowska"])).toBe("wiśniowska");
  });

  it("does not anchor on a hyphen standing alone", () => {
    expect(anchorChunk(["kukulska", "-------------", "zając"])).toBe(
      "kukulska",
    );
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

  it("finds a company by the word in its quotes", () => {
    expect(nameMatchesTokens('STADNINA KONI "KRASNE"', ["krasne"])).toBe(true);
    expect(
      nameMatchesTokens(
        'HUTA"KOŚCIUSZKO" W UPADŁOŚCI LIKWIDACYJNEJ (Chorzów)',
        searchTokens("huta kościuszko"),
      ),
    ).toBe(true);
  });

  it("matches the town in the bracket beside another word, as the town pass needs", () => {
    expect(
      nameMatchesTokens(
        "PRZEDSIĘBIORSTWO WODOCIĄGÓW I KANALIZACJI (Myślibórz)",
        searchTokens("wodociągów myślibórz"),
      ),
    ).toBe(true);
    expect(
      nameMatchesTokens(
        'PRZEDSIĘBIORSTWO GOSPODARKI KOMUNALNEJ "SANIKOM" (Lubawka)',
        searchTokens("sanikom lubawka"),
      ),
    ).toBe(true);
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

  it("cuts at quotes and brackets too, and keeps the bracket's words", () => {
    expect(nameWords('PGK "SANIKOM" (Lubawka)')).toEqual([
      "pgk",
      "sanikom",
      "lubawka",
    ]);
  });
});
