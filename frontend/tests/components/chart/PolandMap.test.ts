import { describe, it, expect } from "vitest";
import PolandMap from "../../../../app/components/chart/PolandMap.vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";

describe("PolandMap", () => {
  const mountMap = async () => {
    return await mountSuspended(PolandMap);
  };

  it("renders correctly with padded teryt names from the API", async () => {
    const wrapper = await mountMap();
    const titles = wrapper.findAll("title");
    const titlesText = titles.map((t) => t.text());
    console.log(titlesText.slice(0, 10)); // just look at first 10

    // Validate padding fixed the 3-digit bug. Without padding, it was 'Powiat 146'
    expect(titlesText.some((t) => t.match(/Powiat 0\d{3} \(0 osób\)/))).toBe(
      true,
    );
  });

  it("assigns hoveredDistrict on mouseenter and clears on mouseleave of svg", async () => {
    const wrapper = await mountMap();

    const svg = wrapper.find("svg");
    const paths = wrapper.findAll("path");

    // Find the path corresponding to teryt 0204
    const mockedPath = paths.find((p) =>
      p.find("title").text().includes("Powiat 0204"),
    );

    expect(mockedPath).toBeDefined();

    // Trigger mouseenter on path
    await mockedPath!.trigger("mouseenter");

    // Hovered path must have fill="#e0e0e0"
    expect(mockedPath!.attributes("fill")).toBe("#e0e0e0");

    // Other paths shouldn't be #e0e0e0
    const otherPath = paths.find(
      (p) => !p.find("title").text().includes("Powiat 0204"),
    );
    expect(otherPath!.attributes("fill")).not.toBe("#e0e0e0");

    // Trigger mouseleave on SVG
    await svg.trigger("mouseleave");

    // The fill color should no longer be #e0e0e0
    expect(mockedPath!.attributes("fill")).not.toBe("#e0e0e0");
  });
});
