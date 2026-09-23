import { describe, it, expect, vi, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick } from "vue";
import FeedbackFixChip from "../../app/components/feedback/FixChip.vue";
import type { FixState } from "~~/shared/feedbackFixes";
import type { Feedback } from "~~/shared/model";
import type { QaCheck, QaCheckStatus, QaItem } from "~~/shared/qa";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

// The chip opens a v-menu, and Vuetify's overlay observes its activator as it
// opens. happy-dom ships no ResizeObserver.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const REPORTER = "reporter-uid";

const entry = (id: string, title: string): QaItem => ({
  id,
  title,
  description: "opis",
  steps: [],
  area: "admin",
  fixes: ["AbCdEfGhIjKlMnOpQrSt"],
});

const verdict = (
  userUid: string,
  status: QaCheckStatus,
  feedback?: string,
): QaCheck => ({
  itemId: NEW.id,
  userUid,
  status,
  feedback,
  updatedAt: "2026-09-20T10:00:00.000Z",
});

const followUp = (
  id: string,
  status: QaCheckStatus,
  adminStatus: Feedback["adminStatus"] = "new",
): Feedback => ({
  id,
  kind: "bug",
  message: `po poprawce ${id}`,
  createdAt: "2026-09-21T10:00:00.000Z",
  adminStatus,
  context: {
    route: "/qa",
    qa: { itemId: NEW.id, title: `wpis ${NEW.id}`, status },
  },
});

const NEW = entry("poprawka-druga", "Druga poprawka kolejki");
const OLD = entry("poprawka-pierwsza", "Pierwsza poprawka kolejki");

type Props = {
  entries?: QaItem[];
  state?: FixState | null;
  verdicts?: QaCheck[];
  followUps?: Feedback[];
  reporterUid?: string;
  blocked?: boolean;
};

const mountChip = ({
  entries = [NEW],
  state = "awaiting",
  verdicts = [],
  followUps = [],
  reporterUid = REPORTER,
  blocked = false,
}: Props = {}) =>
  mountSuspended(FeedbackFixChip, {
    props: { entries, state, verdicts, followUps, reporterUid, blocked },
    global: { stubs: { UserChip: true } },
  });

type Wrapper = Awaited<ReturnType<typeof mountChip>>;

// The menu teleports out of the wrapper into document.body, so a chip left
// mounted would leave its details for the next test to find.
let mounted: Wrapper | undefined;
const mount = async (props: Props = {}) => {
  mounted = await mountChip(props);
  return mounted;
};

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  document.body.innerHTML = "";
});

const chip = (wrapper: Wrapper) => wrapper.get("[data-fix-state]");

/** Opens the chip's menu and returns the details card in it. The activator
 * names its own overlay in aria-controls. */
const openDetails = async (wrapper: Wrapper) => {
  const activator = chip(wrapper);
  await activator.trigger("click");
  await nextTick();
  const menu = document.getElementById(activator.attributes("aria-controls")!);
  const details = menu?.querySelector<HTMLElement>("[data-fix-details]");
  if (!details) throw new Error("no details opened");
  return details;
};

const linksIn = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLAnchorElement>("a")].map((a) => ({
    text: a.textContent.trim(),
    href: a.getAttribute("href"),
  }));

const verdictRows = (details: HTMLElement) =>
  [...details.querySelectorAll<HTMLElement>("[data-fix-verdict]")].map(
    (row) => ({
      uid: row.querySelector("user-chip-stub")?.getAttribute("uid"),
      text: row.textContent.replace(/\s+/g, " ").trim(),
    }),
  );

/** The follow-up chips: the only chips in the menu with a `to`. */
const followUpChips = (wrapper: Wrapper) =>
  wrapper.findAllComponents({ name: "VChip" }).filter((c) => c.props("to"));

