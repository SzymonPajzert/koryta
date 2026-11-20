import { describe, it, expect } from "vitest";
import {
  cropsLine,
  cropState,
  searchState,
  shortLink,
} from "~/utils/personDeclarationCrops";
import {
  cropOrder,
  type PersonDeclarationCrop,
  type PersonDeclarationCrops,
  type PersonDeclarationSearch,
} from "~~/shared/declarations";

/** A crop of Kowalska's declaration, still waiting for readers unless told
 * otherwise. */
function crop(
  fields: Partial<PersonDeclarationCrop> = {},
): PersonDeclarationCrop {
  return {
    id: "abc-p0",
    status: "open",
    failure: null,
    unit: "Strzelin (gmina miejsko-wiejska)",
    office: "Rada gminy",
    documentUrl: "https://bip.strzelin.pl/download/1",
    answers: 0,
    agreed: null,
    agreedBy: null,
    outcome: null,
    imageSize: {
      date: { width: 950, height: 105 },
      name: { width: 1160, height: 94 },
    },
    ...fields,
  };
}

const matched = crop({
  id: "matched-p0",
  status: "agreed",
  agreed: "1979-07-15",
  agreedBy: "readers",
  answers: 2,
  outcome: "queued",
});
const other = crop({
  id: "other-p0",
  status: "agreed",
  agreed: "1978-02-01",
  agreedBy: "readers",
  answers: 2,
  outcome: "different",
});

/** The endpoint's answer: the crops in its order, no record unless given. */
function answer(
  crops: PersonDeclarationCrop[],
  publication: PersonDeclarationCrops["publication"] = null,
  searches: PersonDeclarationSearch[] = [],
  links: PersonDeclarationCrops["links"] = [],
): PersonDeclarationCrops {
  return {
    publication,
    crops: [...crops].sort((a, b) => cropOrder(a) - cropOrder(b)),
    searches,
    links,
  };
}

/** A council seat won in 2018, which the crawler found nothing for. */
function search(
  fields: Partial<PersonDeclarationSearch> = {},
): PersonDeclarationSearch {
  return {
    year: 2018,
    office: "Rada gminy",
    unit: "Strzelin (gmina miejsko-wiejska)",
    status: "not_found",
    reason: "not_listed",
    files: 0,
    bipUrl: "https://bip.strzelin.pl/",
    ...fields,
  };
}

const failed = crop({
  id: "failed-p0",
  status: "failed",
  failure: "no_label",
  imageSize: null,
});

describe("cropOrder", () => {
  it("puts a match first, then another day, then a dispute, then what waits", () => {
    const order = [
      failed,
      crop({ id: "unreadable-p0", status: "unreadable" }),
      crop({ id: "open-p0" }),
      crop({ id: "disputed-p0", status: "disputed", answers: 6 }),
      crop({ id: "year-p0", status: "agreed", agreed: "1979" }),
      other,
      matched,
    ]
      .sort((a, b) => cropOrder(a) - cropOrder(b))
      .map((c) => c.id);
    expect(order).toEqual([
      "matched-p0",
      "other-p0",
      "disputed-p0",
      "open-p0",
      "year-p0",
      "unreadable-p0",
      "failed-p0",
    ]);
  });

  it("takes a crop matched on a page public already, or held, as a match", () => {
    expect(cropOrder({ ...matched, outcome: "confirmed" })).toBe(0);
    expect(cropOrder({ ...matched, outcome: "held" })).toBe(0);
    expect(cropOrder({ ...matched, outcome: "no_date" })).toBe(4);
  });
});

