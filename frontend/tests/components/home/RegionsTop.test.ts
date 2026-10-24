import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearNuxtData } from "#app";
import RegionsTop from "../../../app/components/home/RegionsTop.vue";
import type { RegionStat } from "../../../server/utils/regionStats";

/** What /api/stats/regions answers with. Replaced per test. */
let regions: RegionStat[] = [];

/** Set by the test about the request failing. */
let failing = false;

/** Set by the test about the column while the counts are on their way: the
 * answer waits until it settles. */
let held: Promise<void> | null = null;

registerEndpoint("/api/stats/regions", async () => {
  if (held) await held;
  if (failing) throw new Error("the region stats are down");
  return regions;
});

/** The key `useRegionCounts` shares with the map. One Nuxt app serves the
 * whole file, so without clearing it a mount re-serves the previous test's
 * counts without asking for any. */
const COUNTS_KEY = "polandmap-region-stats";

/** A powiat as the stats document carries it, id and all. */
function powiat(teryt: string, name: string, people: number): RegionStat {
  return { id: `teryt${teryt}`, teryt, name, people };
}

type Wrapper = Awaited<ReturnType<typeof mountSuspended>>;

const mounted: Wrapper[] = [];

/** Mounts and waits for the counts. The component does not await them - the
 * map beside it shares the request - so what `mountSuspended` returns is the
 * skeleton, and the list or the fallback card replaces it once they land. */
async function mountList(): Promise<Wrapper> {
  const wrapper = await mountSuspended(RegionsTop);
  mounted.push(wrapper);
  await vi.waitUntil(
    () =>
      wrapper.find('[data-testid="home-side-panel"]').exists() ||
      wrapper.text().includes("Analizuj powiązania"),
    { timeout: 2000 },
  );
  return wrapper;
}

const rowsOf = (wrapper: Wrapper) =>
  wrapper.findAll('[data-testid="home-region-row"]');

const labels = (wrapper: Wrapper) =>
  rowsOf(wrapper).map((row) => row.get(".v-list-item-title").text());

const counts = (wrapper: Wrapper) =>
  rowsOf(wrapper).map((row) => row.get(".regions-top__count").text());

const shares = (wrapper: Wrapper) =>
  wrapper
    .findAll(".regions-top__bar")
    .map((bar) =>
      (bar.element as HTMLElement).style.getPropertyValue("--share"),
    );

