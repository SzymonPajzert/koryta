import { describe, it, expect, vi, beforeEach } from "vitest";
import { computed, ref } from "vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import QaPage from "../../app/pages/qa.vue";
import type { QaCheck, QaItem, QaItemState } from "../../shared/qa";
import type { QaAdminResolution } from "../../shared/model";

const vuetify = createVuetify({ components, directives });

const items: QaItem[] = [
  {
    id: "new-thing",
    title: "Nowa rzecz",
    description: "Świeżo dodana.",
    steps: ["Kliknij nową rzecz"],
    area: "public",
  },
  {
    id: "broken-thing",
    title: "Zepsuta rzecz",
    description: "Ktoś zgłosił problem.",
    steps: ["Kliknij zepsutą rzecz"],
    area: "public",
  },
  {
    id: "done-thing",
    title: "Sprawdzona rzecz",
    description: "Ktoś potwierdził.",
    steps: ["Kliknij sprawdzoną rzecz"],
    area: "public",
  },
];

const states: Record<string, QaItemState> = {
  "new-thing": "unchecked",
  "broken-thing": "issue",
  "done-thing": "ok",
};

const checks: QaCheck[] = [
  {
    itemId: "broken-thing",
    userUid: "other",
    status: "issue",
    feedback: "nie ładuje się",
  },
  { itemId: "done-thing", userUid: "me", status: "ok" },
];

const saveCheck = vi.fn(async () => undefined);
const load = vi.fn(async () => undefined);
const loadAdminResolutions = vi.fn(async () => undefined);
const acceptResolution = vi.fn(async () => undefined);
const loaded = ref(true);

/** What the team did with this reader's own report on "broken-thing" - the
 * only entry here they reported. */
const resolutions: Record<string, QaAdminResolution> = {
  "broken-thing": {
    itemId: "broken-thing",
    status: "resolved",
    reportedAt: "2026-08-20T10:00:00.000Z",
  },
};

// The card now reads `feedbackStatusConfig` out of composables/feedback, which
// imports the request helpers from this same module - so the mock has to carry
// them, or the first thing to touch one finds nothing there.
vi.mock("~/composables/auth", () => ({
  useAuthState: () => ({ user: ref({ uid: "me" }) }),
  authRequest: vi.fn(),
  anonymousRequest: vi.fn(),
}));

vi.mock("~/composables/qa", () => ({
  useQaChecks: () => ({
    items,
    checks: ref(checks),
    pending: ref(false),
    loaded,
    load,
    stateOf: (itemId: string) => states[itemId]!,
    reportedByOthers: (itemId: string) => itemId === "done-thing",
    counts: computed(() => ({ unchecked: 1, ok: 1, issue: 1 })),
    checksFor: (itemId: string) =>
      checks.filter((check) => check.itemId === itemId),
    myCheck: (itemId: string) =>
      checks.find(
        (check) => check.itemId === itemId && check.userUid === "me",
      ) ?? null,
    saveCheck,
    loadAdminResolutions,
    adminResolution: (itemId: string) => resolutions[itemId] ?? null,
    awaitingAcceptance: (itemId: string) => itemId === "broken-thing",
    acceptResolution,
  }),
}));

const mountPage = () =>
  mountSuspended(QaPage, { global: { plugins: [vuetify] } });

beforeEach(() => {
  vi.clearAllMocks();
  loaded.value = true;
});

describe("QA page", () => {
  it("opens on what nobody has checked yet", async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("Nowa rzecz");
    expect(wrapper.text()).not.toContain("Sprawdzona rzecz");
    expect(wrapper.text()).not.toContain("Zepsuta rzecz");
  });

  it("loads the verdicts when it opens", async () => {
    await mountPage();
    expect(load).toHaveBeenCalled();
  });

  it("says nothing about an entry until the stored verdicts are in", async () => {
    loaded.value = false;
    const wrapper = await mountPage();

    // Rendering the list first would show every entry as unchecked, including
    // the ones this reader has already been through.
    expect(wrapper.text()).not.toContain("Nowa rzecz");
    expect(wrapper.text()).not.toContain("Wszystko sprawdzone");
    expect(wrapper.find(".v-progress-linear").exists()).toBe(true);
  });

  it("lists reported problems separately, and everything on demand", async () => {
    const wrapper = await mountPage();

    const button = (label: string) =>
      wrapper.findAll("button").find((b) => b.text().startsWith(label))!;

    await button("Problemy").trigger("click");
    expect(wrapper.text()).toContain("Zepsuta rzecz");
    expect(wrapper.text()).not.toContain("Nowa rzecz");

    await button("Wszystkie").trigger("click");
    expect(wrapper.text()).toContain("Sprawdzona rzecz");
    expect(wrapper.text()).toContain("Nowa rzecz");
  });

  it("flags an entry somebody else has reported, without checking it off", async () => {
    const wrapper = await mountPage();

    const all = wrapper
      .findAll("button")
      .find((b) => b.text().startsWith("Wszystkie"))!;
    await all.trigger("click");

    expect(wrapper.text()).toContain("Ktoś zgłosił problem");
  });

  it("asks what the team did with this reader's reports when it opens", async () => {
    await mountPage();
    // Separate from `load`, and failing separately: the verdicts are the page,
    // this is an addition to it.
    expect(loadAdminResolutions).toHaveBeenCalled();
  });

  it("says on the way in that something was closed", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("admin uznał sprawę za zamkniętą");
  });

  it("passes a closed report down to its card", async () => {
    const wrapper = await mountPage();
    const problems = wrapper
      .findAll("button")
      .find((b) => b.text().startsWith("Problemy"))!;
    await problems.trigger("click");

    expect(wrapper.text()).toContain("Admin: Załatwione");
    expect(wrapper.text()).toContain("oznaczyliśmy go jako załatwiony");
    // The entry nobody closed says nothing of the sort.
    const all = wrapper
      .findAll("button")
      .find((b) => b.text().startsWith("Wszystkie"))!;
    await all.trigger("click");
    expect(wrapper.text().match(/Admin: /g)).toHaveLength(1);
  });

  it("accepts a closure through the composable", async () => {
    const wrapper = await mountPage();
    const problems = wrapper
      .findAll("button")
      .find((b) => b.text().startsWith("Problemy"))!;
    await problems.trigger("click");

    const accept = wrapper
      .findAll("button")
      .find((b) => b.text() === "Przyjmuję")!;
    await accept.trigger("click");

    expect(acceptResolution).toHaveBeenCalledWith("broken-thing");
    expect(saveCheck).not.toHaveBeenCalled();
  });

  it("sends a repeated report the ordinary way", async () => {
    const wrapper = await mountPage();
    const problems = wrapper
      .findAll("button")
      .find((b) => b.text().startsWith("Problemy"))!;
    await problems.trigger("click");

    const again = wrapper
      .findAll("button")
      .find((b) => b.text() === "Nadal nie działa")!;
    await again.trigger("click");

    // Nothing special about it downstream - it is the same verdict the card
    // has always emitted, and the composable decides whether it is news.
    expect(saveCheck).toHaveBeenCalledWith("broken-thing", "issue", "");
  });

  it("saves the verdict a card reports", async () => {
    const wrapper = await mountPage();

    await wrapper.find("textarea").setValue("działa u mnie");
    const ok = wrapper.findAll("button").find((b) => b.text() === "Działa")!;
    await ok.trigger("click");

    expect(saveCheck).toHaveBeenCalledWith("new-thing", "ok", "działa u mnie");
  });
});