describe("cropsLine", () => {
  it("says nothing for a page with no crop and no election won", () => {
    expect(cropsLine(answer([]))).toBeNull();
  });

  it("says there is no declaration, with the elections won and their searches", () => {
    const searches = [search({ year: 2024 }), search({ status: null })];
    const links = [
      {
        url: "https://bip.strzelin.pl/a.pdf",
        at: "2026-11-20T09:00:00Z",
        mine: true,
      },
    ];
    expect(cropsLine(answer([], null, searches, links))).toEqual({
      kind: "missing",
      text: "Nie mamy oświadczenia majątkowego.",
      note: null,
      lead: null,
      rest: [],
      searches,
      links,
    });
    // A link given before the page's wins were taken off it still shows.
    expect(cropsLine(answer([], null, [], links))?.kind).toBe("missing");
  });

  it("leads with a declaration nothing was cut from only when there is nothing else", () => {
    expect(cropsLine(answer([failed]))).toMatchObject({
      kind: "failed",
      text: "Z oświadczenia majątkowego nie udało się wyciąć daty urodzenia.",
      lead: failed,
    });
    const line = cropsLine(answer([failed, crop({ id: "open-p0" })]));
    expect(line?.kind).toBe("open");
    expect(line?.rest).toEqual([failed]);
  });

  it("counts the declarations still waiting for readers", () => {
    expect(cropsLine(answer([crop()]))).toMatchObject({
      kind: "open",
      text: "Oświadczenie majątkowe czeka na czytelników.",
      note: null,
      rest: [],
    });
    const three = cropsLine(
      answer([
        crop({ id: "a-p0" }),
        crop({ id: "b-p0", answers: 1 }),
        crop({ id: "c-p0" }),
      ]),
    );
    expect(three?.text).toBe(
      "3 oświadczenia majątkowe czekają na czytelników.",
    );
    expect(three?.rest).toHaveLength(2);
    const five = cropsLine(
      answer(Array.from({ length: 5 }, (_, i) => crop({ id: `${i}-p0` }))),
    );
    expect(five?.text).toBe("5 oświadczeń majątkowych czeka na czytelników.");
  });

  it("leads with a reading that contradicts the page over those still to come", () => {
    const line = cropsLine(answer([crop({ id: "open-p0" }), other]));
    expect(line).toMatchObject({
      kind: "different",
      text: "Oświadczenie majątkowe podaje inną datę urodzenia niż strona.",
    });
    expect(line?.lead.id).toBe("other-p0");
    expect(line?.rest.map((c) => c.id)).toEqual(["open-p0"]);
  });

  it("says what the record says over what any crop does", () => {
    expect(
      cropsLine(
        answer([crop({ id: "open-p0" }), matched], {
          status: "queued",
          reason: null,
          paidPost: false,
        }),
      ),
    ).toMatchObject({
      kind: "queued",
      text: "Data zgadza się z oświadczeniem majątkowym: strona czeka w kolejce do publikacji.",
      lead: matched,
    });
  });

  it("says what holds the page, and what an admin can do about it", () => {
    expect(
      cropsLine(
        answer([matched], {
          status: "held",
          reason: "two_places",
          paidPost: true,
        }),
      ),
    ).toMatchObject({
      kind: "held",
      text: "Automatyczna publikacja wstrzymana: kandydatura w dwóch miejscach naraz.",
      note: "Kandydatury wypadają w dwóch miejscach naraz. Przy publikacji ręcznej zaznacz tylko właściwą.",
    });
  });

  it("reads a page held for no paid post that has one now as the admin page does", () => {
    expect(
      cropsLine(
        answer([matched], {
          status: "held",
          reason: "no_public_post",
          paidPost: true,
        }),
      ),
    ).toMatchObject({
      kind: "held",
      text: "Automatyczna publikacja wstrzymana: jest już płatne stanowisko.",
      note: "Na stronie jest już płatne stanowisko. Opublikuj ręcznie i zaznacz je.",
    });
  });

  it("names a declined page and what it was held for", () => {
    expect(
      cropsLine(
        answer([matched], {
          status: "declined",
          reason: "two_places",
          paidPost: false,
        }),
      ),
    ).toMatchObject({
      kind: "declined",
      text: "Automatyczna publikacja odłożona przez administratora.",
      note: "Była wstrzymana: kandydatura w dwóch miejscach naraz.",
    });
  });

  it("tells a match with no record, a dispute, a reading with no date to meet, and the unreadable apart", () => {
    expect(cropsLine(answer([matched]))?.kind).toBe("matched");
    expect(
      cropsLine(answer([crop({ status: "disputed", answers: 6 })]))?.text,
    ).toBe(
      "Sporny odczyt oświadczenia majątkowego: czytelnicy podali różne daty.",
    );
    expect(cropsLine(answer([{ ...matched, outcome: "no_date" }]))?.text).toBe(
      "Oświadczenie majątkowe podaje datę urodzenia, której strona nie ma.",
    );
    expect(cropsLine(answer([{ ...matched, outcome: null }]))?.kind).toBe(
      "read",
    );
    expect(cropsLine(answer([crop({ status: "unreadable" })]))?.text).toBe(
      "Nikt nie odczytał daty z oświadczenia majątkowego.",
    );
  });
});

