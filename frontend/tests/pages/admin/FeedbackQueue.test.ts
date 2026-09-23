import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { useRouter } from "#app";
import OpiniePage from "../../../app/pages/admin/opinie.vue";
import type { Feedback, FeedbackStatus } from "~~/shared/model";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: null } }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

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

const mount = async (hash = "") => {
  const wrapper = await mountSuspended(OpiniePage, {
    route: { path: "/", hash },
    global: { stubs: { UserChip: true, VSnackbar: SnackbarStub } },
  });
  mounted.push(wrapper);
  await vi.waitUntil(() => gets().length > 0, { timeout: 2000 });
  await flushPromises();
  return wrapper;
};

type Wrapper = Awaited<ReturnType<typeof mount>>;

/** The card for one report, found by the id the Slack link also uses. */
const card = (wrapper: Wrapper, id: string) => wrapper.get(`#fb-${id}`);

/** Report ids in the order the cards are on the page. */
const cardIds = (wrapper: Wrapper) =>
  wrapper
    .findAll(".v-card[data-feedback-id]")
    .map((node) => node.attributes("data-feedback-id"));

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

/** Switches to ordering mode and waits for the reload it makes. */
const startOrdering = async (wrapper: Wrapper) => {
  const before = gets().length;
  await click(button(wrapper, "Ułóż kolejkę"));
  await vi.waitUntil(() => gets().length > before, { timeout: 2000 });
  await flushPromises();
};

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(card(wrapper, "new-one").classes()).not.toContain(
      "feedback-settled",
    );
    expect(card(wrapper, "doing").classes()).not.toContain("feedback-settled");

    expect(card(wrapper, "done").classes()).toContain("feedback-settled");
    expect(card(wrapper, "wont").classes()).toContain("feedback-settled");
  });

  it("shows what is not queued newest first, then the queue by rank, closed folded", async () => {
    serve(board());
    const wrapper = await mount();

    // No hash, so nothing to ask for beyond the list itself.
    expect(gets()[0]![1]).not.toHaveProperty("query");
    // The whole list came back, so there is nothing to warn about.
    expect(wrapper.text()).not.toContain("niepełne");

    // What arrived since the queue was last ordered is what somebody coming
    // from Slack or the dashboard is here to look at, so it comes first.
    expect(
      wrapper
        .findAll("[data-section]")
        .map((node) => node.attributes("data-section")),
    ).toEqual(["inbox", "queue"]);
    expect(cardIds(wrapper)).toEqual(["in-new", "in-old", "q1", "q2", "q3"]);

    // The number is the place in the queue, not anything stored.
    expect(card(wrapper, "q1").get("[data-queue-position]").text()).toBe("#1");
    expect(card(wrapper, "q3").get("[data-queue-position]").text()).toBe("#3");
    expect(card(wrapper, "in-new").find("[data-queue-position]").exists()).toBe(
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
    expect(cardIds(wrapper)).toEqual([
      "in-new",
      "in-old",
      "q1",
      "q2",
      "q3",
      "done",
      "wont",
    ]);
    expect(card(wrapper, "done").find("[data-queue-position]").exists()).toBe(
      false,
    );
    expect(wrapper.get("[data-toggle-closed]").text()).toBe("Ukryj zamknięte");
  });

  it("puts a report at the end of the queue from its card", async () => {
    serve(board());
    const wrapper = await mount();

    await click(button(card(wrapper, "in-old"), "Do kolejki"));

    expect(posts()).toHaveLength(1);
    const body = posts()[0]![1].body;
    expect(body.id).toBe("in-old");
    // After the last rank in the queue, whatever the gap.
    expect(body.queueRank).toBeGreaterThan(3072);

    expect(cardIds(wrapper)).toEqual(["in-new", "q1", "q2", "q3", "in-old"]);
    expect(card(wrapper, "in-old").get("[data-queue-position]").text()).toBe(
      "#4",
    );
    // In the queue now, so there is no queue left to put it in.
    expect(
      card(wrapper, "in-old")
        .findAll("button")
        .some((node) => node.text().includes("Do kolejki")),
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
    // What the mode below has to take away is there to begin with.
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(wrapper.find(".v-select").exists()).toBe(true);

    await startOrdering(wrapper);

    expect(gets()).toHaveLength(2);
    expect(rowIds(wrapper)).toEqual(["q1", "in-new", "q2", "q3"]);
    expect(rowIds(wrapper, "inbox")).toEqual(["in-old"]);

    // Nothing to answer with in this mode: no cards, no status, no note.
    expect(wrapper.findAll(".v-card[data-feedback-id]")).toHaveLength(0);
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

    card(wrapper, "in-new")
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

  it("goes back to cards on Gotowe, in the new order", async () => {
    serve(board());
    const wrapper = await mount();
    await startOrdering(wrapper);

    const third = wrapper.findAll("[data-queue-row]")[2]!;
    await click(third.get('button[aria-label="Wyżej"]'));
    await click(button(wrapper, "Gotowe"));

    expect(wrapper.find("[data-queue-row]").exists()).toBe(false);
    expect(cardIds(wrapper)).toEqual(["in-new", "in-old", "q1", "q3", "q2"]);
    expect(card(wrapper, "q3").get("[data-queue-position]").text()).toBe("#2");
    expect(card(wrapper, "q3").find("textarea").exists()).toBe(true);
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

    // Tabbing through the page is not an edit.
    await card(wrapper, "fresh").get("textarea").trigger("focus");
    await card(wrapper, "fresh").get("textarea").trigger("blur");
    await card(wrapper, "noted").get("textarea").trigger("focus");
    await card(wrapper, "noted").get("textarea").trigger("blur");
    await flushPromises();
    expect(posts()).toHaveLength(0);

    // Typing the note back to what it already was is not one either.
    await card(wrapper, "noted").get("textarea").setValue("już wiemy");
    await card(wrapper, "noted").get("textarea").trigger("blur");
    await flushPromises();
    expect(posts()).toHaveLength(0);

    await card(wrapper, "fresh").get("textarea").setValue("sprawdzić w piątek");
    await card(wrapper, "fresh").get("textarea").trigger("blur");
    await flushPromises();

    expect(posts()).toHaveLength(1);
    expect(posts()[0]![1].body).toEqual({
      id: "fresh",
      adminNote: "sprawdzić w piątek",
    });

    // Saved, so leaving the field again says nothing new.
    await card(wrapper, "fresh").get("textarea").trigger("blur");
    await flushPromises();
    expect(posts()).toHaveLength(1);
  });

  it("keeps a report closed from its card where it was until the next load", async () => {
    serve(board());
    const wrapper = await mount();

    card(wrapper, "q2")
      .findComponent({ name: "VSelect" })
      .vm.$emit("update:modelValue", "resolved");
    await flushPromises();

    expect(posts()[0]![1].body).toEqual({ id: "q2", adminStatus: "resolved" });
    // Jumping into the folded section would take it from under the cursor.
    expect(cardIds(wrapper)).toEqual(["in-new", "in-old", "q1", "q2", "q3"]);
    expect(card(wrapper, "q2").get("[data-queue-position]").text()).toBe("#2");
    expect(card(wrapper, "q2").classes()).toContain("feedback-settled");
  });

  it("asks for the report a link points at and unfolds it if it is closed", async () => {
    serve(board());
    const wrapper = await mount("#fb-wont");

    // A link from Slack can name a report too old for the list.
    expect(gets()[0]![1]).toMatchObject({
      method: "GET",
      query: { include: "wont" },
    });

    expect(card(wrapper, "wont").isVisible()).toBe(true);
    expect(card(wrapper, "wont").classes()).toContain("feedback-target");
    expect(wrapper.get("[data-toggle-closed]").text()).toBe("Ukryj zamknięte");
    expect(wrapper.text()).not.toContain("Nie ma takiego zgłoszenia.");
  });

  it("leaves the closed ones folded when the link points at an open report", async () => {
    serve(board());
    const wrapper = await mount("#fb-in-old");

    expect(card(wrapper, "in-old").classes()).toContain("feedback-target");
    expect(wrapper.find("#fb-done").exists()).toBe(false);
    expect(wrapper.get("[data-toggle-closed]").text()).toBe(
      "Pokaż zamknięte (2)",
    );
  });

  it("follows a hash that changes while the page is open", async () => {
    // The date on every card links to the card itself, so the hash can move
    // without the page loading again.
    const late = feedback("late", "new", {
      createdAt: "2026-08-25T10:00:00.000Z",
    });
    serve(board(), [...board(), late]);
    const wrapper = await mount();
    expect(wrapper.find("#fb-done").exists()).toBe(false);

    await useRouter().push({ path: "/", hash: "#fb-done" });
    await flushPromises();

    expect(card(wrapper, "done").classes()).toContain("feedback-target");
    expect(wrapper.get("[data-toggle-closed]").text()).toBe("Ukryj zamknięte");
    // Already on the page, so there was nothing to ask for.
    expect(gets()).toHaveLength(1);

    // A link from Slack followed with the page open can name a report that
    // arrived after it loaded.
    await useRouter().push({ path: "/", hash: "#fb-late" });
    await flushPromises();

    expect(gets()).toHaveLength(2);
    expect(gets()[1]![1].query).toEqual({ include: "late" });
    expect(card(wrapper, "late").classes()).toContain("feedback-target");
    expect(wrapper.text()).not.toContain("Nie ma takiego zgłoszenia.");
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
    expect(cardIds(wrapper)).toEqual(["in-new", "in-old", "q1", "q2", "q3"]);
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
    expect(cardIds(wrapper)).toEqual(["in-new", "in-old", "q1", "q2", "q3"]);
    error.mockRestore();
  });
});
