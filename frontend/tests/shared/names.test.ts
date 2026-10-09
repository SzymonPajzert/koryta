import { describe, it, expect } from "vitest";
import { addsMiddleNames, normalizePersonName } from "../../shared/names";

describe("normalizePersonName", () => {
  it("ignores case and diacritics", () => {
    // What the article printed vs what the register stored: the same person.
    expect(normalizePersonName("Rafał Trzaskowski")).toBe(
      normalizePersonName("RAFAL TRZASKOWSKI"),
    );
    expect(normalizePersonName("Szymon Hołownia")).toBe("szymon holownia");
    expect(normalizePersonName("Paweł Wnukowski")).toBe("pawel wnukowski");
  });

  it("treats a hyphenated surname as two words", () => {
    expect(normalizePersonName("Anna Kowalska-Nowak")).toBe(
      normalizePersonName("Anna Kowalska Nowak"),
    );
  });

  it("collapses surrounding and repeated whitespace", () => {
    expect(normalizePersonName("  Jan   Kowalski\n")).toBe("jan kowalski");
  });

  it("keeps different people apart", () => {
    expect(normalizePersonName("Piotr Gajda")).not.toBe(
      normalizePersonName("Krzysztof Kozłowski"),
    );
    // A surname on its own is not the same key as the full name, so a fact
    // naming only "Obajtek" is left unmatched rather than attached to a guess.
    expect(normalizePersonName("Obajtek")).not.toBe(
      normalizePersonName("Daniel Obajtek"),
    );
  });

  it("has no key for a name made only of punctuation", () => {
    expect(normalizePersonName("—")).toBe("");
  });
});

describe("addsMiddleNames", () => {
  // `adds_middle_names` in data/pipelines/src/util/polish.py is tested on the
  // same cases: the ingest renames by this one, `--only-changed` predicts the
  // rename by that one, and the two must not disagree.
  it.each([
    // The register's two spellings of one entry, the reason this exists.
    ["Antoni Ignacy Sikoń", "Antoni Sikoń"],
    ["Jan Maria Józef Kowalski", "Jan Kowalski"],
    ["Jan Maria Józef Kowalski", "Jan Maria Kowalski"],
    // What is written in is not checked for being a given name: a double
    // surname written with a space is a fuller spelling of the same woman too.
    ["Anna Nowak Kowalska", "Anna Kowalska"],
    ["Piotr Jan van der Coghen", "Piotr van der Coghen"],
  ])("takes %s as more of %s", (full, short) => {
    expect(addsMiddleNames(full, short)).toBe(true);
  });

  it.each([
    // Anything that changes a word is another spelling, not more of this one.
    ["Anna Maria Nowak", "Anna Kowalska"],
    ["Łukasz Jan Nowak", "Lukasz Nowak"],
    ["Kamil Sebastian Barczyk", "KAMIL BARCZYK"],
    ["Jan Kowalski Nowak", "Jan Kowalski"],
    // A slip of the register's, not a middle name.
    ["Mirosław Dywan Dywan", "Mirosław Dywan"],
    ["Jan Jan Kowalski", "Jan Kowalski"],
    // Nothing added, or nothing to add to.
    ["Jan Kowalski", "Jan Kowalski"],
    ["Jan Kowalski", "Jan Maria Kowalski"],
    ["Jan Maria Kowalski", "Kowalski"],
    ["Jan Maria Kowalski", ""],
  ])("does not take %s as more of %s", (full, short) => {
    expect(addsMiddleNames(full, short)).toBe(false);
  });
});