describe("HomeRegionsTop", () => {
  beforeEach(() => {
    regions = [];
    failing = false;
    held = null;
    clearNuxtData(COUNTS_KEY);
  });

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
  });

  it("ranks the powiaty by their people, the most first", async () => {
    regions = [
      powiat("2261", "Gdańsk", 117),
      powiat("1465", "Miasto Warszawa", 518),
      powiat("0264", "Wrocław", 86),
      powiat("1261", "Kraków", 99),
    ];

    const wrapper = await mountList();

    expect(labels(wrapper)).toEqual([
      "Warszawa",
      "Gdańsk",
      "Kraków",
      "Wrocław",
    ]);
    expect(counts(wrapper)).toEqual(["518", "117", "99", "86"]);
  });

  it("lists powiaty only, and only those with somebody in them", async () => {
    // What the map colours: a powiat's code is four digits. A województwo's
    // two would rank the fraction of its people the stats job counts there,
    // a gmina's seven has no patch of its own, and a region without a code
    // is nowhere on the map at all.
    regions = [
      { id: "teryt14", teryt: "14", name: "Mazowieckie", people: 174 },
      { id: "teryt1465011", teryt: "1465011", name: "Warszawa", people: 300 },
      { id: "chain-powiat", name: "Powiat Testowy", people: 9 },
      powiat("1661", "Opole", 0),
      powiat("2261", "Gdańsk", 117),
    ];

    const wrapper = await mountList();

    expect(labels(wrapper)).toEqual(["Gdańsk"]);
  });

  it("groups a count's thousands, as the site's other figures are", async () => {
    regions = [powiat("1465", "Miasto Warszawa", 12345)];

    const wrapper = await mountList();

    // A no-break space, so the figure never wraps between its groups.
    expect(counts(wrapper)).toEqual(["12\u00a0345"]);
  });

  it("draws each bar as a share of the first, never as an empty track", async () => {
    // One person beside 1 284 rounds to 0%, and an empty track would read as
    // nobody at all.
    regions = [
      powiat("1465", "Miasto Warszawa", 1284),
      powiat("2261", "Gdańsk", 642),
      powiat("1661", "Opole", 1),
    ];

    const wrapper = await mountList();

    expect(shares(wrapper)).toEqual(["100%", "50%", "1%"]);
  });

  it("renders ten rows and leaves it to the width how many show", async () => {
    // All ten in the markup, so the server and the browser agree on it: five
    // on a phone, eight from 960px, all of them from 1280.
    regions = Array.from({ length: 12 }, (_, i) =>
      powiat(String(1401 + i), `Powiat ${i + 1}`, 100 - i),
    );

    const wrapper = await mountList();

    expect(rowsOf(wrapper)).toHaveLength(10);
    expect(labels(wrapper).at(-1)).toBe("Powiat 10");
    const hidden = (name: string) =>
      wrapper
        .findAll(`.${name}`)
        .map((item) => item.get(".v-list-item-title").text());
    expect(hidden("regions-top__more")).toEqual([
      "Powiat 6",
      "Powiat 7",
      "Powiat 8",
      "Powiat 9",
      "Powiat 10",
    ]);
    expect(hidden("regions-top__most")).toEqual(["Powiat 9", "Powiat 10"]);
  });

  it("picks a row's powiat as a click on the map would, under its node's name", async () => {
    regions = [powiat("1465", "Miasto Warszawa", 518)];

    const wrapper = await mountList();
    await rowsOf(wrapper)[0]!.trigger("click");

    // The row drops „Miasto”, the pick keeps it: the card it opens is titled
    // with the node's name, as it is after a click on that patch of the map.
    expect(wrapper.emitted("pick")).toEqual([
      [
        {
          teryt: "1465",
          id: "1465",
          d: "",
          people: 518,
          name: "Miasto Warszawa",
        },
      ],
    ]);
  });

  it("makes every row a button named by its powiat and count", async () => {
    regions = [
      powiat("1465", "Miasto Warszawa", 518),
      powiat("0262", "Legnica", 1),
      { id: "teryt1807", teryt: "1807", people: 3 },
    ];

    const wrapper = await mountList();
    const rows = rowsOf(wrapper);

    expect(rows.map((row) => row.attributes("role"))).toEqual([
      "button",
      "button",
      "button",
    ]);
    // A region node without a name is still a row, under its code.
    expect(rows.map((row) => row.attributes("aria-label"))).toEqual([
      "Warszawa: 518 osób. Pokaż te osoby.",
      "Powiat 1807: 3 osoby. Pokaż te osoby.",
      "Legnica: 1 osoba. Pokaż te osoby.",
    ]);
  });

  it("asks for a region on the map when nothing has been counted", async () => {
    // A database /api/stats/computeNodes has never run against, or one whose
    // counts are all zero: the instruction the column used to be.
    regions = [powiat("1661", "Opole", 0)];

    const wrapper = await mountList();

    expect(wrapper.find('[data-testid="home-side-panel"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain("Analizuj powiązania");
    expect(wrapper.text()).toContain("Wybierz region z mapy");
  });

  it("asks for a region on the map when the counts cannot be had", async () => {
    failing = true;

    const wrapper = await mountList();

    expect(rowsOf(wrapper)).toHaveLength(0);
    expect(wrapper.text()).toContain("Wybierz region z mapy");
  });

  it("holds the list's outline while the counts are on their way", async () => {
    // Not the instruction: it would stand there for a moment and then jump to
    // a list three times its height.
    let release!: () => void;
    held = new Promise((resolve) => (release = resolve));
    regions = [powiat("2261", "Gdańsk", 117)];

    const wrapper = await mountSuspended(RegionsTop);
    mounted.push(wrapper);

    expect(wrapper.find(".v-skeleton-loader").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Wybierz region z mapy");

    release();
    await vi.waitUntil(
      () => wrapper.find('[data-testid="home-side-panel"]').exists(),
      { timeout: 2000 },
    );
    expect(wrapper.find(".v-skeleton-loader").exists()).toBe(false);
  });
});
