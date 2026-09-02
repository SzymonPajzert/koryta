import { describe, it, expect } from "vitest";
import {
  educationIndex,
  educationKey,
  educationRank,
  educationSimilarity,
  educationTemperature,
  type EducationTerm,
} from "../../shared/games/education";
import { educationVocabulary } from "../../shared/games/educationVocabulary";

const index = educationIndex(educationVocabulary);
const byTerm = (term: string): EducationTerm => {
  const found = index.get(educationKey(term));
  if (!found) throw new Error(`brak terminu: ${term}`);
  return found;
};

describe("educationSimilarity", () => {
  it("scores a term against itself highest", () => {
    const prawo = byTerm("magister prawa");
    expect(educationSimilarity(prawo, prawo)).toBeGreaterThan(
      educationSimilarity(prawo, byTerm("magister ekonomii")),
    );
  });

  it("puts the field ahead of the level — a lawyer is nearer a lawyer than a fellow master's", () => {
    const target = byTerm("magister prawa");
    expect(educationSimilarity(target, byTerm("radca prawny"))).toBeGreaterThan(
      educationSimilarity(target, byTerm("magister biologii")),
    );
  });

  it("keeps a trade near its own branch", () => {
    const target = byTerm("technik budowlany");
    expect(educationSimilarity(target, byTerm("murarz"))).toBeGreaterThan(
      educationSimilarity(target, byTerm("magister psychologii")),
    );
  });
});

describe("educationRank", () => {
  it("ranks the answer itself first", () => {
    const target = byTerm("magister prawa");
    expect(educationRank(educationVocabulary, target, target)).toBe(1);
  });

  it("ranks a near miss ahead of an unrelated guess", () => {
    const target = byTerm("magister inżynier budownictwa");
    const near = educationRank(
      educationVocabulary,
      target,
      byTerm("technik budowlany"),
    );
    const far = educationRank(
      educationVocabulary,
      target,
      byTerm("magister teologii"),
    );
    expect(near).toBeLessThan(far);
  });

  it("is stable — the same guess never changes rank between calls", () => {
    const target = byTerm("magister ekonomii");
    const guess = byTerm("magister zarządzania");
    const first = educationRank(educationVocabulary, target, guess);
    const second = educationRank(educationVocabulary, target, guess);
    expect(first).toBe(second);
  });

  it("gives every term a distinct rank, so no two guesses tie", () => {
    const target = byTerm("magister prawa");
    const ranks = educationVocabulary.map((entry) =>
      educationRank(educationVocabulary, target, entry),
    );
    expect(new Set(ranks).size).toBe(educationVocabulary.length);
  });

  it("handles a formation nothing else parses — the reason for the whole design", () => {
    const target = byTerm("duchowny prawosławny");
    expect(educationRank(educationVocabulary, target, target)).toBe(1);
    const priest = educationRank(
      educationVocabulary,
      target,
      byTerm("ksiądz katolicki"),
    );
    const welder = educationRank(
      educationVocabulary,
      target,
      byTerm("spawacz"),
    );
    expect(priest).toBeLessThan(welder);
  });
});

describe("educationIndex", () => {
  it("resolves the aliases a hand-typed field would hold", () => {
    expect(byTerm("prawnik").term).toBe("magister prawa");
    expect(byTerm("MGR PRAWA").term).toBe("magister prawa");
    expect(byTerm("  rolnik ").term).toBe("dyplomowany rolnik");
  });

  it("covers both values the register actually holds today", () => {
    expect(byTerm("nauczyciel")).toBeTruthy();
    expect(byTerm("dyplomowany rolnik")).toBeTruthy();
  });
});

describe("educationTemperature", () => {
  it("reads warmer as the rank falls", () => {
    expect(educationTemperature(1, 133)).toBe("trafione");
    expect(educationTemperature(5, 133)).toBe("bardzo blisko");
    expect(educationTemperature(130, 133)).toBe("zimno");
  });
});
