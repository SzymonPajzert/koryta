import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { useRouter } from "#app";
import OpiniePage from "../../../app/pages/admin/opinie.vue";
import type { Feedback, FeedbackStatus } from "~~/shared/model";
import type { QaCheck, QaCheckStatus, QaItem } from "~~/shared/qa";

const { mockAuthRequest, claimed, fixEntries } = vi.hoisted(() => {
  /** Reports a QA entry names in `fixes`. Only Firestore auto-ids count as
   * such, so these are 20 letters and digits where the rest are short. */
  const claimed = {
    works: "works000000000000000",
    blocked: "blocked0000000000000",
    broken: "broken00000000000000",
    awaiting: "awaiting000000000000",
  };
  const entry = (id: string, fixes: string[]): QaItem => ({
    id,
    title: `Poprawka ${id}`,
    description: "Coś poprawiono.",
    steps: ["Sprawdź"],
    area: "admin",
    fixes,
  });
  return {
    mockAuthRequest: vi.fn(),
    claimed,
    fixEntries: [
      entry("fix-works", [claimed.works]),
      entry("fix-blocked", [claimed.blocked]),
      entry("fix-broken", [claimed.broken]),
      entry("fix-awaiting", [claimed.awaiting]),
    ],
  };
});

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: null } }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

/** The changelog, as far as this page reads it: which reports it claims. */
vi.mock("~~/shared/qa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~~/shared/qa")>()),
  QA_ITEMS: fixEntries,
}));

/** Everybody's verdicts from /qa. Loaded unless a test says otherwise. */
const qaChecks = {
  checks: ref<QaCheck[]>([]),
  loaded: ref(true),
  load: vi.fn(async (_force?: boolean) => undefined),
  // The composable's own: everybody's verdicts on one entry, newest first.
  checksFor: (itemId: string) =>
    qaChecks.checks.value
      .filter((check) => check.itemId === itemId)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
};

vi.mock("~/composables/qa", () => ({ useQaChecks: () => qaChecks }));

const feedback = (
  id: string,
  adminStatus: FeedbackStatus,
  fields: Partial<Feedback> = {},
): Feedback => ({
  id,
  kind: "bug",
  message: `zgłoszenie ${id}`,
  createdAt: "2026-08-24T10:00:00.000Z",
  adminStatus,
  context: { route: "/", pageTitle: "Koryta.pl" },
  ...fields,
});

/** A page with something in every section. The queue is served out of rank
 * order and its ranks run against `createdAt` (q1 is the oldest), so neither
 * the response order nor "newest first" can pass for queue order. */
const board = (): Feedback[] => [
  feedback("q3", "new", {
    queueRank: 3072,
    createdAt: "2026-08-23T10:00:00.000Z",
  }),
  feedback("in-old", "new", { createdAt: "2026-08-10T10:00:00.000Z" }),
  feedback("q1", "new", {
    queueRank: 1024,
    createdAt: "2026-08-01T10:00:00.000Z",
  }),
  feedback("done", "resolved", {
    // A rank is kept when a report is settled, so reopening it puts it back;
    // it must not pull a closed report into the queue meanwhile.
    queueRank: 1500,
    createdAt: "2026-08-15T10:00:00.000Z",
  }),
  feedback("q2", "in_progress", {
    queueRank: 2048,
    createdAt: "2026-08-05T10:00:00.000Z",
  }),
  feedback("in-new", "new", { createdAt: "2026-08-22T10:00:00.000Z" }),
  feedback("wont", "wont_fix", { createdAt: "2026-08-12T10:00:00.000Z" }),
];

/** A queue with no room between its middle two. Two reports can share a rank
 * - a reopened one keeps the rank it had, and a newer one may have been given
 * the same since. Halving the gap between them gives that rank again, which
 * sorts beside the slot. "a" is already where spacing out would put it. */
const crowded = (): Feedback[] => [
  feedback("a", "new", {
    queueRank: 1024,
    createdAt: "2026-08-01T10:00:00.000Z",
  }),
  feedback("b", "new", {
    queueRank: 1500,
    createdAt: "2026-08-02T10:00:00.000Z",
  }),
  feedback("c", "new", {
    queueRank: 1500,
    createdAt: "2026-08-03T10:00:00.000Z",
  }),
  feedback("d", "new", {
    queueRank: 4000,
    createdAt: "2026-08-04T10:00:00.000Z",
  }),
];

/** Every GET answers with a fresh copy of the list, as the server would; the
 * page moves reports by mutating them, and that must not leak into the next
 * load's answer. Rank POSTs succeed unless a test says otherwise. */
const serve = (...answers: Feedback[][]) => {
  let gets = 0;
  mockAuthRequest.mockImplementation(
    async (_url: string, opts: { method: string }) => {
      if (opts.method !== "GET") return { ok: true };
      const items = answers[Math.min(gets++, answers.length - 1)]!;
      return { feedback: items.map((item) => structuredClone(item)) };
    },
  );
};

const gets = () =>
  mockAuthRequest.mock.calls.filter(([, opts]) => opts.method === "GET");
const posts = () =>
  mockAuthRequest.mock.calls.filter(([, opts]) => opts.method === "POST");

/** Renders what the page tells the snackbar, in place. The real one is an
 * overlay teleported out of the wrapper and closed on a timer; what matters
 * here is only whether the page raised it and with which words. */
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
 * route. */
const mounted: { unmount: () => void }[] = [];

