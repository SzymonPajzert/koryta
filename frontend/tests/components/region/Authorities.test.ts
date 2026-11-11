import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import Authorities from "../../../app/components/region/Authorities.vue";
import { regionAuthorities } from "../../../shared/regionAuthorities";
import type { RegionRun } from "../../../shared/electionLists";

enableAutoUnmount(afterEach);

let edges = 0;
/** A 2024 win, with what a test does not care about filled in. */
function won(over: Partial<RegionRun> & { personId: string }): RegionRun {
  edges += 1;
  return {
    edgeId: `e${edges}`,
    personName: over.personId,
    parties: [],
    published: true,
    start: "2024-01-01",
    position: "Rada powiatu",
    committee: null,
    party: null,
    elected: true,
    byElection: false,
    ...over,
  };
}

function mountView(
  teryt: string,
  runs: RegionRun[] = [],
  props: Record<string, unknown> = {},
) {
  return mountSuspended(Authorities, {
    props: {
      authorities: regionAuthorities(runs, teryt)!,
      wariant: "a",
      composition: null,
      ...props,
    },
    attachTo: document.body,
  });
}

type View = Awaited<ReturnType<typeof mountView>>;

function emptyLine(view: View): string {
  return view
    .get('[data-testid="region-authorities-empty"]')
    .text()
    .replace(/\s+/g, " ");
}

describe("RegionAuthorities", () => {
  it("names a place that shows nobody by its own kind", async () => {
    expect(emptyLine(await mountView("10"))).toBe(
      "Nie znamy jeszcze nikogo z władz tego województwa.",
    );
    expect(emptyLine(await mountView("1061"))).toBe(
      "Nie znamy jeszcze nikogo z władz tego miasta.",
    );
    expect(emptyLine(await mountView("1005"))).toBe(
      "Nie znamy jeszcze nikogo z władz tego powiatu.",
    );
  });

  it("sends a city's gmina to the city, and Kraków's to its rada only", async () => {
    // Kraków's page is drawn by hand: its rada heads it, it has no „Władze”.
    const krakow = await mountView("1261011", [], {
      pointerTarget: {
        name: "Kraków",
        url: "/region/krakow-teryt1261",
        councilOnly: true,
      },
    });
    expect(emptyLine(krakow)).toBe(
      "Radę miasta pokazujemy na stronie miasta: Kraków.",
    );

    const lodz = await mountView("1061011", [], {
      pointerTarget: { name: "Łódź", url: "/region/lodz-teryt1061#wladze" },
    });
    expect(emptyLine(lodz)).toBe(
      "Prezydenta i radę miasta pokazujemy na stronie miasta: Łódź.",
    );
  });

  it("opens a long council in place and hands focus to the first member it opened", async () => {
    // Ten seats on one committee and five on another: the fold after twelve
    // cuts the second one short, after its first two.
    const runs = [
      ...Array.from({ length: 10 }, (_, index) =>
        won({
          personId: `Anna ${String.fromCharCode(65 + index)}`,
          committee: "KKW KOALICJA OBYWATELSKA",
          party: "PO",
        }),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        won({
          personId: `Bogdan ${String.fromCharCode(65 + index)}`,
          committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
          party: "PiS",
        }),
      ),
    ];
    const view = await mountView("1005", runs);
    const names = () =>
      view.findAll(".list-member").map((row) => row.get("a").text());
    const before = names();
    expect(before).toHaveLength(12);

    const button = view.get("button.list-more");
    expect(button.attributes("aria-expanded")).toBe("false");
    const box = document.getElementById(button.attributes("aria-controls")!);
    expect(box?.classList.contains("lists-box")).toBe(true);

    await button.trigger("click");
    await flushPromises();

    const after = names();
    expect(after).toHaveLength(15);
    expect(view.find("button.list-more").exists()).toBe(false);
    // Where the button was, so a keyboard is not dropped back to the top.
    const opened = after.find((name) => !before.includes(name));
    expect(document.activeElement?.textContent.trim()).toBe(opened);
    expect(opened).toBe("Bogdan C");
  });
});