describe("cropState", () => {
  it("says how far a crop waiting for readers got", () => {
    expect(cropState(crop())).toBe("czeka na czytelników");
    expect(cropState(crop({ answers: 1 }))).toBe(
      "czeka na czytelników, 1 odpowiedź",
    );
    expect(cropState(crop({ answers: 3 }))).toBe(
      "czeka na czytelników, 3 odpowiedzi",
    );
  });

  it("names a dispute and the unreadable, and leaves a settled date to the comparison", () => {
    expect(cropState(crop({ status: "disputed" }))).toBe("sporne");
    expect(cropState(crop({ status: "unreadable" }))).toBe("nieczytelne");
    expect(cropState(matched)).toBeNull();
  });

  it("says why nothing was cut, in the admin page's words", () => {
    expect(cropState(failed)).toBe("bez wycinka: nie znaleziono pola daty");
    expect(cropState({ ...failed, failure: null })).toBe("bez wycinka");
    // A code nobody has named yet is shown as the code.
    expect(cropState({ ...failed, failure: "new_code" })).toBe(
      "bez wycinka: new_code",
    );
  });
});

describe("searchState", () => {
  it("says why the crawler found nothing", () => {
    expect(searchState(search())).toBe(
      "nie znaleziono: brak tej osoby na liście",
    );
    expect(searchState(search({ reason: "unreachable" }))).toBe(
      "nie znaleziono: BIP nie odpowiada",
    );
    expect(searchState(search({ reason: "throttled" }))).toBe(
      "nie znaleziono: BIP ogranicza zapytania",
    );
    expect(searchState(search({ reason: null }))).toBe("nie znaleziono");
    // A reason that says it already is not said twice.
    expect(searchState(search({ reason: "no_declarations" }))).toBe(
      "nie znaleziono działu z oświadczeniami",
    );
  });

  it("counts the files that came down, with the name on them or not", () => {
    expect(searchState(search({ status: "unconfirmed", files: 3 }))).toBe(
      "3 pliki bez nazwiska",
    );
    expect(searchState(search({ status: "found", files: 1 }))).toBe(
      "pobrano 1 plik, bez wycinka",
    );
    expect(searchState(search({ status: "found", files: 5 }))).toBe(
      "pobrano 5 plików, bez wycinka",
    );
  });

  it("says when the crawler never looked", () => {
    expect(searchState(search({ status: null, reason: null }))).toBe(
      "jeszcze nie szukaliśmy",
    );
    expect(searchState(search({ status: "pending", reason: null }))).toBe(
      "jeszcze nie szukaliśmy",
    );
  });
});

describe("shortLink", () => {
  it("keeps a short link whole, without a bare slash", () => {
    expect(shortLink("https://bip.strzelin.pl/")).toBe("bip.strzelin.pl");
    expect(shortLink("https://bip.strzelin.pl/rada/oswiadczenia")).toBe(
      "bip.strzelin.pl/rada/oswiadczenia",
    );
  });

  it("keeps the file name at the end of a long path", () => {
    expect(
      shortLink(
        "https://bip.strzelin.pl/fileadmin/BIP/Samorzad_Gminy/Oswiadczenia_majatkowe/2025/16_06_2025/kowalska.pdf",
      ),
    ).toBe("bip.strzelin.pl/…/2025/16_06_2025/kowalska.pdf");
    // A file name longer than that is kept whole.
    expect(
      shortLink(
        `https://bip.strzelin.pl/a/b/c/d/e/f/g/h/${"oswiadczenie-majatkowe-".repeat(3)}.pdf`,
      ),
    ).toBe(`bip.strzelin.pl/…/${"oswiadczenie-majatkowe-".repeat(3)}.pdf`);
  });
});
