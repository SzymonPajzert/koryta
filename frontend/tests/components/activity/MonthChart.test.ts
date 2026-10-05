import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { clearNuxtData } from "#app";
import MonthChart from "../../../app/components/activity/MonthChart.vue";
import type { ActivityStats } from "../../../server/api/stats/activity.get";
import type { ActivityKind } from "../../../shared/activity";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({ authRequest: mockAuthRequest }));

/** Thirty days ending 24 September 2026, busy on two of them. */
function stats(overrides: Partial<ActivityStats> = {}): ActivityStats {
  const daily = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 7, 26 + index));
    const busy = index === 18 ? 253 : index === 3 ? 191 : 0;
    return {
      date: date.toISOString().slice(0, 10),
      counts: { vote: 0, revision: busy, noteSource: 0, publication: 0 },
      total: busy,
    };
  });
  return {
    window: { since: daily[0]!.date, until: daily[29]!.date, days: 30 },
    identified: false,
    totals: { vote: 320, revision: 813, noteSource: 355, publication: 285 },
    total: 1773,
    daily,
    contributorCount: 9,
    contributors: [],
    namedCount: 0,
    self: null,
    truncated: [],
    ...overrides,
  };
}

/** Mounts and waits for the card to have its answer. `apexchart` is stubbed:
 * it measures a real element on mount, and jsdom has none to give it. */
async function mountCard() {
  const wrapper = await mountSuspended(MonthChart, {
    global: { stubs: { apexchart: true } },
  });
  await vi.waitUntil(() => mockAuthRequest.mock.results.length > 0, {
    timeout: 2000,
  });
  await vi.waitUntil(() => !wrapper.find(".v-skeleton-loader").exists(), {
    timeout: 2000,
  });
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearNuxtData("activity-month-chart");
});

describe("ActivityMonthChart", () => {
  it("asks for the last 30 days", async () => {
    mockAuthRequest.mockResolvedValue(stats());
    await mountCard();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/stats/activity", {
      method: "GET",
      query: { days: 30 },
    });
  });

  it("leads with the month's total and how many people made it", async () => {
    mockAuthRequest.mockResolvedValue(stats());
    const wrapper = await mountCard();

    expect(wrapper.text()).toContain("1773");
    expect(wrapper.text()).toContain("od 9 osób");
    expect(wrapper.find("apexchart-stub").exists()).toBe(true);
  });

  it("marks the total as a lower bound when a kind hit its cap", async () => {
    mockAuthRequest.mockResolvedValue(stats({ truncated: ["revision"] }));
    const wrapper = await mountCard();

    const plus = wrapper.find('[title^="Dolna granica"]');
    expect(plus.text()).toBe("+");
    expect(wrapper.find(".amc__total").text()).toBe("1773+");
  });

  it("names the busiest day for a screen reader", async () => {
    mockAuthRequest.mockResolvedValue(stats());
    const wrapper = await mountCard();

    expect(wrapper.find(".d-sr-only").text()).toBe(
      "Najwięcej zmian było niedz., 13 wrz: 253.",
    );
  });

  it("links to the full statistics", async () => {
    mockAuthRequest.mockResolvedValue(stats());
    const wrapper = await mountCard();

    const link = wrapper.find('a[href="/eksploruj/statystyki"]');
    expect(link.text()).toContain("Pełne statystyki");
  });

  it("says so instead of drawing a flat month", async () => {
    const quiet = stats();
    for (const day of quiet.daily) {
      day.total = 0;
      for (const kind of Object.keys(day.counts) as ActivityKind[])
        day.counts[kind] = 0;
    }
    mockAuthRequest.mockResolvedValue({ ...quiet, total: 0 });
    const wrapper = await mountCard();

    expect(wrapper.text()).toContain("W tym okresie nikt nic nie zmieniał.");
    expect(wrapper.find("apexchart-stub").exists()).toBe(false);
  });

  it("keeps the link when the chart cannot be fetched", async () => {
    mockAuthRequest.mockRejectedValue(new Error("boom"));
    const wrapper = await mountCard();

    expect(wrapper.text()).toContain("Nie udało się pobrać wykresu.");
    expect(wrapper.find('a[href="/eksploruj/statystyki"]').exists()).toBe(true);
  });
});
