import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { createError, getQuery } from "h3";
import { defineComponent, h } from "vue";
import { VRangeSlider, VSelect } from "vuetify/components";
import { clearNuxtData } from "#app";
import PartyStack from "../../../app/components/explore/VisualisationPartyStack.vue";
import type { PartyStackResponse } from "../../../server/api/stats/partyStack.get";

/** What the endpoint answers with, by the category asked ("" for none). A
 * category missing here answers 500. Replaced per test. */
let answers: Record<string, PartyStackResponse> = {};

/** The category each request carried, "" for none. */
let asked: string[] = [];

registerEndpoint("/api/stats/partyStack", (event): PartyStackResponse => {
  const category = String(getQuery(event).category ?? "");
  asked.push(category);
  const answer = answers[category];
  if (!answer) throw createError({ statusCode: 500 });
  return answer;
});

function stack(over: Partial<PartyStackResponse> = {}): PartyStackResponse {
  return {
    months: ["2026-09", "2026-10", "2026-11"],
    series: [
      { key: "PO", label: "PO", counts: [10, 11, 12.5] },
      { key: "PiS", label: "PiS", counts: [20, 20, 19.5] },
      { key: "Inne", label: "Inne partie", counts: [3, 3, 3] },
    ],
    coverage: { posts: 120, people: 35 },
    posts: 130,
    today: "2026-11",
    ...over,
  };
}

/** Mounts and waits until the chart, or what stands in for it, is there.
 * `apexchart` is stubbed: it measures a real element, which jsdom has not. */
async function mountStack(category: string | null = null) {
  const updates: (string | null | undefined)[] = [];
  const wrapper = await mountSuspended(PartyStack, {
    props: {
      category,
      "onUpdate:category": (value: string | null | undefined) =>
        void updates.push(value),
    },
    global: { stubs: { apexchart: true } },
  });
  await vi.waitUntil(
    () =>
      ["party-stack", "party-stack-empty", "party-stack-error"].some((id) =>
        wrapper.find(`[data-testid="${id}"]`).exists(),
      ),
    { timeout: 2000 },
  );
  return { wrapper, updates };
}