const mount = async (hash = "", query: Record<string, string> = {}) => {
  const wrapper = await mountSuspended(OpiniePage, {
    route: { path: "/", hash, query },
    global: { stubs: { UserChip: true, VSnackbar: SnackbarStub } },
  });
  mounted.push(wrapper);
  await vi.waitUntil(() => gets().length > 0, { timeout: 2000 });
  await flushPromises();
  return wrapper;
};

type Wrapper = Awaited<ReturnType<typeof mount>>;

/** The row for one report, found by the id the Slack link also uses. */
const row = (wrapper: Wrapper, id: string) => wrapper.get(`#fb-${id}`);

/** Report ids in the order the rows that open are on the page. */
const listIds = (wrapper: Wrapper) =>
  wrapper
    .findAll("[data-report-row]")
    .map((node) => node.attributes("data-feedback-id"));

/** Whether a report's row is open - the only time its select, note and
 * links are in the page at all. */
const isOpen = (wrapper: Wrapper, id: string) =>
  row(wrapper, id).find("[data-row-panel]").exists();

/** Report ids in the order the one-line rows are, in ordering mode. */
const rowIds = (wrapper: Wrapper, kind: "queue" | "inbox" = "queue") =>
  wrapper
    .findAll(`[data-${kind}-row]`)
    .map((node) => node.attributes("data-feedback-id"));

