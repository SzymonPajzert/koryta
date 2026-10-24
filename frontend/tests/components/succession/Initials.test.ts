import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Initials from "../../../app/components/succession/Initials.vue";

const letters = async (name: string) =>
  (await mountSuspended(Initials, { props: { name, tone: "in" } })).text();

/** Stands in for a photograph nobody has, on the board's cards and on both
 * pages' handover rows. */
describe("SuccessionInitials", () => {
  it("takes the first letter of each of the first two words", async () => {
    expect(await letters("Marcin Protas")).toBe("MP");
    expect(await letters("Mirosław Antoni Gornowicz")).toBe("MA");
    expect(await letters("Wioletta Paprocka-Ślusarska")).toBe("WP");
  });

  it("writes them in capitals whatever the name was entered in", async () => {
    expect(await letters("łukasz żak")).toBe("ŁŻ");
  });

  it("copes with one word, stray spaces and no name at all", async () => {
    expect(await letters("Jan")).toBe("J");
    expect(await letters("  Anna   Nowak ")).toBe("AN");
    expect(await letters("")).toBe("?");
  });

  it("is hidden from a screen reader, which reads the name beside it", async () => {
    // „MP Marcin Protas” would say the name twice.
    const disc = await mountSuspended(Initials, {
      props: { name: "Marcin Protas", tone: "out" },
    });

    expect(disc.get(".initials").attributes("aria-hidden")).toBe("true");
    expect(disc.get(".initials").classes()).toContain("initials--out");
  });
});
