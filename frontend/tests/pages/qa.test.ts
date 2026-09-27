import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  onTestFinished,
} from "vitest";
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

/** Reports that a change with no QA entry says it fixes - one still open when
 * served below, one already closed. */
const { FIXED_OPEN, FIXED_CLOSED } = vi.hoisted(() => ({
  FIXED_OPEN: "FixedOpen00000000001",
  FIXED_CLOSED: "FixedClosed000000001",
}));

vi.mock("../../shared/reportFixes", () => ({
  REPORT_FIXES: [
    {
      change: "Wykres nie nachodzi już na tabelę.",
      fixes: [FIXED_OPEN, FIXED_CLOSED],
      link: "/osoba/jan",
    },
  ],
}));

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

/** Once the page is on `label`'s tab and has done what it does there: it
 * reads the tab back from the url, and the router navigates asynchronously. */
const settlesOn = async (wrapper: Wrapper, label: string) => {
  await vi.waitUntil(() => activeFilter(wrapper).startsWith(label), {
    timeout: 2000,
  });
  await flushPromises();
  await nextTick();
};

/** Picks a tab by its chip. */
const pick = async (wrapper: Wrapper, label: string) => {
  await button(wrapper, label).trigger("click");
  await settlesOn(wrapper, label);
};

const isOpen = (wrapper: Wrapper, rowId: string) =>
  wrapper.get(`#${rowId}`).find("[data-row-panel]").exists();

const listCalls = () =>
  authRequest.mock.calls.filter(([url]) => url === "/api/feedback/list");

/** Serves the reports `serving()` names when asked, and holds every read after
 * the first until the function returned is called - so a test can look at the
 * page while it reads the list again. */