const button = (wrapper: Pick<Wrapper, "findAll">, label: string) => {
  const found = wrapper
    .findAll("button")
    .find((node) => node.text().trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
};

const click = async (target: { trigger: (event: string) => Promise<void> }) => {
  await target.trigger("click");
  await flushPromises();
};

/** Opens the rows of these reports, as a click on each line does. */
const open = async (wrapper: Wrapper, ...ids: string[]) => {
  for (const id of ids) {
    if (!isOpen(wrapper, id)) {
      await click(row(wrapper, id).get("[data-row-toggle]"));
    }
  }
};

/** Opens every row on the page. */
const openAll = (wrapper: Wrapper) =>
  open(
    wrapper,
    ...listIds(wrapper).filter((id): id is string => id !== undefined),
  );

/** Switches to ordering mode and waits for the reload it makes. */
const startOrdering = async (wrapper: Wrapper) => {
  const before = gets().length;
  await click(button(wrapper, "Ułóż kolejkę"));
  await vi.waitUntil(() => gets().length > before, { timeout: 2000 });
  await flushPromises();
};

beforeEach(() => {
  vi.clearAllMocks();
  qaChecks.checks.value = [];
  qaChecks.loaded.value = true;
});

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

describe("admin feedback queue", () => {
  it("dims what is settled and leaves open work alone", async () => {
    serve([
      feedback("new-one", "new"),
      feedback("doing", "in_progress"),
      feedback("done", "resolved"),
      feedback("wont", "wont_fix"),
    ]);
    const wrapper = await mount();

    // Closed reports are folded away until asked for.
    expect(wrapper.find("#fb-done").exists()).toBe(false);
    await click(wrapper.get("[data-toggle-closed]"));

    // "W trakcie" is still somebody's job, so it reads like a new report.
    expect(row(wrapper, "new-one").classes()).not.toContain("arow--dimmed");
    expect(row(wrapper, "doing").classes()).not.toContain("arow--dimmed");

    expect(row(wrapper, "done").classes()).toContain("arow--dimmed");
    expect(row(wrapper, "wont").classes()).toContain("arow--dimmed");
  });

  it("shows what is not queued newest first, then the queue by rank, closed folded", async () => {
    serve(board());
    const wrapper = await mount();

    // No hash, so nothing to ask for beyond the list itself.
    expect(gets()[0]![1]).not.toHaveProperty("query");
    // The whole list came back, so there is nothing to warn about.
    expect(wrapper.text()).not.toContain("niepełne");

    // What arrived since the queue was last ordered is what somebody coming
    // from Slack or the dashboard is here to look at, so it comes first. The
    // closed ones keep their heading, folded, with the way to unfold them.
    expect(
      wrapper
        .findAll("[data-section]")
        .map((node) => node.attributes("data-section")),
    ).toEqual(["inbox", "queue", "closed"]);
    expect(listIds(wrapper)).toEqual(["in-new", "in-old", "q1", "q2", "q3"]);
    // One line each until asked for more.
    expect(wrapper.find("[data-row-panel]").exists()).toBe(false);

    // The number is the place in the queue, not anything stored.
    expect(row(wrapper, "q1").get("[data-queue-position]").text()).toBe("#1");
    expect(row(wrapper, "q3").get("[data-queue-position]").text()).toBe("#3");
    expect(row(wrapper, "in-new").find("[data-queue-position]").exists()).toBe(
      false,
    );

    // Two closed reports, one of them with a rank left over: counted on the
    // fold, not rendered, and not numbered as part of the queue.
    expect(wrapper.get("[data-toggle-closed]").text()).toBe(
      "Pokaż zamknięte (2)",
    );
    expect(wrapper.find("#fb-done").exists()).toBe(false);
    expect(wrapper.find("#fb-wont").exists()).toBe(false);

    await click(wrapper.get("[data-toggle-closed]"));
    expect(listIds(wrapper)).toEqual([
      "in-new",
      "in-old",
      "q1",
      "q2",
      "q3",
      "done",
      "wont",
    ]);
    expect(row(wrapper, "done").find("[data-queue-position]").exists()).toBe(
      false,
    );
    expect(wrapper.get("[data-toggle-closed]").text()).toBe("Ukryj zamknięte");
  });

  it("puts a report at the end of the queue from its line, without opening it", async () => {
    serve(board());
    const wrapper = await mount();

    await click(row(wrapper, "in-old").get('button[aria-label="Do kolejki"]'));
    expect(isOpen(wrapper, "in-old")).toBe(false);

    expect(posts()).toHaveLength(1);
    const body = posts()[0]![1].body;
    expect(body.id).toBe("in-old");
    // After the last rank in the queue, whatever the gap.
    expect(body.queueRank).toBeGreaterThan(3072);

    expect(listIds(wrapper)).toEqual(["in-new", "q1", "q2", "q3", "in-old"]);
    expect(row(wrapper, "in-old").get("[data-queue-position]").text()).toBe(
      "#4",
    );
    // In the queue now, so there is no queue left to put it in.
    expect(
      row(wrapper, "in-old").find('button[aria-label="Do kolejki"]').exists(),
    ).toBe(false);
  });

  it("orders in one-line rows, starting from a fresh list", async () => {
    // Somebody else queued a report between this page's load and the switch:
    // ranks are computed from the neighbours on screen, so the rows have to
    // be the database's, not what the page loaded a while ago.
    const later = board().map((item) =>
      item.id === "in-new" ? { ...item, queueRank: 1536 } : item,
    );
    serve(board(), later);
    const wrapper = await mount();
    // What the mode below has to take away is there to begin with, in an
    // open row.
    await open(wrapper, "in-new");
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(wrapper.find(".v-select").exists()).toBe(true);

    await startOrdering(wrapper);

    expect(gets()).toHaveLength(2);
    expect(rowIds(wrapper)).toEqual(["q1", "in-new", "q2", "q3"]);
    expect(rowIds(wrapper, "inbox")).toEqual(["in-old"]);

    // Nothing to answer with in this mode: no rows that open, no status, no
    // note.
    expect(wrapper.findAll("[data-report-row]")).toHaveLength(0);
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.find(".v-select").exists()).toBe(false);
    expect(
      wrapper.findAll("label").some((node) => node.text() === "Status"),
    ).toBe(false);
    // Closed reports have no place in an order.
    expect(wrapper.find("#fb-done").exists()).toBe(false);
  });

  it("moves a row up between the two above it", async () => {
    serve(board());
    const wrapper = await mount();
    await startOrdering(wrapper);
    expect(rowIds(wrapper)).toEqual(["q1", "q2", "q3"]);

    const third = wrapper.findAll("[data-queue-row]")[2]!;
    await click(third.get('button[aria-label="Wyżej"]'));

    expect(posts()).toHaveLength(1);
    const body = posts()[0]![1].body;
    expect(body.id).toBe("q3");
    // Only the moved report is written, so its rank has to land strictly
    // between the two it now sits between.
    expect(body.queueRank).toBeGreaterThan(1024);
    expect(body.queueRank).toBeLessThan(2048);

    expect(rowIds(wrapper)).toEqual(["q1", "q3", "q2"]);
  });

  it("puts a row back where it was when the server refuses the move", async () => {
    serve(board());
    const wrapper = await mount();
    await startOrdering(wrapper);

    let refuse: (error: Error) => void = () => {};
    mockAuthRequest.mockImplementation(
      (_url: string, opts: { method: string }) =>
        opts.method === "POST"
          ? new Promise((_resolve, reject) => {
              refuse = reject;
            })
          : Promise.resolve({ feedback: board() }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const third = wrapper.findAll("[data-queue-row]")[2]!;
    await click(third.get('button[aria-label="Wyżej"]'));

    // Shown at once, before the server has answered...
    expect(rowIds(wrapper)).toEqual(["q1", "q3", "q2"]);
    expect(wrapper.find("[data-snackbar]").exists()).toBe(false);

    refuse(new Error("403"));
    await flushPromises();

    // ...and undone when it says no, with a word about why the row jumped.
    expect(rowIds(wrapper)).toEqual(["q1", "q2", "q3"]);
    expect(wrapper.get("[data-snackbar]").text()).toBe(
      "Nie udało się zapisać kolejności.",
    );
    error.mockRestore();
  });

  it("sends rank writes one at a time, in the order they were made", async () => {
    serve(board());
    const wrapper = await mount();
    await startOrdering(wrapper);

    const answers: (() => void)[] = [];
    mockAuthRequest.mockImplementation(
      (_url: string, opts: { method: string }) =>
        opts.method === "POST"
          ? new Promise((resolve) => answers.push(() => resolve({ ok: true })))
          : Promise.resolve({ feedback: board() }),
    );

    // q3 up to second, then up again to first, before the first write lands.
    await click(
      wrapper.findAll("[data-queue-row]")[2]!.get('button[aria-label="Wyżej"]'),
    );
    await click(
      wrapper.findAll("[data-queue-row]")[1]!.get('button[aria-label="Wyżej"]'),
    );
    expect(rowIds(wrapper)).toEqual(["q3", "q1", "q2"]);

    // Two writes in flight at once could land the other way round and leave
    // the database with the first move.
    expect(posts()).toHaveLength(1);
    answers.shift()!();
    await flushPromises();
    expect(posts()).toHaveLength(2);

    const [first, second] = posts().map(([, opts]) => opts.body);
    expect(first.id).toBe("q3");
    expect(first.queueRank).toBeGreaterThan(1024);
    expect(first.queueRank).toBeLessThan(2048);
    expect(second.id).toBe("q3");
    expect(second.queueRank).toBeLessThan(1024);
    answers.shift()!();
    await flushPromises();
  });

  it.each([
    // The later move is what was asked for last, and it was stored.
    { later: "stored", accept: true, rows: ["q3", "q1", "q2"] },
    // Nothing was stored, so the report is back at the rank it had.
    { later: "refused too", accept: false, rows: ["q1", "q2", "q3"] },
  ])(
    "ends showing what was saved when an earlier move of the same row is refused and the later one is $later",
    async ({ accept, rows }) => {
      serve(board());
      const wrapper = await mount();
      await startOrdering(wrapper);

      // A fake of the one field the server keeps, so the screen can be held
      // against it once everything has settled.
      const saved = new Map(
        board()
          .filter(
            (item) =>
              item.queueRank !== undefined && item.adminStatus !== "resolved",
          )
          .map((item) => [item.id!, item.queueRank!]),
      );
      const answers: ((ok: boolean) => void)[] = [];
      mockAuthRequest.mockImplementation(
        (
          _url: string,
          opts: { method: string; body: { id: string; queueRank: number } },
        ) =>
          opts.method === "POST"
            ? new Promise((resolve, reject) =>
                answers.push((ok) => {
                  if (!ok) return reject(new Error("503"));
                  saved.set(opts.body.id, opts.body.queueRank);
                  resolve({ ok: true });
                }),
              )
            : Promise.resolve({ feedback: board() }),
      );
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      await click(
        wrapper
          .findAll("[data-queue-row]")[2]!
          .get('button[aria-label="Wyżej"]'),
      );
      await click(
        wrapper
          .findAll("[data-queue-row]")[1]!
          .get('button[aria-label="Wyżej"]'),
      );

      // The first write is refused while the second, queued behind it, has not
      // been answered: the row stays where the later move put it rather than
      // jumping back and then forward again.
      answers.shift()!(false);
      await flushPromises();
      expect(rowIds(wrapper)).toEqual(["q3", "q1", "q2"]);

      answers.shift()!(accept);
      await flushPromises();

      const onServer = [...saved.entries()]
        .sort(([, a], [, b]) => a - b)
        .map(([id]) => id);
      // The rows must not claim an order the database does not have.
      expect(rowIds(wrapper)).toEqual(onServer);
      expect(rowIds(wrapper)).toEqual(rows);
      expect(wrapper.get("[data-snackbar]").text()).toBe(
        "Nie udało się zapisać kolejności.",
      );
      error.mockRestore();
    },
  );

  it("spaces the queue out again, in the same write, before a move into a slot with no room", async () => {
    serve(crowded());
    const wrapper = await mount();
    await startOrdering(wrapper);
    expect(rowIds(wrapper)).toEqual(["a", "b", "c", "d"]);

    // d up one: between b and c.
    await click(
      wrapper.findAll("[data-queue-row]")[3]!.get('button[aria-label="Wyżej"]'),
    );

    // One request, so a reload halfway cannot find the queue half spaced out.
    expect(posts()).toHaveLength(1);
    const body = posts()[0]![1].body;
    expect(body.id).toBe("d");
    // A full step apart in queue order, and only what changes: "a" is not
    // written at all.
    expect(body.renumber).toEqual([
      { id: "b", queueRank: 2048 },
      { id: "c", queueRank: 3072 },
    ]);
    // Between the ranks its neighbours are given, not the ones they had.
    expect(body.queueRank).toBeGreaterThan(2048);
    expect(body.queueRank).toBeLessThan(3072);

    expect(rowIds(wrapper)).toEqual(["a", "b", "d", "c"]);
    expect(wrapper.find("[data-snackbar]").exists()).toBe(false);
  });

  it("puts the whole queue back when the server refuses a move that spaced it out", async () => {
    serve(crowded());
    const wrapper = await mount();
    await startOrdering(wrapper);

    let refuse: (error: Error) => void = () => {};
    mockAuthRequest.mockImplementation(
      (_url: string, opts: { method: string }) =>
        opts.method === "POST"
          ? new Promise((_resolve, reject) => {
              refuse = reject;
            })
          : Promise.resolve({ feedback: crowded() }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const up = () =>
      click(
        wrapper
          .findAll("[data-queue-row]")[3]!
          .get('button[aria-label="Wyżej"]'),
      );
    await up();
    expect(rowIds(wrapper)).toEqual(["a", "b", "d", "c"]);
    const refused = posts()[0]![1].body;
    // b and c ride along in the one request that is refused.
    expect(refused.renumber.map(({ id }: { id: string }) => id)).toEqual([
      "b",
      "c",
    ]);

    refuse(new Error("503"));
    await flushPromises();

    expect(rowIds(wrapper)).toEqual(["a", "b", "c", "d"]);
    expect(wrapper.get("[data-snackbar]").text()).toBe(
      "Nie udało się zapisać kolejności.",
    );

    // Back at the ranks they had, not only in the order: b and c share one
    // again, so the same move has to space the queue out the same way. Left
    // at 2048 and 3072 they would leave room, and nothing would be sent along.
    serve(crowded());
    await up();
    expect(posts()).toHaveLength(2);
    expect(posts()[1]![1].body).toEqual(refused);
    expect(rowIds(wrapper)).toEqual(["a", "b", "d", "c"]);
    error.mockRestore();
  });

  it("waits for a status being saved before loading the rows to order", async () => {
    serve(board());
    const wrapper = await mount();

    // The server's copy, changed only once a save has landed.
    const stored = board();
    let land = () => {};
    mockAuthRequest.mockImplementation(
      (_url: string, opts: { method: string; body: Partial<Feedback> }) =>
        opts.method === "GET"
          ? Promise.resolve({
              feedback: stored.map((item) => structuredClone(item)),
            })
          : new Promise((resolve) => {
              land = () => {
                const { id, ...patch } = opts.body;
                Object.assign(
                  stored.find((item) => item.id === id)!,
                  patch,
                );
                resolve({ ok: true });
              };
            }),
    );

    await open(wrapper, "in-new");
    row(wrapper, "in-new")
      .findComponent({ name: "VSelect" })
      .vm.$emit("update:modelValue", "in_progress");
    await flushPromises();
    await click(button(wrapper, "Ułóż kolejkę"));

    // Asked for now, the list would come back from before the save. The rows
    // are up, but nothing can be moved until they are the fresh ones.
    expect(gets()).toHaveLength(1);
    const list = () => wrapper.get(".fb-order");
    expect(list().attributes()).toHaveProperty("inert");

    land();
    await vi.waitUntil(() => gets().length > 1, { timeout: 2000 });
    await flushPromises();

    expect(list().attributes()).not.toHaveProperty("inert");
    expect(
      wrapper.get('[data-inbox-row][data-feedback-id="in-new"]').text(),
    ).toContain("W trakcie");
  });

  it("goes back to the rows that open on Gotowe, in the new order", async () => {
    serve(board());
    const wrapper = await mount();
    await startOrdering(wrapper);

    const third = wrapper.findAll("[data-queue-row]")[2]!;
    await click(third.get('button[aria-label="Wyżej"]'));
    await click(button(wrapper, "Gotowe"));

    expect(wrapper.find("[data-queue-row]").exists()).toBe(false);
    expect(listIds(wrapper)).toEqual(["in-new", "in-old", "q1", "q3", "q2"]);
    expect(row(wrapper, "q3").get("[data-queue-position]").text()).toBe("#2");
    await open(wrapper, "q3");
    expect(row(wrapper, "q3").find("textarea").exists()).toBe(true);
    // Leaving writes nothing and reloads nothing of its own.
    expect(posts()).toHaveLength(1);
    expect(gets()).toHaveLength(2);
    expect(button(wrapper, "Ułóż kolejkę").exists()).toBe(true);
  });

  it("saves the note on blur only when it was changed", async () => {
    serve([
      feedback("fresh", "new"),
      feedback("noted", "new", { adminNote: "już wiemy" }),
    ]);
    const wrapper = await mount();
    await open(wrapper, "fresh", "noted");

    // Tabbing through the page is not an edit.
    await row(wrapper, "fresh").get("textarea").trigger("focus");
    await row(wrapper, "fresh").get("textarea").trigger("blur");
    await row(wrapper, "noted").get("textarea").trigger("focus");
    await row(wrapper, "noted").get("textarea").trigger("blur");
    await flushPromises();
    expect(posts()).toHaveLength(0);

    // Typing the note back to what it already was is not one either.
    await row(wrapper, "noted").get("textarea").setValue("już wiemy");
    await row(wrapper, "noted").get("textarea").trigger("blur");
    await flushPromises();
    expect(posts()).toHaveLength(0);

    await row(wrapper, "fresh").get("textarea").setValue("sprawdzić w piątek");
    await row(wrapper, "fresh").get("textarea").trigger("blur");
    await flushPromises();

    expect(posts()).toHaveLength(1);
    expect(posts()[0]![1].body).toEqual({
      id: "fresh",
      adminNote: "sprawdzić w piątek",
    });

    // Saved, so leaving the field again says nothing new.
    await row(wrapper, "fresh").get("textarea").trigger("blur");
    await flushPromises();
    expect(posts()).toHaveLength(1);
  });

  it("keeps a report closed from its row where it was until the next load", async () => {
    serve(board());
    const wrapper = await mount();

    await open(wrapper, "q2");
    row(wrapper, "q2")
      .findComponent({ name: "VSelect" })
      .vm.$emit("update:modelValue", "resolved");
    await flushPromises();

    expect(posts()[0]![1].body).toEqual({ id: "q2", adminStatus: "resolved" });
    // Jumping into the folded section would take it from under the cursor.
    expect(listIds(wrapper)).toEqual(["in-new", "in-old", "q1", "q2", "q3"]);
    expect(row(wrapper, "q2").get("[data-queue-position]").text()).toBe("#2");
    expect(row(wrapper, "q2").classes()).toContain("arow--dimmed");
  });

  it("asks for the report a link points at and unfolds it if it is closed", async () => {
    serve(board());
    const wrapper = await mount("#fb-wont");

    // A link from Slack can name a report too old for the list.
    expect(gets()[0]![1]).toMatchObject({
      method: "GET",
      query: { include: "wont" },
    });

    expect(row(wrapper, "wont").isVisible()).toBe(true);
    expect(row(wrapper, "wont").classes()).toContain("arow--target");
    // Opened: the link was followed to read it.
    expect(isOpen(wrapper, "wont")).toBe(true);
    expect(wrapper.get("[data-toggle-closed]").text()).toBe("Ukryj zamknięte");
    expect(wrapper.text()).not.toContain("Nie ma takiego zgłoszenia.");
  });

  it("leaves the closed ones folded when the link points at an open report", async () => {
    serve(board());
    const wrapper = await mount("#fb-in-old");

    expect(row(wrapper, "in-old").classes()).toContain("arow--target");
    expect(isOpen(wrapper, "in-old")).toBe(true);
    // Only that one.
    expect(isOpen(wrapper, "in-new")).toBe(false);
    expect(wrapper.find("#fb-done").exists()).toBe(false);
    expect(wrapper.get("[data-toggle-closed]").text()).toBe(
      "Pokaż zamknięte (2)",
    );
  });

  it("follows a hash that changes while the page is open", async () => {
    // The date in every open row links to the row itself, so the hash can
    // move without the page loading again.
    const late = feedback("late", "new", {
      createdAt: "2026-08-25T10:00:00.000Z",
    });
    serve(board(), [...board(), late]);
    const wrapper = await mount();
    expect(wrapper.find("#fb-done").exists()).toBe(false);

    await useRouter().push({ path: "/", hash: "#fb-done" });
    await flushPromises();

    expect(row(wrapper, "done").classes()).toContain("arow--target");
    expect(isOpen(wrapper, "done")).toBe(true);
    expect(wrapper.get("[data-toggle-closed]").text()).toBe("Ukryj zamknięte");
    // Already on the page, so there was nothing to ask for.
    expect(gets()).toHaveLength(1);

    // A link from Slack followed with the page open can name a report that
    // arrived after it loaded.
    await useRouter().push({ path: "/", hash: "#fb-late" });
    await flushPromises();

    expect(gets()).toHaveLength(2);
    expect(gets()[1]![1].query).toEqual({ include: "late" });
    expect(row(wrapper, "late").classes()).toContain("arow--target");
    expect(isOpen(wrapper, "late")).toBe(true);
    expect(wrapper.text()).not.toContain("Nie ma takiego zgłoszenia.");
  });

  it("keeps the report a link points at marked until the link moves on", async () => {
    serve(board());
    // Faked from before the page loads, so that a timer it starts to take
    // the mark off again is one this test can run out.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    try {
      const wrapper = await mount("#fb-in-old");
      vi.advanceTimersByTime(60_000);
      await flushPromises();

      expect(row(wrapper, "in-old").classes()).toContain("arow--target");

      // Following the date in another open row moves the mark there rather
      // than adding a second one.
      await useRouter().push({ path: "/", hash: "#fb-in-new" });
      await flushPromises();

      expect(row(wrapper, "in-new").classes()).toContain("arow--target");
      expect(row(wrapper, "in-old").classes()).not.toContain("arow--target");
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns when the server cut the open reports short", async () => {
    mockAuthRequest.mockResolvedValue({
      feedback: board(),
      openTruncated: true,
    });
    const wrapper = await mount();

    // The queue is computed from what was loaded, so it may be missing some.
    expect(wrapper.text()).toContain(
      "Otwartych zgłoszeń jest ponad 500 - lista i kolejka są niepełne.",
    );
  });

  it("says so when the link names a report that is not there", async () => {
    serve(board());
    const wrapper = await mount("#fb-gone");

    expect(gets()[0]![1].query).toEqual({ include: "gone" });
    expect(wrapper.text()).toContain("Nie ma takiego zgłoszenia.");
    // The rest of the page is still there to work with.
    expect(listIds(wrapper)).toEqual(["in-new", "in-old", "q1", "q2", "q3"]);
  });

  it("decodes the hash once, as the router hands it over already decoded", async () => {
    // "%25" in the address bar is a "%" by the time it reaches `route.hash`.
    // Decoding that again throws on the lone "%", and a page that throws
    // before its first request sits on its progress bar with nothing loaded.
    serve(board());
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountSuspended(OpiniePage, {
      // As a string, so the router parses and decodes it the way it does the
      // address bar.
      route: "/#fb-100%25",
      global: { stubs: { UserChip: true, VSnackbar: SnackbarStub } },
    });
    mounted.push(wrapper);
    await flushPromises();

    expect(gets()).toHaveLength(1);
    expect(gets()[0]![1].query).toEqual({ include: "100%" });
    expect(listIds(wrapper)).toEqual(["in-new", "in-old", "q1", "q2", "q3"]);
    error.mockRestore();
  });
});

describe("where a report came from", () => {
  /** A verdict from /qa, filed the way `saveCheck` files one. */
  const fromQa = (id: string, fields: Partial<Feedback> = {}) =>
    feedback(id, "new", {
      context: {
        route: "/qa",
        qa: {
          itemId: "fix-works",
          title: "Poprawka fix-works",
          status: "issue",
        },
      },
      ...fields,
    });

  /** The board, with two verdicts from /qa outside the queue - one open, one
   * closed. Nothing in the queue came from /qa. */
  const mixed = (): Feedback[] => [
    ...board(),
    fromQa("qa-new", { createdAt: "2026-08-24T10:00:00.000Z" }),
    fromQa("qa-done", { adminStatus: "resolved" }),
  ];

  const currentRoute = () => useRouter().currentRoute.value;
  const chip = (wrapper: Wrapper, value: string) =>
    wrapper.get(`[data-filter="${value}"]`);
  /** Picks a view and waits for the url to say so - the router navigates
   * asynchronously, and the page reads the view back from the url. */
  const pick = async (wrapper: Wrapper, value: string) => {
    await click(chip(wrapper, value));
    await vi.waitUntil(
      () => (currentRoute().query.zrodlo ?? "wszystkie") === value,
      { timeout: 2000 },
    );
    await flushPromises();
  };
  const sectionKeys = (wrapper: Wrapper) =>
    wrapper
      .findAll("[data-section]")
      .map((node) => node.attributes("data-section"));

  it("narrows the list to one source, counting what is open in each", async () => {
    serve(mixed());
    const wrapper = await mount();

    expect(chip(wrapper, "wszystkie").attributes("aria-pressed")).toBe("true");
    expect(chip(wrapper, "wszystkie").text()).toBe("Wszystkie 6");
    expect(chip(wrapper, "zgloszenia").text()).toBe("Zgłoszenia 5");
    expect(chip(wrapper, "qa").text()).toBe("Z QA 1");
    expect(listIds(wrapper)).toEqual([
      "qa-new",
      "in-new",
      "in-old",
      "q1",
      "q2",
      "q3",
    ]);

    await pick(wrapper, "qa");
    // In the url, so the view survives a reload and can be linked to.
    expect(currentRoute().query).toEqual({ zrodlo: "qa" });
    expect(chip(wrapper, "qa").attributes("aria-pressed")).toBe("true");
    expect(listIds(wrapper)).toEqual(["qa-new"]);
    // Nothing queued came from /qa, so there is no queue to show.
    expect(sectionKeys(wrapper)).toEqual(["inbox", "closed"]);
    expect(wrapper.get("[data-toggle-closed]").text()).toBe(
      "Pokaż zamknięte (1)",
    );

    await pick(wrapper, "zgloszenia");
    expect(currentRoute().query).toEqual({ zrodlo: "zgloszenia" });
    expect(listIds(wrapper)).toEqual(["in-new", "in-old", "q1", "q2", "q3"]);

    // The default leaves nothing behind.
    await pick(wrapper, "wszystkie");
    expect(currentRoute().query).toEqual({});
  });

  it("takes a view it does not know for all of them", async () => {
    serve(mixed());
    const wrapper = await mount("", { zrodlo: "cokolwiek" });

    expect(chip(wrapper, "wszystkie").attributes("aria-pressed")).toBe("true");
    expect(listIds(wrapper)).toHaveLength(6);
  });

  it("puts a report on the end of the whole queue while the view shows none of it", async () => {
    serve(mixed());
    const wrapper = await mount("", { zrodlo: "qa" });
    expect(listIds(wrapper)).toEqual(["qa-new"]);

    await click(row(wrapper, "qa-new").get('button[aria-label="Do kolejki"]'));

    // After q3, which is not on screen - not at the top of an empty queue.
    expect(posts()).toHaveLength(1);
    const body = posts()[0]![1].body;
    expect(body.id).toBe("qa-new");
    expect(body.queueRank).toBeGreaterThan(3072);
    expect(row(wrapper, "qa-new").get("[data-queue-position]").text()).toBe(
      "#4",
    );
  });

  it("drops a view that hides the report a link points at, and keeps the link", async () => {
    serve(mixed());
    const wrapper = await mount("#fb-in-old", { zrodlo: "qa" });
    await vi.waitUntil(() => currentRoute().query.zrodlo === undefined, {
      timeout: 2000,
    });
    await flushPromises();

    expect(currentRoute().query).toEqual({});
    expect(currentRoute().hash).toBe("#fb-in-old");
    expect(chip(wrapper, "wszystkie").attributes("aria-pressed")).toBe("true");
    expect(isOpen(wrapper, "in-old")).toBe(true);
    expect(row(wrapper, "in-old").classes()).toContain("arow--target");
  });

  it("leaves the view alone when it already shows the report", async () => {
    serve(mixed());
    const wrapper = await mount("#fb-qa-new", { zrodlo: "qa" });

    expect(currentRoute().query).toEqual({ zrodlo: "qa" });
    expect(isOpen(wrapper, "qa-new")).toBe(true);
  });
});

describe("fixes claimed on the QA list", () => {
  const verdict = (
    itemId: string,
    userUid: string,
    status: QaCheckStatus,
  ): QaCheck => ({ itemId, userUid, status });

  /** Everybody who has checked a fix so far. One "issue" is enough to call a
   * fix broken, whatever else was said about it. */
  const verdicts = (): QaCheck[] => [
    verdict("fix-works", "checker", "ok"),
    verdict("fix-blocked", "checker", "ok"),
    verdict("fix-broken", "checker", "ok"),
    verdict("fix-broken", "other", "issue"),
  ];

  /** A report written on /qa while checking one of the fixes. */
  const followUp = (
    id: string,
    itemId: string,
    status: QaCheckStatus,
    adminStatus: FeedbackStatus = "new",
  ) =>
    feedback(id, adminStatus, {
      context: {
        route: "/qa",
        qa: { itemId, title: `Poprawka ${itemId}`, status },
      },
    });

  /** One report per state a fix can be in, one nobody claims, and the
   * follow-ups: on "works" only a note that it works and a problem that has
   * been dealt with since, on "blocked" a problem still open. */
  const reports = (): Feedback[] => [
    feedback(claimed.works, "new"),
    feedback(claimed.blocked, "new"),
    feedback(claimed.broken, "new"),
    feedback(claimed.awaiting, "in_progress"),
    feedback("plain", "new"),
    followUp("works-ok", "fix-works", "ok"),
    followUp("works-old-issue", "fix-works", "issue", "resolved"),
    followUp("blocked-issue", "fix-blocked", "issue"),
  ];

  const fixChip = (wrapper: Wrapper, id: string) =>
    row(wrapper, id).find("[data-fix-state]");

  const hasCloseButton = (wrapper: Wrapper, id: string) =>
    row(wrapper, id)
      .findAll("button")
      .some((node) => node.text().trim() === "Zamknij jako załatwione");

  it("colours the chip on a claimed report by what the checkers found", async () => {
    qaChecks.checks.value = verdicts();
    serve(reports());
    const wrapper = await mount();
    await openAll(wrapper);

    // Asked for once the page is up.
    expect(qaChecks.load).toHaveBeenCalledTimes(1);
    // Forced: verdicts from earlier in the session would be stale here.
    expect(qaChecks.load).toHaveBeenCalledWith(true);

    expect(fixChip(wrapper, claimed.works).attributes("data-fix-state")).toBe(
      "works",
    );
    expect(fixChip(wrapper, claimed.works).text()).toBe("Poprawka: działa");
    expect(fixChip(wrapper, claimed.broken).attributes("data-fix-state")).toBe(
      "broken",
    );
    expect(fixChip(wrapper, claimed.broken).text()).toBe(
      "Poprawka: nie działa",
    );
    expect(
      fixChip(wrapper, claimed.awaiting).attributes("data-fix-state"),
    ).toBe("awaiting");
    expect(fixChip(wrapper, claimed.awaiting).text()).toBe(
      "Poprawka: czeka na sprawdzenie",
    );

    // Nothing claims these, the follow-ups included.
    expect(fixChip(wrapper, "plain").exists()).toBe(false);
    expect(fixChip(wrapper, "works-ok").exists()).toBe(false);
  });

  it("links a report written while checking a fix back to the report it fixes", async () => {
    qaChecks.checks.value = verdicts();
    serve(reports());
    const wrapper = await mount();
    await openAll(wrapper);

    // Where each "dotyczy zgłoszenia" chip in a row leads. Asked of the chip
    // rather than read off an href: there is no router link to render one here.
    const targets = (id: string) =>
      row(wrapper, id)
        .findAllComponents({ name: "VChip" })
        .filter((chip) => chip.attributes("data-fix-target") !== undefined)
        .map((chip) => ({ text: chip.text(), to: chip.props("to") }));

    expect(targets("blocked-issue")).toEqual([
      { text: "dotyczy zgłoszenia", to: { hash: `#fb-${claimed.blocked}` } },
    ]);
    expect(targets("works-ok")).toEqual([
      { text: "dotyczy zgłoszenia", to: { hash: `#fb-${claimed.works}` } },
    ]);
    // Neither the report being fixed nor one about something else points
    // anywhere.
    expect(targets(claimed.blocked)).toEqual([]);
    expect(targets("plain")).toEqual([]);
  });

  it("offers closing a report only once its fix works and nothing reported against it is open", async () => {
    qaChecks.checks.value = verdicts();
    serve(reports());
    const wrapper = await mount();
    await openAll(wrapper);

    // "works" has a problem reported against it too, but it is closed.
    expect(hasCloseButton(wrapper, claimed.works)).toBe(true);
    // Works for its checker, but somebody's problem with it is still open.
    expect(fixChip(wrapper, claimed.blocked).attributes("data-fix-state")).toBe(
      "works",
    );
    expect(hasCloseButton(wrapper, claimed.blocked)).toBe(false);
    expect(hasCloseButton(wrapper, claimed.broken)).toBe(false);
    expect(hasCloseButton(wrapper, claimed.awaiting)).toBe(false);
    expect(hasCloseButton(wrapper, "plain")).toBe(false);

    await click(button(row(wrapper, claimed.works), "Zamknij jako załatwione"));

    expect(posts()).toHaveLength(1);
    expect(posts()[0]![1].body).toEqual({
      id: claimed.works,
      adminStatus: "resolved",
    });
    expect(row(wrapper, claimed.works).classes()).toContain("arow--dimmed");
    // Closed, so there is nothing left to offer.
    expect(hasCloseButton(wrapper, claimed.works)).toBe(false);
  });

  it("says nothing about a fix until the checks have loaded", async () => {
    // Until then every fix would read as unchecked, and none as working. The
    // read is still out, which must not hold up the reports themselves.
    qaChecks.loaded.value = false;
    qaChecks.load.mockReturnValueOnce(new Promise(() => {}));
    serve(reports());
    const wrapper = await mount();
    await openAll(wrapper);

    expect(fixChip(wrapper, claimed.works).attributes("data-fix-state")).toBe(
      "loading",
    );
    expect(fixChip(wrapper, claimed.works).text()).toBe("Poprawka");
    expect(hasCloseButton(wrapper, claimed.works)).toBe(false);

    // Arriving after the list, as they may: the page catches up in place.
    qaChecks.checks.value = verdicts();
    qaChecks.loaded.value = true;
    await flushPromises();

    expect(fixChip(wrapper, claimed.works).attributes("data-fix-state")).toBe(
      "works",
    );
    expect(hasCloseButton(wrapper, claimed.works)).toBe(true);
  });

  it("marks a claimed report in the one-line rows of ordering mode", async () => {
    qaChecks.checks.value = verdicts();
    serve([
      feedback(claimed.broken, "new", { queueRank: 1024 }),
      feedback("queued", "new", { queueRank: 2048 }),
      feedback(claimed.works, "new"),
      feedback("plain", "new"),
    ]);
    const wrapper = await mount();
    await startOrdering(wrapper);

    const icon = (kind: "queue" | "inbox", id: string) =>
      wrapper
        .get(`[data-${kind}-row][data-feedback-id="${id}"]`)
        .find("[data-fix-state-icon]");

    expect(icon("queue", claimed.broken).attributes("aria-label")).toBe(
      "Poprawka: nie działa",
    );
    expect(icon("inbox", claimed.works).attributes("aria-label")).toBe(
      "Poprawka: działa",
    );
    expect(icon("queue", "queued").exists()).toBe(false);
    expect(icon("inbox", "plain").exists()).toBe(false);
  });
});
