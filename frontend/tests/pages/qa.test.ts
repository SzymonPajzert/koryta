import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import QaPage from "../../app/pages/qa.vue";
import type { Feedback, FeedbackStatus } from "../../shared/model";
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

const saveCheck = vi.fn(
  async (): Promise<{ reported: boolean; forwarded: boolean }> => ({
    reported: false,
    forwarded: false,
  }),
);
const load = vi.fn(async (_force?: boolean) => undefined);
const loaded = ref(true);
const isAdmin = ref(false);
const authRequest = vi.fn();

vi.mock("~/composables/auth", () => ({
  useAuthState: () => ({ user: ref({ uid: "me" }), isAdmin }),
  authRequest: (...args: unknown[]) => authRequest(...args),
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

/** Renders what the page tells a snackbar, in place: the real one is an
 * overlay teleported out of the wrapper and closed on a timer. */
const SnackbarStub = defineComponent({
  props: { modelValue: Boolean },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h("div", { "data-snackbar": "" }, slots.default?.())
        : null;
  },
});

/** Every wrapper this file has mounted. The page watches the route hash, and
 * each mount navigates, so a page left mounted would react to the next test's
 * route - and scroll the next test's row. */
const mounted: { unmount: () => void }[] = [];

const mountPage = async (route = "/") => {
  const wrapper = await mountSuspended(QaPage, {
    route,
    // In the document, so the page can find the row it scrolls to by id.
    attachTo: document.body,
    global: {
      plugins: [vuetify],
      stubs: { UserChip: true, VSnackbar: SnackbarStub },
    },
  });
  mounted.push(wrapper);
  return wrapper;
};

type Wrapper = Awaited<ReturnType<typeof mountPage>>;

/** The ids of the elements the page scrolled into view, in order. */
const scrolled: string[] = [];

const button = (wrapper: Pick<Wrapper, "findAll">, label: string) =>
  wrapper.findAll("button").find((b) => b.text().startsWith(label))!;

/** The filter chip that is on. */
const activeFilter = (wrapper: Wrapper) =>
  wrapper.get('[data-filter][aria-pressed="true"]').text();

const isOpen = (wrapper: Wrapper, rowId: string) =>
  wrapper.get(`#${rowId}`).find("[data-row-panel]").exists();

const listCalls = () =>
  authRequest.mock.calls.filter(([url]) => url === "/api/feedback/list");

beforeEach(() => {
  vi.clearAllMocks();
  loaded.value = true;
  isAdmin.value = false;
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
    // One line each, until one is asked for.
    expect(wrapper.find("[data-row-panel]").exists()).toBe(false);
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

    await button(wrapper, "Problemy").trigger("click");
    expect(wrapper.text()).toContain("Zepsuta rzecz");
    expect(wrapper.text()).not.toContain("Nowa rzecz");

    await button(wrapper, "Wszystkie").trigger("click");
    expect(wrapper.text()).toContain("Sprawdzona rzecz");
    expect(wrapper.text()).toContain("Nowa rzecz");
  });

  it("flags an entry somebody else has reported, without checking it off", async () => {
    const wrapper = await mountPage();

    await button(wrapper, "Wszystkie").trigger("click");

    expect(wrapper.text()).toContain("Ktoś zgłosił problem");
  });

  it("saves the verdict a row reports", async () => {
    const wrapper = await mountPage();

    await wrapper.get("#qa-new-thing [data-row-toggle]").trigger("click");
    await wrapper.find("textarea").setValue("działa u mnie");
    const ok = wrapper.findAll("button").find((b) => b.text() === "Działa")!;
    await ok.trigger("click");

    expect(saveCheck).toHaveBeenCalledWith("new-thing", "ok", "działa u mnie");
  });

  it("does not call a problem saved again 'działa'", async () => {
    // The same verdict with the same words is not sent again - which used to
    // be announced as "Zapisane: działa", on a problem.
    const wrapper = await mountPage();

    await wrapper.get("#qa-new-thing [data-row-toggle]").trigger("click");
    const issue = wrapper
      .findAll("button")
      .find((b) => b.text() === "Coś nie działa")!;
    await issue.trigger("click");
    await flushPromises();

    const said = wrapper.get("[data-snackbar]").text();
    expect(said).toBe("Zapisane. Bez zmian, więc nie wysłano ponownie.");
    expect(said).not.toContain("działa");
  });

  describe("Problemy", () => {
    /** A report filed from /qa, as the list endpoint returns it. */
    const report = (
      id: string,
      adminStatus: FeedbackStatus,
      fields: Partial<Feedback> = {},
    ): Feedback => ({
      id,
      kind: "bug",
      message: `zgłoszenie ${id}`,
      createdAt: "2026-09-20T10:00:00.000Z",
      adminStatus,
      userUid: "other",
      context: {
        route: "/qa",
        qa: { itemId: "broken-thing", title: "Zepsuta rzecz", status: "issue" },
      },
      ...fields,
    });

    /** Open and closed reports from /qa, one queued, and one sent with the
     * "Zgłoś" button. */
    const reports = (): Feedback[] => [
      report("qa-open", "new"),
      report("qa-queued", "in_progress", { queueRank: 1024 }),
      report("qa-closed", "resolved"),
      report("plain", "new", {
        context: { route: "/", pageTitle: "Koryta.pl" },
      }),
      report("plain-queued", "new", {
        queueRank: 2048,
        context: { route: "/", pageTitle: "Koryta.pl" },
      }),
    ];

    const serveReports = () =>
      authRequest.mockImplementation(
        async (_url: string, opts: { method: string }) =>
          opts.method === "GET"
            ? { feedback: reports().map((item) => structuredClone(item)) }
            : { ok: true },
      );

    const reportIds = (wrapper: Wrapper) =>
      wrapper
        .findAll("[data-report-row]")
        .map((node) => node.attributes("data-feedback-id"));

    const sections = (wrapper: Wrapper) =>
      wrapper
        .findAll("[data-section]")
        .map((node) => node.attributes("data-section"));

    const openProblems = async (wrapper: Wrapper) => {
      await button(wrapper, "Problemy").trigger("click");
      await flushPromises();
    };

    it("shows a reader the entries they reported, and never asks for the team's reports", async () => {
      serveReports();
      const wrapper = await mountPage();

      // Their own count, as it always was.
      expect(button(wrapper, "Problemy").text()).toMatch(/^Problemy\s*1$/);
      await openProblems(wrapper);

      expect(sections(wrapper)).toEqual(["my-issues"]);
      expect(wrapper.text()).toContain("Twoje zgłoszone problemy");
      expect(wrapper.get("[data-qa-item]").attributes("data-qa-item")).toBe(
        "broken-thing",
      );
      expect(wrapper.text()).not.toContain("Zgłoszenia z QA");
      // The list is admin-only: asking would be a 403 at best.
      expect(authRequest).not.toHaveBeenCalled();
    });

    it("gives an admin every open report from the list above their own", async () => {
      isAdmin.value = true;
      serveReports();
      const wrapper = await mountPage();

      // Not read for the default tab: nothing there needs it.
      expect(listCalls()).toHaveLength(0);
      // Not known yet, so not counted.
      expect(button(wrapper, "Problemy").text()).toBe("Problemy");

      await openProblems(wrapper);

      expect(listCalls()).toHaveLength(1);
      expect(sections(wrapper)).toEqual(["qa-reports", "my-issues"]);
      // Open ones only, from /qa only, in the order the panel has them: not
      // placed yet first, then the queue.
      expect(reportIds(wrapper)).toEqual(["qa-open", "qa-queued"]);
      expect(button(wrapper, "Problemy").text()).toMatch(/^Problemy\s*2$/);
      // The place in the whole queue, "Zgłoś" reports included.
      expect(wrapper.get("#fb-qa-queued [data-queue-position]").text()).toBe(
        "#1",
      );
      // And the entry this admin reported themselves, as for anybody.
      expect(wrapper.find('[data-qa-item="broken-thing"]').exists()).toBe(true);

      const all = wrapper
        .findAllComponents({ name: "NuxtLink" })
        .find((link) => link.text() === "Wszystkie w panelu zgłoszeń");
      expect(all?.props("to")).toBe("/admin/opinie?zrodlo=qa");

      // Asked for once, not on every visit to the tab.
      await button(wrapper, "Wszystkie").trigger("click");
      await openProblems(wrapper);
      expect(listCalls()).toHaveLength(1);
    });

    it("lets an admin triage a report where it is", async () => {
      isAdmin.value = true;
      serveReports();
      const wrapper = await mountPage();
      await openProblems(wrapper);

      // To the end of the whole queue, from the line.
      await wrapper
        .get('#fb-qa-open button[aria-label="Do kolejki"]')
        .trigger("click");
      await flushPromises();
      const posts = () =>
        authRequest.mock.calls.filter(([, opts]) => opts.method === "POST");
      expect(posts()).toHaveLength(1);
      expect(posts()[0]![1].body.id).toBe("qa-open");
      expect(posts()[0]![1].body.queueRank).toBeGreaterThan(2048);
      expect(wrapper.get("#fb-qa-open [data-queue-position]").text()).toBe(
        "#3",
      );

      // The status, from the open row.
      await wrapper.get("#fb-qa-open [data-row-toggle]").trigger("click");
      expect(isOpen(wrapper, "fb-qa-open")).toBe(true);
      wrapper
        .get("#fb-qa-open")
        .findComponent({ name: "VSelect" })
        .vm.$emit("update:modelValue", "resolved");
      await flushPromises();

      expect(posts()[1]![1].body).toEqual({
        id: "qa-open",
        adminStatus: "resolved",
      });
      // Closed, and still there until the next load, as on /admin/opinie.
      expect(wrapper.get("#fb-qa-open").classes()).toContain("arow--dimmed");
    });
  });

  describe("a link to one entry", () => {
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
      // Open: the link was followed to read it.
      expect(isOpen(wrapper, "qa-done-thing")).toBe(true);
      expect(isOpen(wrapper, "qa-new-thing")).toBe(false);
    });

    it("waits for the verdicts before choosing the filter", async () => {
      loaded.value = false;
      const wrapper = await mountPage("/#qa-done-thing");

      // No row is rendered until then, and nothing is known about which ones
      // this reader has checked.
      expect(scrolled).toEqual([]);
      expect(activeFilter(wrapper)).toMatch(/^Do sprawdzenia/);
    });

    it("shows the entry when the verdicts were in before the page opened", async () => {
      // Back from /admin/opinie, which loads them too.
      const wrapper = await mountPage("/#qa-done-thing");

      expect(activeFilter(wrapper)).toBe("Wszystkie");
      expect(wrapper.find('[data-qa-item="done-thing"]').exists()).toBe(true);
      expect(isOpen(wrapper, "qa-done-thing")).toBe(true);
      // Not the scroll: mountSuspended's async setup puts the page in the
      // document after the tick the page waits for, which a router-rendered
      // page does not.
    });

    it("keeps the default filter when it already shows the entry", async () => {
      const wrapper = await follow("#qa-new-thing");

      expect(activeFilter(wrapper)).toMatch(/^Do sprawdzenia/);
      expect(scrolled).toEqual(["qa-new-thing"]);
      expect(isOpen(wrapper, "qa-new-thing")).toBe(true);
    });

    it("ignores a hash that names no entry", async () => {
      const wrapper = await follow("#qa-gone");

      expect(activeFilter(wrapper)).toMatch(/^Do sprawdzenia/);
      expect(wrapper.find('[data-qa-item="done-thing"]').exists()).toBe(false);
      expect(wrapper.find("[data-row-panel]").exists()).toBe(false);
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
      expect(isOpen(wrapper, "qa-done-thing")).toBe(true);
    });
  });
});
