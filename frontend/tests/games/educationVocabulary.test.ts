import { describe, it, expect } from "vitest";
import {
  educationAreas,
  educationIndex,
  educationKey,
  educationLevels,
  educationLookup,
  educationNormalizedKey,
  educationSimilarity,
  educationTemperature,
  educationTemperatureBands,
} from "../../shared/games/education";
import { educationVocabulary } from "../../shared/games/educationVocabulary";

/** The vocabulary is data, and data is where this game goes wrong.
 *
 * Every one of these is a rule the ranking silently depends on: an area the
 * affinity table has never heard of, an alias that happens to be somebody
 * else's term, a tie cluster wide enough that the rank a player is shown comes
 * from the alphabet. None of them is visible in review of a diff that adds
 * forty rows, and all of them are cheap to check.
 */
const index = educationIndex(educationVocabulary);
const areas = new Set<string>(educationAreas);
const levels = new Set<string>(educationLevels);

describe("educationVocabulary shape", () => {
  it("is big enough for a rank to mean something", () => {
    // Contexto's own list is ~100k words. This one only has to be long enough
    // that the bands below it are reachable and a near miss is visibly nearer
    // than a wrong field.
    expect(educationVocabulary.length).toBeGreaterThan(600);
  });

  it("puts every term under one of the areas the affinity table knows", () => {
    const strays = educationVocabulary
      .filter((entry) => !areas.has(entry.path[0] ?? ""))
      .map((entry) => `${entry.term}: ${entry.path[0]}`);
    expect(strays).toEqual([]);
  });

  it("gives every term a level on the ladder", () => {
    const strays = educationVocabulary
      .filter((entry) => !levels.has(entry.level))
      .map((entry) => `${entry.term}: ${entry.level}`);
    expect(strays).toEqual([]);
  });

  it("gives every term a path of two or three segments", () => {
    const strays = educationVocabulary
      .filter((entry) => entry.path.length < 2 || entry.path.length > 3)
      .map((entry) => `${entry.term}: ${entry.path.join("/")}`);
    expect(strays).toEqual([]);
  });

  it("uses every area, so no branch of the affinity table is dead", () => {
    const used = new Set(educationVocabulary.map((entry) => entry.path[0]));
    expect([...areas].filter((area) => !used.has(area))).toEqual([]);
  });

  it("names each term once", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const entry of educationVocabulary) {
      const key = educationKey(entry.term);
      const first = seen.get(key);
      if (first) clashes.push(`${entry.term} (also ${first})`);
      else seen.set(key, entry.term);
    }
    expect(clashes).toEqual([]);
  });

  it("lets no alias shadow another row's term", () => {
    // The failure this catches shipped once: "inżynier budownictwa" was both a
    // row and an alias of "magister inżynier budownictwa", so the row could
    // never be reached by its own name, the autocomplete offered a term the
    // server would answer about a different one, and guessing it won the day
    // with a word the player had not typed.
    const terms = new Set(
      educationVocabulary.map((entry) => educationKey(entry.term)),
    );
    const stolen: string[] = [];
    for (const entry of educationVocabulary) {
      for (const alias of entry.aliases ?? []) {
        if (terms.has(educationKey(alias))) {
          stolen.push(`${entry.term} -> ${alias}`);
        }
      }
    }
    expect(stolen).toEqual([]);
  });

  it("reaches every row by its own term", () => {
    const unreachable = educationVocabulary
      .filter((entry) => educationLookup(index, entry.term) !== entry)
      .map((entry) => entry.term);
    expect(unreachable).toEqual([]);
  });

  it("reaches every row by every alias it claims", () => {
    const broken: string[] = [];
    for (const entry of educationVocabulary) {
      for (const alias of entry.aliases ?? []) {
        if (educationLookup(index, alias) !== entry) {
          broken.push(`${entry.term} -> ${alias}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("the ranking has something to say", () => {
  /** The whole similarity matrix, once. `educationRank` is O(n) per guess, so
   * ranking every guess against every target would be O(n³); the matrix holds
   * the same information for what these tests ask of it. */
  const scores = educationVocabulary.map((target) =>
    educationVocabulary.map((guess) => educationSimilarity(target, guess)),
  );

  it("scores a term above every other term it is compared with", () => {
    const wrong: string[] = [];
    educationVocabulary.forEach((target, i) => {
      const self = scores[i]![i]!;
      educationVocabulary.forEach((guess, j) => {
        if (i !== j && scores[i]![j]! > self) {
          wrong.push(`${target.term} < ${guess.term}`);
        }
      });
    });
    expect(wrong).toEqual([]);
  });

  const largestCluster = (row: number[]) => {
    const counts = new Map<number, number>();
    for (const score of row) counts.set(score, (counts.get(score) ?? 0) + 1);
    return Math.max(...counts.values());
  };
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

  it("separates guesses instead of tying them in slabs", () => {
    // The version of this file that shipped first scored on field and level
    // alone and left the median target with a single tie cluster covering 51%
    // of the vocabulary - half the list at one distance, ordered by first
    // letter. The morphology term is what fixed that, and this is the check
    // that says so out loud. Measured at 4.8% and 25% when written; the
    // thresholds have room for ordinary edits and none for a regression to
    // anything like the old shape.
    const largest = scores.map(largestCluster);
    expect(median(largest) / educationVocabulary.length).toBeLessThan(0.06);
    expect(Math.max(...largest) / educationVocabulary.length).toBeLessThan(0.3);
  });

  it("keeps what ties it does have out of the part of the list that is played", () => {
    // Ties are inherent to a taxonomy: two terms in the same corner of the
    // tree at the same level, sharing no stem, ARE the same distance away and
    // no amount of weighting invents a difference. What matters is where they
    // fall. A player reads the top of the list - the wrong-but-warm guesses
    // they are steering by - and never tells #700 from #780, so the slabs are
    // allowed in the cold tail and not near the answer.
    const fifth = Math.floor(educationVocabulary.length * 0.2);
    const worst = scores.map((row) => {
      const top = [...row].sort((a, b) => b - a).slice(0, fifth);
      return largestCluster(top);
    });
    expect(Math.max(...worst) / educationVocabulary.length).toBeLessThan(0.08);
    expect(median(worst)).toBeLessThan(30);
  });

  it("gives every target a wide range of distinct answers", () => {
    // 143 for the worst target and 577 for the median when written, against
    // 977 rank slots. The first cut of the ranking managed 9.6.
    const distinct = educationVocabulary.map(
      (_, i) => new Set(scores[i]!).size,
    );
    expect(Math.min(...distinct)).toBeGreaterThan(100);
    expect(median(distinct)).toBeGreaterThan(300);
  });
});

describe("educationTemperature over the shipped vocabulary", () => {
  it("can reach every band it declares", () => {
    const total = educationVocabulary.length;
    const seen = new Set<string>();
    for (let rank = 1; rank <= total; rank++) {
      seen.add(educationTemperature(rank, total));
    }
    expect([...educationTemperatureBands].filter((b) => !seen.has(b))).toEqual(
      [],
    );
  });

  it("never warms up as the rank falls", () => {
    const total = educationVocabulary.length;
    const order = educationTemperatureBands as readonly string[];
    let previous = 0;
    for (let rank = 1; rank <= total; rank++) {
      const band = order.indexOf(educationTemperature(rank, total));
      expect(band).toBeGreaterThanOrEqual(previous);
      previous = band;
    }
  });
});

describe("educationNormalizedKey", () => {
  it("opens out the abbreviations Polish records are written in", () => {
    expect(educationNormalizedKey("inż.mechanik")).toBe("inżynier mechanik");
    expect(educationNormalizedKey("tech.budowlany")).toBe("technik budowlany");
    expect(educationNormalizedKey("mgr inż.")).toBe("magister inżynier");
    expect(educationNormalizedKey("lek. med.")).toBe("lekarz medycyny");
  });

  it("leaves an ordinary phrase alone", () => {
    expect(educationNormalizedKey("magister prawa")).toBe("magister prawa");
  });

  it("is what lets an abbreviated field resolve at all", () => {
    // Written the way a candidate list writes it, which is the form the pool
    // is grown from.
    expect(educationLookup(index, "inż.mechanik")).toBeTruthy();
    expect(educationLookup(index, "tech.rolnik")).toBeTruthy();
  });
});