describe("FeedbackFixChip", () => {
  it("says nothing about the state until the verdicts have arrived", async () => {
    // Before they load every fix would read as unchecked - and a verdict
    // already in hand must not be shown before the rest is.
    const wrapper = await mount({
      state: null,
      verdicts: [verdict("checker", "ok", "Działa u mnie")],
    });

    expect(chip(wrapper).attributes("data-fix-state")).toBe("loading");
    expect(chip(wrapper).text()).toBe("Poprawka");
    expect(chip(wrapper).classes()).toContain("text-ink-neutral");

    // The details hold back the same way: "Wczytuję…" in place of the
    // verdicts, not beside whatever part of them happens to be in hand.
    const details = await openDetails(wrapper);
    expect(details.textContent).toContain("Wczytuję…");
    expect(details.textContent).not.toContain("Nikt jeszcze nie sprawdził.");
    expect(details.textContent).not.toContain("Działa u mnie");
    expect(verdictRows(details)).toEqual([]);
  });

  it.each([
    {
      state: "awaiting",
      label: "Poprawka: czeka na sprawdzenie",
      colour: "text-ink-neutral",
    },
    { state: "works", label: "Poprawka: działa", colour: "text-ink-success" },
    {
      state: "broken",
      label: "Poprawka: nie działa",
      colour: "text-ink-danger",
    },
  ] as const)("reads $state", async ({ state, label, colour }) => {
    const wrapper = await mount({ state });

    expect(chip(wrapper).attributes("data-fix-state")).toBe(state);
    expect(chip(wrapper).text()).toBe(label);
    expect(chip(wrapper).classes()).toContain(colour);
  });

  describe("details", () => {
    it("stays open when a verdict is clicked, to copy its words", async () => {
      // Links close the menu (Enter on them works because of that), but
      // selecting a checker's note ends in a click too.
      const wrapper = await mount({
        state: "works",
        verdicts: [verdict("checker", "ok", "działa u mnie")],
      });
      const details = await openDetails(wrapper);

      details.querySelector<HTMLElement>("[data-fix-verdict]")!.click();
      await nextTick();

      expect(chip(wrapper).attributes("aria-expanded")).toBe("true");
    });

    it("links the entry that claims the fix", async () => {
      const wrapper = await mount({ entries: [NEW, OLD] });

      const details = await openDetails(wrapper);

      expect(linksIn(details)[0]).toEqual({
        text: NEW.title,
        href: `/qa#qa-${NEW.id}`,
      });
    });

    it("lists each verdict in the order given, the reporter's marked", async () => {
      const wrapper = await mount({
        state: "broken",
        verdicts: [
          verdict(REPORTER, "issue", "Nadal nie widać kolejki"),
          verdict("checker", "ok", ""),
          verdict("silent", "issue"),
        ],
      });

      const details = await openDetails(wrapper);

      // With nothing written, the verdict itself.
      expect(verdictRows(details)).toEqual([
        { uid: REPORTER, text: "(zgłaszający) Nadal nie widać kolejki" },
        { uid: "checker", text: "Działa" },
        { uid: "silent", text: "Coś nie działa" },
      ]);
      expect(details.textContent).not.toContain("Wczytuję…");
      expect(details.textContent).not.toContain("Nikt jeszcze nie sprawdził.");
    });

    it("says nobody has checked yet when nobody has", async () => {
      const wrapper = await mount({ state: "awaiting", verdicts: [] });

      const details = await openDetails(wrapper);

      expect(details.textContent).toContain("Nikt jeszcze nie sprawdził.");
      expect(details.textContent).not.toContain("Wczytuję…");
      expect(verdictRows(details)).toEqual([]);
    });

    it("links the reports written after the fix to their cards", async () => {
      const wrapper = await mount({
        followUps: [
          followUp("followupissue", "issue"),
          followUp("followupok", "ok", "resolved"),
        ],
      });

      const details = await openDetails(wrapper);

      expect(details.textContent).toContain("Zgłoszenia po poprawce");
      // With no router mounted a v-chip's `to` renders an <a> with no href,
      // so the target is read off the prop. The hash alone keeps the admin on
      // /admin/opinie, where the follow-up's own card is.
      expect(
        followUpChips(wrapper).map((c) => ({
          text: c.text().replace(/\s+/g, " ").trim(),
          to: c.props("to"),
        })),
      ).toEqual([
        {
          text: "Coś nie działa · Nowe",
          to: { hash: "#fb-followupissue" },
        },
        { text: "Działa · Załatwione", to: { hash: "#fb-followupok" } },
      ]);
    });

    it("has no follow-up section when there are none", async () => {
      const wrapper = await mount();

      const details = await openDetails(wrapper);

      expect(details.textContent).not.toContain("Zgłoszenia po poprawce");
      expect(followUpChips(wrapper)).toHaveLength(0);
    });

    it("lists the earlier fixes only when there were some", async () => {
      const single = await mount({ entries: [NEW] });
      const singleDetails = await openDetails(single);
      expect(singleDetails.textContent).not.toContain("Wcześniejsze poprawki");
      expect(linksIn(singleDetails)).toHaveLength(1);
      single.unmount();
      document.body.innerHTML = "";

      const oldest = entry("poprawka-zerowa", "Zerowa poprawka kolejki");
      const several = await mount({ entries: [NEW, OLD, oldest] });
      const details = await openDetails(several);

      expect(details.textContent).toContain("Wcześniejsze poprawki");
      // The newest is the one at the top; the rest follow, newest first.
      expect(linksIn(details)).toEqual([
        { text: NEW.title, href: `/qa#qa-${NEW.id}` },
        { text: OLD.title, href: `/qa#qa-${OLD.id}` },
        { text: oldest.title, href: `/qa#qa-${oldest.id}` },
      ]);
    });
  });

  describe("a follow-up that blocks closing", () => {
    const blocked = (details: HTMLElement) =>
      details.querySelector("[data-fix-blocked]")?.textContent.trim();

    // Whether closing is blocked is the page's call (it also knows whether
    // the report itself is closed); the chip only says why when told.
    it("explains why a working fix offers no closing", async () => {
      const wrapper = await mount({
        state: "works",
        blocked: true,
        followUps: [
          followUp("followupok", "ok"),
          followUp("followupissue", "issue", "in_progress"),
        ],
      });

      const details = await openDetails(wrapper);

      expect(blocked(details)).toBe(
        "Zamknąć będzie można, gdy te zgłoszenia problemu zostaną zamknięte.",
      );
    });

    it("says nothing of it when the page does not say it is blocked", async () => {
      const wrapper = await mount({
        state: "works",
        followUps: [followUp("followupissue", "issue")],
      });

      const details = await openDetails(wrapper);

      expect(details.textContent).toContain("Zgłoszenia po poprawce");
      expect(blocked(details)).toBeUndefined();
    });

    it("marks the blocking follow-ups red and only those", async () => {
      const wrapper = await mount({
        state: "works",
        followUps: [
          followUp("open-issue", "issue"),
          followUp("closed-issue", "issue", "resolved"),
          followUp("open-ok", "ok"),
        ],
      });

      await openDetails(wrapper);

      // VChip is tonal by default, and a tonal colour is the text colour.
      expect(
        followUpChips(wrapper).map((c) => ({
          to: c.props("to"),
          red: c.classes().includes("text-ink-danger"),
        })),
      ).toEqual([
        { to: { hash: "#fb-open-issue" }, red: true },
        { to: { hash: "#fb-closed-issue" }, red: false },
        { to: { hash: "#fb-open-ok" }, red: false },
      ]);
    });
  });
});