describe("ExploreVisualisationPartyStack", () => {
  beforeEach(() => {
    clearNuxtData();
    answers = { "": stack(), szpitale: stack({ posts: 120 }) };
    asked = [];
  });

  it("asks for every institution without a category, and names none", async () => {
    const { wrapper } = await mountStack();

    expect(asked).toEqual([""]);
    expect(wrapper.text()).toContain("Stanowiska wg partii");
    expect(wrapper.text()).not.toContain("Stanowiska wg partii:");
  });

  it("asks for the category it is given and names it on the card", async () => {
    // A screenshot of the card alone, which is how a chart gets shared,
    // keeps the category.
    const { wrapper } = await mountStack("szpitale");

    expect(asked).toEqual(["szpitale"]);
    expect(wrapper.text()).toContain("Stanowiska wg partii: Szpitale");
  });

  it("hands the picked category up, and none for every institution", async () => {
    const { wrapper, updates } = await mountStack("szpitale");
    const select = wrapper.findComponent(VSelect);

    select.vm.$emit("update:modelValue", "koleje");
    select.vm.$emit("update:modelValue", "__all__");

    expect(updates).toEqual(["koleje", null]);
  });

  it("says how many people and posts it counts, out of how many", async () => {
    const { wrapper } = await mountStack();

    expect(wrapper.text()).toMatch(
      /35\u00a0osób i 120\u00a0z\u00a0130\u00a0stanowisk/,
    );
  });

  it("writes a shared-out person to one decimal and the month's total whole", async () => {
    const { wrapper } = await mountStack();
    await wrapper
      .find('button[aria-label="Tabela z liczbami"]')
      .trigger("click");
    await flushPromises();

    const last = wrapper.findAll("tbody tr").at(-1)!;
    expect(last.text()).toContain("Listopad 2026");
    expect(last.findAll("td").map((cell) => cell.text())).toEqual([
      "Listopad 2026",
      "12,5",
      "19,5",
      "3",
      "35",
    ]);
  });

  it("says there are too few dates for a single month, and keeps the picker", async () => {
    answers[""] = stack({
      months: ["2026-11"],
      series: [{ key: "PO", label: "PO", counts: [1] }],
    });

    const { wrapper } = await mountStack();

    expect(wrapper.find('[data-testid="party-stack-empty"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="party-stack-category"]').exists()).toBe(
      true,
    );
  });

  it("says the chart failed rather than that there are no dates", async () => {
    const { wrapper } = await mountStack("koleje");

    expect(wrapper.find('[data-testid="party-stack-error"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="party-stack-category"]').exists()).toBe(
      true,
    );
  });

  it("titles the tooltip with the month and its people, the top band first", async () => {
    const Apexchart = defineComponent({
      name: "apexchart",
      props: { options: Object, series: Array, type: String, height: Number },
      setup: () => () => h("div"),
    });
    const wrapper = await mountSuspended(PartyStack, {
      props: { category: null },
      global: { stubs: { apexchart: Apexchart } },
    });
    await vi.waitUntil(() => wrapper.findComponent(Apexchart).exists(), {
      timeout: 2000,
    });
    const { tooltip } = wrapper.findComponent(Apexchart).props("options") as {
      tooltip: { custom: (point: { dataPointIndex: number }) => string };
    };

    const box = document.createElement("div");
    box.innerHTML = tooltip.custom({ dataPointIndex: 2 });

    expect(box.querySelector(".apexcharts-tooltip-title")?.textContent).toBe(
      "Listopad 2026: 35\u00a0osób",
    );
    expect(
      [...box.querySelectorAll(".apexcharts-tooltip-text-y-label")].map(
        (label) => label.textContent,
      ),
    ).toEqual(["Inne partie: ", "PiS: ", "PO: "]);
  });

  describe("narrowing the years", () => {
    /** Three years of months, 2024-01 to 2026-11, one person each month. */
    function years(): PartyStackResponse {
      const months = Array.from({ length: 35 }, (_, i) => {
        const index = 2024 * 12 + i;
        return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
      });
      return stack({
        months,
        series: [{ key: "PO", label: "PO", counts: months.map(() => 1) }],
      });
    }

    async function mountYears(picked: [number, number] | null) {
      answers[""] = years();
      const updates: ([number, number] | null | undefined)[] = [];
      const wrapper = await mountSuspended(PartyStack, {
        props: {
          category: null,
          years: picked,
          "onUpdate:years": (value: [number, number] | null | undefined) =>
            void updates.push(value),
        },
        global: { stubs: { apexchart: true } },
      });
      await vi.waitUntil(
        () => wrapper.find('[data-testid="party-stack"]').exists(),
        { timeout: 2000 },
      );
      await wrapper
        .find('button[aria-label="Tabela z liczbami"]')
        .trigger("click");
      await flushPromises();
      return { wrapper, updates };
    }

    const rows = (wrapper: Awaited<ReturnType<typeof mountYears>>["wrapper"]) =>
      wrapper.findAll("tbody tr").map((row) => row.find("td").text());

    it("spans the years there is data for, all of them when none are picked", async () => {
      const { wrapper } = await mountYears(null);
      const slider = wrapper.findComponent(VRangeSlider);

      expect(slider.props("min")).toBe(2024);
      expect(slider.props("max")).toBe(2026);
      expect(
        wrapper.find('[data-testid="party-stack-years-shown"]').text(),
      ).toBe("2024 - 2026");
      expect(rows(wrapper)).toEqual(["2024", "2025", "Listopad 2026"]);
    });

    it("draws only the years picked, the table too", async () => {
      const { wrapper } = await mountYears([2025, 2026]);

      expect(rows(wrapper)).toEqual(["2025", "Listopad 2026"]);
    });

    it("follows the slider at once and writes the years a moment after it stops", async () => {
      const { wrapper, updates } = await mountYears(null);
      const slider = wrapper.findComponent(VRangeSlider);

      slider.vm.$emit("update:modelValue", [2024, 2024]);
      slider.vm.$emit("update:modelValue", [2024, 2025]);
      await flushPromises();
      // On screen before the url has anything: a key pressed before the
      // router caught up used to start from the old year again.
      expect(rows(wrapper)).toEqual(["2024", "2025"]);
      expect(updates).toEqual([]);

      // One write for the whole run of moves, the last of them.
      await vi.waitUntil(() => updates.length > 0, { timeout: 2000 });
      expect(updates).toEqual([[2024, 2025]]);
    });

    it("writes no years at all for every year, so the url stays clean", async () => {
      const { wrapper, updates } = await mountYears([2025, 2026]);

      wrapper
        .findComponent(VRangeSlider)
        .vm.$emit("update:modelValue", [2024, 2026]);
      await vi.waitUntil(() => updates.length > 0, { timeout: 2000 });

      expect(updates).toEqual([null]);
    });
  });
});