const holdRereads = (serving: () => Feedback[]) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  authRequest.mockImplementation(
    async (_url: string, opts: { method: string }) => {
      if (opts.method !== "GET") return { ok: true };
      if (listCalls().length > 1) await held;
      return { feedback: serving().map((item) => structuredClone(item)) };
    },
  );
  return () => release();
};

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
    // The team's reports are an admin's; nobody else's page asks for them.
    expect(wrapper.find("[data-section]").exists()).toBe(false);
    expect(authRequest).not.toHaveBeenCalled();
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

    await pick(wrapper, "Problemy");
    expect(wrapper.text()).toContain("Zepsuta rzecz");
    expect(wrapper.text()).not.toContain("Nowa rzecz");

    await pick(wrapper, "Wszystkie");
    expect(wrapper.text()).toContain("Sprawdzona rzecz");
    expect(wrapper.text()).toContain("Nowa rzecz");
  });

  it("flags an entry somebody else has reported, without checking it off", async () => {
    const wrapper = await mountPage();

    await pick(wrapper, "Wszystkie");

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
     * "Zgłoś" button. The open one not in the queue is this reader's own,
     * about the entry they flagged. */
    const reports = (): Feedback[] => [
      report("qa-open", "new", { userUid: "me" }),
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

    const serveReports = (served = reports()) =>
      authRequest.mockImplementation(
        async (_url: string, opts: { method: string }) =>
          opts.method === "GET"
            ? { feedback: served.map((item) => structuredClone(item)) }
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

    const openProblems = (wrapper: Wrapper) => pick(wrapper, "Problemy");

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
      // The entry is here, with its buttons.
      expect(wrapper.get("[data-issue-banner]").text()).toContain(
        "dopóki nie napiszesz, że już działa",
      );
      expect(wrapper.text()).not.toContain("Zgłoszenia z QA");
      // The list is admin-only: asking would be a 403 at best.
      expect(authRequest).not.toHaveBeenCalled();
    });

    it("gives an admin every open report from the list, their own problems as the reports they are", async () => {
      isAdmin.value = true;
      serveReports();
      const wrapper = await mountPage();
      await flushPromises();

      // Read as soon as the page knows it has an admin - the tab it opens on
      // lists the reports this build says it fixes - so this tab is counted
      // before it is opened.
      expect(listCalls()).toHaveLength(1);
      expect(button(wrapper, "Problemy").text()).toMatch(/^Problemy\s*2$/);

      await openProblems(wrapper);

      expect(listCalls()).toHaveLength(1);
      // One list: the entry this admin flagged went out as "qa-open", and is
      // that row rather than a second one under it.
      expect(sections(wrapper)).toEqual(["qa-reports"]);
      expect(wrapper.find("[data-qa-item]").exists()).toBe(false);
      // Open ones only, from /qa only, in the order the panel has them: not
      // placed yet first, then the queue.
      expect(reportIds(wrapper)).toEqual(["qa-open", "qa-queued"]);
      expect(wrapper.get("#fb-qa-open").text()).toContain("QA: Zepsuta rzecz");
      expect(button(wrapper, "Problemy").text()).toMatch(/^Problemy\s*2$/);
      // The place in the whole queue, "Zgłoś" reports included.
      expect(wrapper.get("#fb-qa-queued [data-queue-position]").text()).toBe(
        "#1",
      );

      const all = wrapper
        .findAllComponents({ name: "NuxtLink" })
        .find((link) => link.text() === "Wszystkie w panelu zgłoszeń");
      expect(all?.props("to")).toBe("/admin/opinie?zrodlo=qa");

      // Asked for once, not on every visit to the tab.
      await pick(wrapper, "Wszystkie");
      await openProblems(wrapper);
      expect(listCalls()).toHaveLength(1);
    });

    // The report's row has no "Działa" to press, so the banner cannot send
    // them to one.
    it("tells an admin where to say a problem shown as its report works", async () => {
      isAdmin.value = true;
      serveReports();
      const wrapper = await mountPage();
      await flushPromises();
      const banner = () => wrapper.get("[data-issue-banner]").text();

      // On any other tab the entries are the rows, as for anybody.
      expect(banner()).toContain("dopóki nie napiszesz, że już działa");

      await openProblems(wrapper);
      expect(banner()).toContain("jest tym zgłoszeniem");
      expect(banner()).toContain("do którego prowadzi „QA: …”");
      expect(banner()).not.toContain("dopóki nie napiszesz");
    });

    // /qa?widok=problemy#qa-… lands on a tab that does not list the entry.
    it("lands a link to an admin's own problem on the entry, not on its report", async () => {
      isAdmin.value = true;
      serveReports();
      const wrapper = await mountPage("/?widok=problemy");
      await flushPromises();
      expect(wrapper.find('[data-qa-item="broken-thing"]').exists()).toBe(
        false,
      );

      await useRouter().push({
        path: "/",
        query: { widok: "problemy" },
        hash: "#qa-broken-thing",
      });
      await settlesOn(wrapper, "Wszystkie");

      expect(scrolled).toEqual(["qa-broken-thing"]);
      expect(isOpen(wrapper, "qa-broken-thing")).toBe(true);
      expect(useRouter().currentRoute.value.hash).toBe("#qa-broken-thing");
    });

    it("keeps an admin's problem whose report was closed, as the entry, under the reports", async () => {
      isAdmin.value = true;
      // Their report about it is settled; somebody else's is still open.
      serveReports([
        report("qa-closed-mine", "resolved", { userUid: "me" }),
        report("qa-open-theirs", "new"),
      ]);
      const wrapper = await mountPage();
      await openProblems(wrapper);

      expect(sections(wrapper)).toEqual(["qa-reports", "my-issues"]);
      expect(reportIds(wrapper)).toEqual(["qa-open-theirs"]);
      expect(wrapper.text()).toContain(
        "Twoje problemy bez otwartego zgłoszenia",
      );
      expect(wrapper.find('[data-qa-item="broken-thing"]').exists()).toBe(true);
      // Somebody else's report does not stand for this admin's verdict.
      expect(button(wrapper, "Problemy").text()).toMatch(/^Problemy\s*2$/);
    });

    it("reads the reports again once a problem found here has gone out, and shows it as one", async () => {
      isAdmin.value = true;
      serveReports([report("qa-open-theirs", "new")]);
      const wrapper = await mountPage();
      await openProblems(wrapper);
      // Nothing of theirs is open yet, so the entry stands for itself.
      expect(wrapper.find('[data-qa-item="broken-thing"]').exists()).toBe(true);

      saveCheck.mockResolvedValueOnce({ reported: true, forwarded: true });
      serveReports([
        report("qa-open-theirs", "new"),
        report("qa-mine", "new", { userUid: "me" }),
      ]);
      await wrapper.get("#qa-broken-thing [data-row-toggle]").trigger("click");
      await button(wrapper.get("#qa-broken-thing"), "Coś nie działa").trigger(
        "click",
      );
      await flushPromises();

      // Left alone, the entry would go on saying the team was never told.
      expect(listCalls()).toHaveLength(2);
      expect(reportIds(wrapper)).toContain("qa-mine");
      expect(wrapper.find("[data-qa-item]").exists()).toBe(false);
    });

    it("keeps the list on screen while it reads it again, and a note typed in another row with it", async () => {
      isAdmin.value = true;
      // A second problem of theirs no report stands for, to write in.
      states["new-thing"] = "issue";
      onTestFinished(() => {
        states["new-thing"] = "unchecked";
      });
      let served = [report("qa-open-theirs", "new")];
      const release = holdRereads(() => served);
      const wrapper = await mountPage();
      await openProblems(wrapper);
      const note = () =>
        wrapper.get<HTMLTextAreaElement>("#qa-new-thing textarea").element
          .value;

      await wrapper.get("#qa-new-thing [data-row-toggle]").trigger("click");
      await wrapper
        .get("#qa-new-thing textarea")
        .setValue("wciąż się nie ładuje");

      // The other one goes out as a report, and the list is read again.
      saveCheck.mockResolvedValueOnce({ reported: true, forwarded: true });
      served = [
        report("qa-open-theirs", "new"),
        report("qa-mine", "new", { userUid: "me" }),
      ];
      await wrapper.get("#qa-broken-thing [data-row-toggle]").trigger("click");
      await button(wrapper.get("#qa-broken-thing"), "Coś nie działa").trigger(
        "click",
      );
      await flushPromises();
      expect(listCalls()).toHaveLength(2);

      // Until it is in, everything stays as it was: no progress bar in place
      // of the rows, and the note is still there to be sent.
      expect(wrapper.find("[data-reports-loading]").exists()).toBe(false);
      expect(reportIds(wrapper)).toEqual(["qa-open-theirs"]);
      expect(sections(wrapper)).toEqual(["qa-reports", "my-issues"]);
      expect(note()).toBe("wciąż się nie ładuje");
      expect(button(wrapper, "Problemy").text()).toMatch(/^Problemy\s*3$/);

      release();
      await flushPromises();

      // Then the new report stands for its entry, and the row being written
      // in was never taken down.
      expect(reportIds(wrapper)).toContain("qa-mine");
      expect(wrapper.find('[data-qa-item="broken-thing"]').exists()).toBe(
        false,
      );
      expect(note()).toBe("wciąż się nie ładuje");
    });

    it("does not ask a reader's page for the reports after a problem goes out", async () => {
      saveCheck.mockResolvedValueOnce({ reported: true, forwarded: true });
      const wrapper = await mountPage();
      await openProblems(wrapper);

      await wrapper.get("#qa-broken-thing [data-row-toggle]").trigger("click");
      await button(wrapper.get("#qa-broken-thing"), "Coś nie działa").trigger(
        "click",
      );
      await flushPromises();

      expect(saveCheck).toHaveBeenCalled();
      expect(authRequest).not.toHaveBeenCalled();
    });

    it("lists none of an admin's own entries until the reports are in", async () => {
      isAdmin.value = true;
      authRequest.mockImplementation(() => new Promise(() => {}));
      const wrapper = await mountPage();
      await openProblems(wrapper);

      // Showing all of them first and taking them away when the reports
      // arrive would be a flicker.
      expect(wrapper.find("[data-qa-item]").exists()).toBe(false);
      expect(sections(wrapper)).toEqual(["qa-reports"]);
      expect(wrapper.find("[data-reports-loading]").exists()).toBe(true);
    });

    it("falls back to an admin's own entries when the reports do not load", async () => {
      isAdmin.value = true;
      authRequest.mockRejectedValue(new Error("403"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const wrapper = await mountPage();
      await openProblems(wrapper);

      expect(sections(wrapper)).toEqual(["qa-reports", "my-issues"]);
      expect(wrapper.text()).toContain("Nie udało się wczytać zgłoszeń.");
      expect(wrapper.text()).toContain("Twoje zgłoszone problemy");
      expect(wrapper.find('[data-qa-item="broken-thing"]').exists()).toBe(true);
      expect(wrapper.get("[data-issue-banner]").text()).toContain(
        "dopóki nie napiszesz, że już działa",
      );
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

  describe("Zgłoszenia do zamknięcia", () => {
    const report = (
      id: string,
      adminStatus: FeedbackStatus,
      context: Feedback["context"] = { route: "/osoba/jan", pageTitle: "Jan" },
    ): Feedback => ({
      id,
      kind: "bug",
      message: `zgłoszenie ${id}`,
      createdAt: "2026-09-20T10:00:00.000Z",
      adminStatus,
      userUid: "other",
      context,
    });

    const serve = (served: Feedback[]) =>
      authRequest.mockImplementation(
        async (_url: string, opts: { method: string }) =>
          opts.method === "GET"
            ? { feedback: served.map((item) => structuredClone(item)) }
            : { ok: true },
      );

    const mountAdmin = async () => {
      isAdmin.value = true;
      const wrapper = await mountPage();
      await flushPromises();
      return wrapper;
    };

    it("opens an admin's page on the open reports this build says it fixes", async () => {
      serve([
        report(FIXED_OPEN, "new"),
        report(FIXED_CLOSED, "resolved"),
        report("unclaimed", "new"),
        report("from-qa", "new", {
          route: "/qa",
          qa: {
            itemId: "broken-thing",
            title: "Zepsuta rzecz",
            status: "issue",
          },
        }),
      ]);
      const wrapper = await mountAdmin();

      expect(
        wrapper
          .findAll("[data-section]")
          .map((n) => n.attributes("data-section")),
      ).toEqual(["fixed-reports", "my-unchecked"]);
      // Open and claimed only: not the closed one, nor anything unclaimed.
      expect(
        wrapper
          .findAll("[data-report-row]")
          .map((n) => n.attributes("data-feedback-id")),
      ).toEqual([FIXED_OPEN]);
      // The line says a fix is waiting to be checked.
      expect(
        wrapper.find(`#fb-${FIXED_OPEN} [data-fix-state-icon]`).exists(),
      ).toBe(true);
      // And the reader's own entries follow, as for anybody.
      expect(wrapper.text()).toContain("Nowa rzecz");
    });

    it("says what changed and where to look, and closes the report from there", async () => {
      serve([report(FIXED_OPEN, "new")]);
      const wrapper = await mountAdmin();

      await wrapper.get(`#fb-${FIXED_OPEN} [data-row-toggle]`).trigger("click");
      const change = wrapper.get(`#fb-${FIXED_OPEN} [data-fix-change]`);
      expect(change.text()).toContain("Wykres nie nachodzi już na tabelę.");
      const where = change.findComponent({ name: "VChip" });
      expect(where.text()).toBe("Gdzie sprawdzić");
      expect(where.props("to")).toBe("/osoba/jan");
      // No QA entry claims it, so there is no entry's chip to open.
      expect(wrapper.find(`#fb-${FIXED_OPEN} [data-fix-state]`).exists()).toBe(
        false,
      );

      await button(
        wrapper.get(`#fb-${FIXED_OPEN}`),
        "Zamknij jako załatwione",
      ).trigger("click");
      await flushPromises();

      const posts = authRequest.mock.calls.filter(
        ([, opts]) => opts.method === "POST",
      );
      expect(posts.map(([, opts]) => opts.body)).toEqual([
        { id: FIXED_OPEN, adminStatus: "resolved" },
      ]);
      // Closed, and still there until the next load, as on /admin/opinie.
      expect(wrapper.get(`#fb-${FIXED_OPEN}`).classes()).toContain(
        "arow--dimmed",
      );
    });

    it("keeps the reports to close on screen while a verdict's report is read in", async () => {
      const release = holdRereads(() => [report(FIXED_OPEN, "new")]);
      saveCheck.mockResolvedValueOnce({ reported: true, forwarded: true });
      const wrapper = await mountAdmin();

      await wrapper.get("#qa-new-thing [data-row-toggle]").trigger("click");
      await button(wrapper.get("#qa-new-thing"), "Coś nie działa").trigger(
        "click",
      );
      await flushPromises();
      expect(listCalls()).toHaveLength(2);

      expect(wrapper.find("[data-reports-loading]").exists()).toBe(false);
      expect(wrapper.find(`#fb-${FIXED_OPEN}`).exists()).toBe(true);

      release();
      await flushPromises();
      expect(wrapper.find(`#fb-${FIXED_OPEN}`).exists()).toBe(true);
    });

    it("says so when nothing it claims is still open", async () => {
      serve([report(FIXED_CLOSED, "resolved")]);
      const wrapper = await mountAdmin();

      expect(wrapper.find("[data-report-row]").exists()).toBe(false);
      expect(wrapper.text()).toContain(
        "Żadne otwarte zgłoszenie nie czeka na sprawdzenie poprawki.",
      );
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
      await settlesOn(wrapper, "Wszystkie");

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
      await settlesOn(wrapper, "Wszystkie");

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
      await settlesOn(wrapper, "Wszystkie");

      expect(activeFilter(wrapper)).toBe("Wszystkie");
      expect(scrolled).toEqual(["qa-done-thing"]);
      expect(isOpen(wrapper, "qa-done-thing")).toBe(true);
    });

    it("keeps the hash in the url when it changes the tab to show the entry", async () => {
      const wrapper = await follow("#qa-done-thing");
      await settlesOn(wrapper, "Wszystkie");

      expect(useRouter().currentRoute.value.query.widok).toBe("wszystkie");
      expect(useRouter().currentRoute.value.hash).toBe("#qa-done-thing");
    });

    // "QA: …" on a report in "Problemy" links to the entry without `?widok`,
    // so the tab and the hash change at once.
    it("lands on an entry linked from another tab", async () => {
      const wrapper = await mountPage("/?widok=problemy");
      expect(activeFilter(wrapper)).toMatch(/^Problemy/);

      await useRouter().push({ path: "/", hash: "#qa-broken-thing" });
      await settlesOn(wrapper, "Wszystkie");

      expect(activeFilter(wrapper)).toBe("Wszystkie");
      expect(scrolled).toEqual(["qa-broken-thing"]);
      expect(isOpen(wrapper, "qa-broken-thing")).toBe(true);
    });
  });

  describe("the tab in the url", () => {
    const currentQuery = () => useRouter().currentRoute.value.query;

    it("opens on the tab the url names", async () => {
      const wrapper = await mountPage("/?widok=problemy");

      expect(activeFilter(wrapper)).toMatch(/^Problemy/);
      expect(wrapper.find('[data-qa-item="broken-thing"]').exists()).toBe(true);
      expect(wrapper.text()).not.toContain("Nowa rzecz");
    });

    it("opens on the default tab for a name it does not know", async () => {
      const wrapper = await mountPage("/?widok=cos-innego");

      expect(activeFilter(wrapper)).toMatch(/^Do sprawdzenia/);
    });

    it("puts the tab picked into the url, and leaves the default one out", async () => {
      const wrapper = await mountPage("/#qa-new-thing");

      await pick(wrapper, "Wszystkie");
      expect(currentQuery().widok).toBe("wszystkie");
      // Picked by hand, the tab leaves the linked entry behind.
      expect(useRouter().currentRoute.value.hash).toBe("");

      await pick(wrapper, "Do sprawdzenia");
      expect(currentQuery()).not.toHaveProperty("widok");
    });

    // The toolbar's link to "Problemy" is the same url every time: it can
    // switch back to that tab only because a chip moves the url along too.
    it("follows a link to a tab while the page is open", async () => {
      const wrapper = await mountPage("/?widok=problemy");
      await pick(wrapper, "Wszystkie");
      expect(currentQuery().widok).toBe("wszystkie");

      await useRouter().push({ path: "/", query: { widok: "problemy" } });
      await settlesOn(wrapper, "Problemy");
    });
  });
});
