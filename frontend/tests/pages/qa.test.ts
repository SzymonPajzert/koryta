import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, nextTick, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import QaPage from "../../app/pages/qa.vue";
import type { QaCheck, QaItem, QaItemState } from "../../shared/qa";

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
const loaded = ref(true);

vi.mock("~/composables/auth", () => ({
  useAuthState: () => ({ user: ref({ uid: "me" }) }),
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
  }),
}));

/** Every wrapper this file has mounted. The page watches the route hash, and
 * each mount navigates, so a page left mounted would react to the next test's
 * route - and scroll the next test's card. */
const mounted: { unmount: () => void }[] = [];

const mountPage = async (route = "/") => {
  const wrapper = await mountSuspended(QaPage, {
    route,
    // In the document, so the page can find the card it scrolls to by id.
    attachTo: document.body,
    global: { plugins: [vuetify] },
  });
  mounted.push(wrapper);
  return wrapper;
};

/** The ids of the elements the page scrolled into view, in order. */
const scrolled: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  loaded.value = true;
  scrolled.length = 0;
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element,
  ) {
    scrolled.push(this.id);
  });
});

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
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

  it("saves the verdict a card reports", async () => {
    const wrapper = await mountPage();

    await wrapper.find("textarea").setValue("działa u mnie");
    const ok = wrapper.findAll("button").find((b) => b.text() === "Działa")!;
    await ok.trigger("click");

    expect(saveCheck).toHaveBeenCalledWith("new-thing", "ok", "działa u mnie");
  });

  describe("a link to one entry", () => {
    type Wrapper = Awaited<ReturnType<typeof mountPage>>;

    /** The label of the filter that is on. */
    const activeFilter = (wrapper: Wrapper) =>
      wrapper.get(".v-btn-toggle .v-btn--active").text();

    /** Opens the page the way a link from /admin/opinie or Slack does: the
     * hash is there from the start, the verdicts arrive after. */
    const follow = async (hash: string) => {
      loaded.value = false;
      const wrapper = await mountPage(`/${hash}`);
      loaded.value = true;
      await flushPromises();
      await nextTick();
      return wrapper;
    };

    it("switches to every entry for one this reader has already checked", async () => {
      const wrapper = await follow("#qa-done-thing");

      // "Do sprawdzenia" does not render it, so there would be nothing to
      // scroll to.
      expect(activeFilter(wrapper)).toBe("Wszystkie");
      expect(wrapper.find('[data-qa-item="done-thing"]').exists()).toBe(true);
      expect(scrolled).toEqual(["qa-done-thing"]);
    });

    it("waits for the verdicts before choosing the filter", async () => {
      loaded.value = false;
      const wrapper = await mountPage("/#qa-done-thing");

      // No card is rendered until then, and nothing is known about which ones
      // this reader has checked.
      expect(scrolled).toEqual([]);
      expect(activeFilter(wrapper)).toMatch(/^Do sprawdzenia/);
    });

    it("shows the entry when the verdicts were in before the page opened", async () => {
      // Back from /admin/opinie, which loads them too.
      const wrapper = await mountPage("/#qa-done-thing");

      expect(activeFilter(wrapper)).toBe("Wszystkie");
      expect(wrapper.find('[data-qa-item="done-thing"]').exists()).toBe(true);
      // Not the scroll: mountSuspended's async setup puts the page in the
      // document after the tick the page waits for, which a router-rendered
      // page does not.
    });

    it("keeps the default filter when it already shows the entry", async () => {
      const wrapper = await follow("#qa-new-thing");

      expect(activeFilter(wrapper)).toMatch(/^Do sprawdzenia/);
      expect(scrolled).toEqual(["qa-new-thing"]);
    });

    it("ignores a hash that names no entry", async () => {
      const wrapper = await follow("#qa-gone");

      expect(activeFilter(wrapper)).toMatch(/^Do sprawdzenia/);
      expect(wrapper.find('[data-qa-item="done-thing"]').exists()).toBe(false);
      expect(scrolled).toEqual([]);
    });

    it("follows a hash that changes while the page is open", async () => {
      const wrapper = await mountPage();
      expect(activeFilter(wrapper)).toMatch(/^Do sprawdzenia/);

      await useRouter().push({ path: "/", hash: "#qa-done-thing" });
      await flushPromises();
      await nextTick();

      expect(activeFilter(wrapper)).toBe("Wszystkie");
      expect(scrolled).toEqual(["qa-done-thing"]);
    });
  });
});
