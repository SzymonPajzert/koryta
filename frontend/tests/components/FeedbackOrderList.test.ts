import { describe, it, expect, vi, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick } from "vue";
import type { DOMWrapper } from "@vue/test-utils";
import FeedbackOrderList from "../../app/components/feedback/OrderList.vue";
import type { Feedback } from "~~/shared/model";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

// Every queued row carries a v-menu, and Vuetify's overlay observes its
// activator as it opens. happy-dom ships no ResizeObserver, so without this the
// first "Więcej" click throws instead of rendering the entries.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const report = (id: string, overrides: Partial<Feedback> = {}): Feedback => ({
  id,
  kind: "bug",
  message: `zgłoszenie ${id}`,
  createdAt: "2026-09-20T10:00:00.000Z",
  adminStatus: "new",
  context: { route: "/", pageTitle: "Koryta.pl" },
  ...overrides,
});

const A = report("a", { queueRank: 1000 });
const B = report("b", { queueRank: 2000 });
const C = report("c", { queueRank: 3000 });
const X = report("x");
const Y = report("y");

type MountOptions = {
  /** Only a list in the document can hold focus. */
  attachTo?: HTMLElement;
  onMove?: (item: Feedback, index: number) => void;
};

const mountList = (
  queue: Feedback[],
  inbox: Feedback[] = [],
  { attachTo, onMove }: MountOptions = {},
) =>
  mountSuspended(FeedbackOrderList, {
    props: { queue, inbox, onMove },
    attachTo,
  });

type Wrapper = Awaited<ReturnType<typeof mountList>>;

// The menus teleport out of the wrapper into document.body, so a test that
// leaves its list mounted leaves its menu entries lying around for the next
// one to find.
let mounted: Wrapper | undefined;
const mount = async (
  queue: Feedback[],
  inbox: Feedback[] = [],
  options: MountOptions = {},
) => {
  mounted = await mountList(queue, inbox, options);
  return mounted;
};

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The queue as the page leaves it after `move`: the report taken out and put
 * back at `index` of what is left. */
const reordered = (queue: Feedback[], item: Feedback, index: number) => {
  const others = queue.filter((entry) => entry.id !== item.id);
  return [...others.slice(0, index), item, ...others.slice(index)];
};

/** Mounted the way the page uses it: a move re-renders the list in its new
 * order in the same tick, before the write reaches the server - so the row a
 * click moved has already slid away by the time the next click lands. */
const mountOnPage = async (queue: Feedback[]) => {
  let current = queue;
  const wrapper: Wrapper = await mount(current, [], {
    attachTo: document.body,
    onMove: (item, index) => {
      current = reordered(current, item, index);
      void wrapper.setProps({ queue: current });
    },
  });
  return wrapper;
};

const queueOrder = (wrapper: Wrapper) =>
  wrapper
    .findAll("[data-queue-row]")
    .map((row) => row.attributes("data-feedback-id"));

/** Holds `performance.now` - which the arrows read to tell a quick second
 * click from a slow one - at whatever the test sets. */
const clock = () => {
  const time = { now: 0 };
  vi.spyOn(performance, "now").mockImplementation(() => time.now);
  return time;
};

/** A row in either list, by the same id the page's `#fb-<id>` anchor uses. */
const rowOf = (wrapper: Wrapper, id: string) =>
  wrapper.get(`[data-feedback-id="${id}"]`);

const button = (row: DOMWrapper<Element>, label: string) =>
  row.get(`button[aria-label="${label}"]`);

/** What a keyboard user does next: Enter on whatever has focus. happy-dom
 * turns no Enter into a click the way a browser does for a button, so both go
 * to the focused element. */
const pressFocused = async () => {
  const focused = document.activeElement as HTMLElement;
  focused.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  focused.click();
  await nextTick();
  await nextTick();
};

const moves = (wrapper: Wrapper) =>
  (wrapper.emitted("move") ?? []) as [Feedback, number][];

const removals = (wrapper: Wrapper) =>
  (wrapper.emitted("remove") ?? []) as [Feedback][];

/** Opens one row's "Więcej" menu and returns the overlay it opened. The
 * activator names its own overlay in aria-controls, which keeps the lookup to
 * this row's menu rather than whichever `.v-list-item` comes first. */
const openMenu = async (wrapper: Wrapper, id: string) => {
  const activator = button(rowOf(wrapper, id), "Więcej");
  await activator.trigger("click");
  await nextTick();
  const menu = document.getElementById(activator.attributes("aria-controls")!);
  if (!menu) throw new Error(`no menu opened for ${id}`);
  return menu;
};

