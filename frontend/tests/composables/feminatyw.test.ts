import { describe, it, expect } from "vitest";
import { useFeminatyw } from "../../app/composables/feminatyw";

describe("useFeminatyw", () => {
  it("returns female forms when forceFemale is true", () => {
    const { koryciarz, tuczyciel, pracownik } = useFeminatyw({
      forceFemale: true,
    });

    expect(koryciarz.singular.nominative).toBe("koryciarka");
    expect(tuczyciel.singular.nominative).toBe("tuczycielka");
    expect(pracownik.singular.nominative).toBe("pracowniczka");
  });

  it("returns correct cases for nouns", () => {
    const { koryciarz } = useFeminatyw({ forceFemale: true });

    expect(koryciarz.singular.genitive).toBe("koryciarki");
    expect(koryciarz.plural.nominative).toBe("koryciarki");
    expect(koryciarz.plural.genitive).toBe("koryciarek");
  });
});
