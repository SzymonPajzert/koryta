import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import RelativeDuration from "../../../app/components/chip/RelativeDuration.vue";

async function textOf(props: { start?: string; end?: string }) {
  return (
    await mountSuspended(RelativeDuration, {
      props: {
        start: undefined,
        end: undefined,
        minStart: "2000-01-01",
        maxEnd: "2026-01-01",
        ...props,
      },
    })
  ).text();
}

describe("ChipRelativeDuration", () => {
  it("reads both ends of a closed period", async () => {
    expect(await textOf({ start: "2014-11-06", end: "2017-08-25" })).toBe(
      "2014-11-06 - 2017-08-25",
    );
  });

  it("calls an open period ongoing", async () => {
    expect(await textOf({ start: "2014-11-06" })).toBe("2014-11-06 - obecnie");
  });

  it("collapses a period that begins and ends on one day", async () => {
    expect(await textOf({ start: "2014-11-06", end: "2014-11-06" })).toBe(
      "2014-11-06",
    );
  });

  it("never stringifies a missing start", async () => {
    // An edge entered through the editor may carry no start date, and the
    // template used to interpolate it straight into the caption - which is how
    // 117 published people came to read "undefined - obecnie".
    const text = await textOf({ end: "2017-08-25" });
    expect(text).not.toContain("undefined");
    expect(text).toBe("? - 2017-08-25");
  });

  it("says nothing at all when no date was recorded", async () => {
    expect(await textOf({})).toBe("");
  });
});