const menuEntry = (menu: HTMLElement, title: string) => {
  const entry = [...menu.querySelectorAll<HTMLElement>(".v-list-item")].find(
    (el) => el.textContent.includes(title),
  );
  if (!entry) throw new Error(`no menu entry "${title}"`);
  return entry;
};

const ROW_HEIGHT = 40;

/** Lays the queue out one row under another, ROW_HEIGHT each. happy-dom lays
 * nothing out - every rect is zeros - and the before/after hint is read off
 * the hovered row's rect against the pointer. */
const layOut = (wrapper: Wrapper) => {
  wrapper.findAll("[data-queue-row]").forEach((row, index) => {
    const top = index * ROW_HEIGHT;
    (row.element as HTMLElement).getBoundingClientRect = () =>
      ({
        top,
        bottom: top + ROW_HEIGHT,
        height: ROW_HEIGHT,
        left: 0,
        right: 600,
        width: 600,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  });
};

/** The pointer a quarter of the way down a row, or three quarters. */
const upperHalf = (index: number) => index * ROW_HEIGHT + ROW_HEIGHT / 4;
const lowerHalf = (index: number) => index * ROW_HEIGHT + (ROW_HEIGHT * 3) / 4;

/** Drags over the inbox list and says whether it took the drag. A dragover
 * nobody cancels is how a browser learns there is nowhere to drop - and
 * `trigger` hands back no event to ask. */
const dragOverInbox = async (wrapper: Wrapper) => {
  const event = new MouseEvent("dragover", {
    bubbles: true,
    cancelable: true,
    clientY: 500,
  });
  wrapper.get("[data-inbox-list]").element.dispatchEvent(event);
  await nextTick();
  return event.defaultPrevented;
};

describe("FeedbackOrderList", () => {
  it("lists the queue in the order it is given, numbered from 1", async () => {
    const wrapper = await mount([A, B, C]);

    const rows = wrapper.findAll("[data-queue-row]");
    expect(rows.map((row) => row.attributes("data-feedback-id"))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(rows.map((row) => row.get(".fb-pos").text())).toEqual([
      "1.",
      "2.",
      "3.",
    ]);
    expect(rows[0]!.text()).toContain("zgłoszenie a");
    expect(rows[2]!.text()).toContain("zgłoszenie c");
  });

  it("numbers only the queue - a report outside it has no place yet", async () => {
    const wrapper = await mount([A], [X, Y]);

    const inboxRows = wrapper.findAll("[data-inbox-row]");
    expect(inboxRows.map((row) => row.attributes("data-feedback-id"))).toEqual([
      "x",
      "y",
    ]);
    for (const row of inboxRows) {
      expect(row.find(".fb-pos").exists()).toBe(false);
    }
  });

  it("says where each report was written, ahead of what it says", async () => {
    // A QA verdict with no note arrives as the same stock sentence whatever
    // entry it is about; the entry's title is what tells two apart.
    const wrapper = await mount(
      [A],
      [
        report("qa", {
          message: "Zgłoszono problem bez opisu.",
          context: {
            route: "/qa",
            pageTitle: "QA - Koryta.pl",
            qa: {
              itemId: "odznaki",
              title: "Odznaki na profilu",
              status: "issue",
            },
          },
        }),
        report("untitled", { context: { route: "/osoba/jan-kowalski" } }),
      ],
    );

    const where = (id: string) => rowOf(wrapper, id).get(".fb-where").text();
    expect(where("qa")).toBe("QA: Odznaki na profilu");
    expect(where("a")).toBe("Koryta.pl");
    // No title captured: the route is all there is.
    expect(where("untitled")).toBe("/osoba/jan-kowalski");
    expect(rowOf(wrapper, "qa").text()).toMatch(
      /QA: Odznaki na profilu\s*Zgłoszono problem bez opisu\./,
    );
  });

  it("offers nothing to answer a report with", async () => {
    // This mode is for deciding what comes next; the status and the note stay
    // on the cards of the other mode. A status select here would be a second
    // place to change a status from, with none of the card around it.
    const wrapper = await mount(
      [A, report("doing", { adminStatus: "in_progress", queueRank: 4000 })],
      [report("noted", { adminNote: "notatka zespołu" })],
    );
    // The menu is the one part of the component that renders outside the
    // wrapper, so it is opened and searched too.
    await openMenu(wrapper, "a");

    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.find(".v-select").exists()).toBe(false);
    expect(wrapper.find("input").exists()).toBe(false);
    expect(
      document.querySelector("textarea, select, input, .v-select"),
    ).toBeNull();
    expect(wrapper.text()).not.toContain("notatka zespołu");
  });

  describe("arrows", () => {
    it("moves a row up one slot", async () => {
      const wrapper = await mount([A, B, C]);

      await button(rowOf(wrapper, "c"), "Wyżej").trigger("click");

      // Slot 1 of [A, B] - the queue without C - is between A and B.
      expect(moves(wrapper)).toEqual([[C, 1]]);
    });

    it("moves a row down one slot", async () => {
      const wrapper = await mount([A, B, C]);

      await button(rowOf(wrapper, "a"), "Niżej").trigger("click");

      // Slot 1 of [B, C] - the queue without A - is between B and C.
      expect(moves(wrapper)).toEqual([[A, 1]]);
    });

    it("has nowhere to move the first row up or the last row down", async () => {
      const wrapper = await mount([A, B, C]);

      expect(
        button(rowOf(wrapper, "a"), "Wyżej").attributes("disabled"),
      ).toBeDefined();
      expect(
        button(rowOf(wrapper, "a"), "Niżej").attributes("disabled"),
      ).toBeUndefined();
      expect(
        button(rowOf(wrapper, "b"), "Wyżej").attributes("disabled"),
      ).toBeUndefined();
      expect(
        button(rowOf(wrapper, "b"), "Niżej").attributes("disabled"),
      ).toBeUndefined();
      expect(
        button(rowOf(wrapper, "c"), "Wyżej").attributes("disabled"),
      ).toBeUndefined();
      expect(
        button(rowOf(wrapper, "c"), "Niżej").attributes("disabled"),
      ).toBeDefined();
    });

    it("has nowhere to move a report that is the whole queue", async () => {
      const wrapper = await mount([A]);

      expect(
        button(rowOf(wrapper, "a"), "Wyżej").attributes("disabled"),
      ).toBeDefined();
      expect(
        button(rowOf(wrapper, "a"), "Niżej").attributes("disabled"),
      ).toBeDefined();
    });

    it("sends a quick second click to the report that just moved", async () => {
      // C moves up and slides out from under the pointer; B, with its own
      // "Wyżej" in the same place, slides in. Clicking again straight away
      // means "further up", not "put B back".
      const time = clock();
      const wrapper = await mountOnPage([A, B, C]);

      await button(rowOf(wrapper, "c"), "Wyżej").trigger("click");
      expect(queueOrder(wrapper)).toEqual(["a", "c", "b"]);

      time.now = 300;
      await button(rowOf(wrapper, "b"), "Wyżej").trigger("click");
      expect(queueOrder(wrapper)).toEqual(["c", "a", "b"]);

      // The other arrow is a different request, however soon it comes: A
      // slid under the pointer, and its "Niżej" moves A.
      time.now = 500;
      await button(rowOf(wrapper, "a"), "Niżej").trigger("click");
      expect(queueOrder(wrapper)).toEqual(["c", "b", "a"]);

      expect(moves(wrapper)).toEqual([
        [C, 1],
        [C, 0],
        [A, 2],
      ]);
    });

    it("moves the row clicked when the second click comes slowly", async () => {
      const time = clock();
      const wrapper = await mountOnPage([A, B, C]);

      await button(rowOf(wrapper, "c"), "Wyżej").trigger("click");
      // Long enough to have seen the list change: this is B, on purpose.
      time.now = 900;
      await button(rowOf(wrapper, "b"), "Wyżej").trigger("click");

      expect(moves(wrapper)).toEqual([
        [C, 1],
        [B, 1],
      ]);
      expect(queueOrder(wrapper)).toEqual(["a", "b", "c"]);
    });

    it("keeps focus on the moved report's arrow", async () => {
      // Re-rendering moves the row, and a moved node drops focus - so a
      // keyboard user pressing Enter again would otherwise have nothing
      // focused, or worse, the neighbour.
      const wrapper = await mountOnPage([A, B, C]);

      await button(rowOf(wrapper, "c"), "Wyżej").trigger("click");
      expect(queueOrder(wrapper)).toEqual(["a", "c", "b"]);
      expect(document.activeElement).toBe(
        button(rowOf(wrapper, "c"), "Wyżej").element,
      );

      // At the top "Wyżej" is disabled. Focus stays in the row, but on
      // "Więcej" - not on "Niżej", where the next Enter would carry the report
      // straight back down.
      await button(rowOf(wrapper, "c"), "Wyżej").trigger("click");
      expect(queueOrder(wrapper)).toEqual(["c", "a", "b"]);
      expect(document.activeElement).toBe(
        button(rowOf(wrapper, "c"), "Więcej").element,
      );

      await pressFocused();
      expect(queueOrder(wrapper)).toEqual(["c", "a", "b"]);
      expect(moves(wrapper)).toEqual([
        [C, 1],
        [C, 0],
      ]);
    });

    it("keeps focus off the opposite arrow at the bottom too", async () => {
      const wrapper = await mountOnPage([A, B, C]);

      await button(rowOf(wrapper, "a"), "Niżej").trigger("click");
      expect(queueOrder(wrapper)).toEqual(["b", "a", "c"]);
      expect(document.activeElement).toBe(
        button(rowOf(wrapper, "a"), "Niżej").element,
      );

      await button(rowOf(wrapper, "a"), "Niżej").trigger("click");
      expect(queueOrder(wrapper)).toEqual(["b", "c", "a"]);
      expect(document.activeElement).toBe(
        button(rowOf(wrapper, "a"), "Więcej").element,
      );

      await pressFocused();
      expect(queueOrder(wrapper)).toEqual(["b", "c", "a"]);
      expect(moves(wrapper)).toEqual([
        [A, 1],
        [A, 2],
      ]);
    });

    it("moves the row clicked when it is not the one that slid into place", async () => {
      // Only the row that slid under the pointer can be a mis-aimed "further";
      // B is three rows away from where E was, so a quick click on it is meant
      // for B.
      const time = clock();
      const E = report("e", { queueRank: 5000 });
      const wrapper = await mountOnPage([
        A,
        B,
        C,
        report("d", { queueRank: 4000 }),
        E,
      ]);

      await button(rowOf(wrapper, "e"), "Wyżej").trigger("click");
      expect(queueOrder(wrapper)).toEqual(["a", "b", "c", "e", "d"]);

      time.now = 300;
      await button(rowOf(wrapper, "b"), "Wyżej").trigger("click");

      expect(moves(wrapper)).toEqual([
        [E, 3],
        [B, 0],
      ]);
      expect(queueOrder(wrapper)).toEqual(["b", "a", "c", "e", "d"]);
    });
  });

  describe("menu", () => {
    it("sends a row to the top", async () => {
      const wrapper = await mount([A, B, C]);

      const menu = await openMenu(wrapper, "c");
      menuEntry(menu, "Na początek").click();
      await nextTick();

      expect(moves(wrapper)).toEqual([[C, 0]]);
    });

    it("sends a row to the bottom", async () => {
      const wrapper = await mount([A, B, C]);

      const menu = await openMenu(wrapper, "a");
      menuEntry(menu, "Na koniec").click();
      await nextTick();

      // The queue without A has two rows, so its end is slot 2 - len - 1, not
      // len, which would be one past it.
      expect(moves(wrapper)).toEqual([[A, 2]]);
    });

    it("takes a row out of the queue", async () => {
      const wrapper = await mount([A, B, C]);

      const menu = await openMenu(wrapper, "b");
      menuEntry(menu, "Wyjmij z kolejki").click();
      await nextTick();

      expect(removals(wrapper)).toEqual([[B]]);
      expect(moves(wrapper)).toEqual([]);
    });

    it("greys out the end a row is already at", async () => {
      const wrapper = await mount([A, B, C]);

      // A disabled v-list-item still emits its click in the test DOM - only
      // the stylesheet's pointer-events stops it in a browser - so the class
      // is what there is to check.
      const first = await openMenu(wrapper, "a");
      expect(menuEntry(first, "Na początek").classList).toContain(
        "v-list-item--disabled",
      );
      expect(menuEntry(first, "Na koniec").classList).not.toContain(
        "v-list-item--disabled",
      );

      const last = await openMenu(wrapper, "c");
      expect(menuEntry(last, "Na początek").classList).not.toContain(
        "v-list-item--disabled",
      );
      expect(menuEntry(last, "Na koniec").classList).toContain(
        "v-list-item--disabled",
      );
    });
  });

  describe("inbox", () => {
    it("adds a report to the end of the queue", async () => {
      const wrapper = await mount([A, B, C], [X]);

      await button(rowOf(wrapper, "x"), "Dodaj na koniec kolejki").trigger(
        "click",
      );

      // X is not in the queue, so the queue without it is all three rows and
      // its end is slot 3.
      expect(moves(wrapper)).toEqual([[X, 3]]);
    });

    it("adds a report to the top of the queue", async () => {
      const wrapper = await mount([A, B, C], [X]);

      await button(rowOf(wrapper, "x"), "Na początek kolejki").trigger("click");

      expect(moves(wrapper)).toEqual([[X, 0]]);
    });

    it("starts an empty queue from either button", async () => {
      const wrapper = await mount([], [X, Y]);

      await button(rowOf(wrapper, "x"), "Dodaj na koniec kolejki").trigger(
        "click",
      );
      await button(rowOf(wrapper, "y"), "Na początek kolejki").trigger("click");

      expect(moves(wrapper)).toEqual([
        [X, 0],
        [Y, 0],
      ]);
    });

    it("hides the section when every open report is queued", async () => {
      const wrapper = await mount([A, B]);

      expect(wrapper.find("[data-inbox-list]").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Poza kolejką");
    });
  });

  describe("empty queue", () => {
    it("shows a drop zone in place of the list", async () => {
      const wrapper = await mount([], [X]);

      expect(wrapper.find("[data-queue-empty]").exists()).toBe(true);
      expect(wrapper.find("[data-queue-list]").exists()).toBe(false);
      expect(wrapper.get("[data-queue-empty]").text()).toContain(
        "Kolejka jest pusta",
      );
    });

    it("shows no drop zone once there is a queue", async () => {
      const wrapper = await mount([A], [X]);

      expect(wrapper.find("[data-queue-empty]").exists()).toBe(false);
      expect(wrapper.find("[data-queue-list]").exists()).toBe(true);
    });

    it("starts the queue with a report dropped on it", async () => {
      const wrapper = await mount([], [X, Y]);

      await rowOf(wrapper, "y").trigger("dragstart");
      await wrapper.get("[data-queue-empty]").trigger("dragover", {
        clientY: 5,
      });
      await wrapper.get("[data-queue-empty]").trigger("drop");

      expect(moves(wrapper)).toEqual([[Y, 0]]);
    });
  });

  describe("drag and drop", () => {
    it("drops a row above the one it is let go on in that row's upper half", async () => {
      const wrapper = await mount([A, B, C]);
      layOut(wrapper);

      await rowOf(wrapper, "c").trigger("dragstart");
      await rowOf(wrapper, "a").trigger("dragover", { clientY: upperHalf(0) });
      await rowOf(wrapper, "a").trigger("drop");

      expect(moves(wrapper)).toEqual([[C, 0]]);
    });

    it("drops a row below the one it is let go on in that row's lower half", async () => {
      const wrapper = await mount([A, B, C]);
      layOut(wrapper);

      await rowOf(wrapper, "c").trigger("dragstart");
      await rowOf(wrapper, "a").trigger("dragover", { clientY: lowerHalf(0) });
      await rowOf(wrapper, "a").trigger("drop");

      expect(moves(wrapper)).toEqual([[C, 1]]);
    });

    it("counts the slot without the dragged row when dragging down", async () => {
      // A dropped under B lands between B and C: slot 1 of [B, C]. Counting
      // A's own row too would say 2 and put it under C.
      const wrapper = await mount([A, B, C]);
      layOut(wrapper);

      await rowOf(wrapper, "a").trigger("dragstart");
      await rowOf(wrapper, "b").trigger("dragover", { clientY: lowerHalf(1) });
      await rowOf(wrapper, "b").trigger("drop");

      expect(moves(wrapper)).toEqual([[A, 1]]);
    });

    it("draws the line the row would land on", async () => {
      const wrapper = await mount([A, B, C]);
      layOut(wrapper);

      await rowOf(wrapper, "c").trigger("dragstart");
      expect(rowOf(wrapper, "c").classes()).toContain("fb-row--dragging");

      await rowOf(wrapper, "a").trigger("dragover", { clientY: upperHalf(0) });
      expect(rowOf(wrapper, "a").classes()).toContain("fb-row--drop-before");
      expect(rowOf(wrapper, "a").classes()).not.toContain("fb-row--drop-after");

      await rowOf(wrapper, "a").trigger("dragover", { clientY: lowerHalf(0) });
      expect(rowOf(wrapper, "a").classes()).toContain("fb-row--drop-after");
      expect(rowOf(wrapper, "a").classes()).not.toContain(
        "fb-row--drop-before",
      );

      // A drag cancelled with Escape ends with dragend and no drop.
      await rowOf(wrapper, "c").trigger("dragend");
      expect(rowOf(wrapper, "a").classes()).not.toContain("fb-row--drop-after");
      expect(rowOf(wrapper, "c").classes()).not.toContain("fb-row--dragging");
      expect(moves(wrapper)).toEqual([]);
    });

    it("puts a report from the inbox into the slot it is dropped on", async () => {
      const wrapper = await mount([A, B, C], [X]);
      layOut(wrapper);

      await rowOf(wrapper, "x").trigger("dragstart");
      await rowOf(wrapper, "b").trigger("dragover", { clientY: upperHalf(1) });
      await rowOf(wrapper, "b").trigger("drop");

      expect(moves(wrapper)).toEqual([[X, 1]]);
    });

    it("puts a report from the inbox under the row it is dropped on", async () => {
      const wrapper = await mount([A, B, C], [X]);
      layOut(wrapper);

      await rowOf(wrapper, "x").trigger("dragstart");
      await rowOf(wrapper, "c").trigger("dragover", { clientY: lowerHalf(2) });
      await rowOf(wrapper, "c").trigger("drop");

      expect(moves(wrapper)).toEqual([[X, 3]]);
    });

    it("takes a queued row out when it is dropped on the inbox", async () => {
      const wrapper = await mount([A, B, C], [X]);
      layOut(wrapper);

      await rowOf(wrapper, "b").trigger("dragstart");
      expect(await dragOverInbox(wrapper)).toBe(true);
      expect(wrapper.get("[data-inbox-list]").classes()).toContain(
        "fb-list--target",
      );
      // Let go over one of the inbox rows: the list is the target, whichever
      // row happens to be under the pointer.
      await rowOf(wrapper, "x").trigger("drop");

      expect(removals(wrapper)).toEqual([[B]]);
      expect(moves(wrapper)).toEqual([]);
      expect(wrapper.get("[data-inbox-list]").classes()).not.toContain(
        "fb-list--target",
      );
    });

    it("does nothing with an inbox row dropped back on the inbox", async () => {
      const wrapper = await mount([A], [X, Y]);

      await rowOf(wrapper, "x").trigger("dragstart");
      // The inbox has no order of its own, so it neither accepts the drag -
      // the browser shows no drop cursor - nor lights up as if it did.
      expect(await dragOverInbox(wrapper)).toBe(false);
      expect(wrapper.get("[data-inbox-list]").classes()).not.toContain(
        "fb-list--target",
      );
      await wrapper.get("[data-inbox-list]").trigger("drop");

      expect(removals(wrapper)).toEqual([]);
      expect(moves(wrapper)).toEqual([]);
    });

    it("does nothing with a row dropped on itself", async () => {
      const wrapper = await mount([A, B, C]);
      layOut(wrapper);

      await rowOf(wrapper, "b").trigger("dragstart");
      await rowOf(wrapper, "b").trigger("dragover", { clientY: lowerHalf(1) });
      await rowOf(wrapper, "b").trigger("drop");

      expect(moves(wrapper)).toEqual([]);
      expect(removals(wrapper)).toEqual([]);
    });

    it("ignores a drag that did not start on one of its rows", async () => {
      // A file or a link dragged in from elsewhere on the page is no report,
      // and must not be read as the last row that was dragged either.
      const wrapper = await mount([A, B, C], [X]);
      layOut(wrapper);

      await rowOf(wrapper, "c").trigger("dragstart");
      await rowOf(wrapper, "a").trigger("dragover", { clientY: upperHalf(0) });
      await rowOf(wrapper, "a").trigger("drop");
      expect(moves(wrapper)).toEqual([[C, 0]]);

      // No dragstart this time: the drag came from outside the list.
      await rowOf(wrapper, "b").trigger("dragover", { clientY: upperHalf(1) });
      expect(rowOf(wrapper, "b").classes()).not.toContain(
        "fb-row--drop-before",
      );
      await rowOf(wrapper, "b").trigger("drop");
      await rowOf(wrapper, "x").trigger("drop");

      expect(moves(wrapper)).toEqual([[C, 0]]);
      expect(removals(wrapper)).toEqual([]);
    });

    it("sets drag data so Firefox starts the drag at all", async () => {
      const wrapper = await mount([A, B]);
      const setData = vi.fn();
      const dataTransfer = { setData, effectAllowed: "all" };

      await rowOf(wrapper, "b").trigger("dragstart", { dataTransfer });

      expect(setData).toHaveBeenCalledWith("text/plain", "b");
      expect(dataTransfer.effectAllowed).toBe("move");
    });
  });
});
