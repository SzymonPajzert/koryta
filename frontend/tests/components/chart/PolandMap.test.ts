import { beforeEach, describe, it, expect, vi } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearNuxtData } from "#app";
import PolandMap from "../../../../app/components/chart/PolandMap.vue";
import {
  choropleth,
  choroplethLead,
  choroplethPeople,
  choroplethShare,
} from "~/utils/chartTheme";

type Row = {
  id: string;
  teryt: string;
  name: string;
  people: number;
  parties?: Record<string, number>;
};

/** What /api/stats/regions answers; each test sets it before mounting. */
let rows: Row[] = [];
registerEndpoint("/api/stats/regions", () => rows);

/** Three powiaty as the night's recount writes them. PiS has the most people
 * over all three (13), then PO (11), then Nowa Lewica (3). */
const counted: Row[] = [
  {
    id: "teryt1201",
    teryt: "1201",
    name: "Powiat bocheński",
    people: 10,
    parties: { PiS: 7, PO: 2 },
  },
  {
    id: "teryt3064",
    teryt: "3064",
    name: "Poznań",
    people: 20,
    parties: { PO: 9, PiS: 6, "Nowa Lewica": 3 },
  },
  {
    id: "teryt1261",
    teryt: "1261",
    name: "Kraków",
    people: 2,
    parties: { PO: 0, PiS: 0 },
  },
];

/** The map fetches lazily: the counts land after it mounts. */
const mountMap = async () => {
  const wrapper = await mountSuspended(PolandMap);
  if (rows.length)
    await vi.waitFor(() =>
      expect(wrapper.findAll("title").map((t) => t.text())).toContainEqual(
        expect.stringContaining(rows[0]!.name),
      ),
    );
  return wrapper;
};

/** The path whose tooltip starts with this name. */
const pathOf = (wrapper: Awaited<ReturnType<typeof mountMap>>, name: string) =>
  wrapper
    .findAll("path")
    .find(
      (p) =>
        p.find("title").exists() && p.find("title").text().startsWith(name),
    )!;

beforeEach(() => {
  rows = [];
  // The map's data is keyed, so a mount would otherwise get the last one's.
  clearNuxtData("polandmap-region-stats");
});

describe("PolandMap", () => {
  it("renders correctly with padded teryt names from the API", async () => {
    const wrapper = await mountMap();
    const titlesText = wrapper.findAll("title").map((t) => t.text());

    // Validate padding fixed the 3-digit bug. Without padding, it was 'Powiat 146'
    expect(titlesText.some((t) => t.match(/Powiat 0\d{3} \(0 osób\)/))).toBe(
      true,
    );
  });

  it("outlines the powiat under the pointer and keeps its fill", async () => {
    const wrapper = await mountMap();
    const path = pathOf(wrapper, "Powiat 0204");
    const fill = path.attributes("fill");

    await path.trigger("mouseenter");

    const outline = wrapper.findAll('[data-testid="map-hover"] path');
    expect(outline.map((p) => p.attributes("d"))).toEqual([
      path.attributes("d"),
      path.attributes("d"),
    ]);
    expect(outline[1]!.attributes("fill")).toBe("none");
    expect(path.attributes("fill")).toBe(fill);

    await wrapper.find("svg").trigger("mouseleave");
    expect(wrapper.find('[data-testid="map-hover"]').exists()).toBe(false);
  });

  it("outlines the powiat it is told is picked, and only while it is", async () => {
    const wrapper = await mountMap();
    const first = pathOf(wrapper, "Powiat 0204");
    const picked = () => wrapper.find('[data-testid="map-picked"] path');

    // A click only says which powiat it was: the explorer holds the pick.
    await first.trigger("click");
    expect(wrapper.emitted("click")?.[0]?.[0]).toMatchObject({
      teryt: expect.stringMatching(/^0?204$/),
    });
    expect(picked().exists()).toBe(false);

    await wrapper.setProps({
      picked: { teryt: "204", d: first.attributes("d") },
    });
    expect(picked().attributes("d")).toBe(first.attributes("d"));

    await wrapper.setProps({ picked: null });
    expect(picked().exists()).toBe(false);
  });

  it("opens on the leading party, shaded by its share", async () => {
    rows = counted;
    const wrapper = await mountMap();

    // PiS has 7 of the 9 with a party: 78%, the strongest step.
    expect(pathOf(wrapper, "Powiat bocheński").attributes("fill")).toBe(
      choroplethLead.PiS![2],
    );
    // PO has 9 of 18: 50%, the middle step.
    expect(pathOf(wrapper, "Poznań").attributes("fill")).toBe(
      choroplethLead.PO![1],
    );
    expect(pathOf(wrapper, "Kraków").attributes("fill")).toBe(choropleth.thin);
    expect(wrapper.find('[data-testid="map-legend"]').text()).toContain(
      "Najliczniejsza partia",
    );
  });

  it("offers a chip per party, most people first", async () => {
    rows = counted;
    const wrapper = await mountMap();

    const chips = wrapper
      .findAll(".map-switch__chip")
      .map((chip) => chip.text());
    expect(chips).toEqual(["Wszystkie", "PiS", "PO", "Nowa Lewica / SLD"]);
  });

  it("shows one party's share once its chip is picked", async () => {
    rows = counted;
    const wrapper = await mountMap();

    const po = wrapper
      .findAll(".map-switch__chip")
      .find((chip) => chip.text() === "PO")!;
    await po.trigger("click");

    // 2 of 9 is 22%: the second step. 9 of 18 is 50%: the third.
    expect(pathOf(wrapper, "Powiat bocheński").attributes("fill")).toBe(
      choroplethShare.PO![1],
    );
    expect(pathOf(wrapper, "Poznań").attributes("fill")).toBe(
      choroplethShare.PO![2],
    );
    expect(pathOf(wrapper, "Poznań").find("title").text()).toContain(
      "PO: 9 z 18 osób z partią",
    );
    expect(wrapper.find('[data-testid="map-legend"]').text()).toContain(
      "Udział PO wśród osób z partią",
    );
  });

  it("colours people and offers no chips before the recount writes parties", async () => {
    rows = counted.map(({ parties: _parties, ...row }) => row);
    const wrapper = await mountMap();

    expect(wrapper.find('[data-testid="map-switch"]').exists()).toBe(false);
    // 20 people: the 20-49 class.
    expect(pathOf(wrapper, "Poznań").attributes("fill")).toBe(
      choroplethPeople[3],
    );
    expect(wrapper.find('[data-testid="map-legend"]').text()).toContain(
      "Osoby w powiecie",
    );
  });
});
