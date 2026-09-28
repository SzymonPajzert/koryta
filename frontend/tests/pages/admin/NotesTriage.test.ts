import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import KategoryzacjaPage from "../../../app/pages/admin/notatki/kategoryzacja.vue";
import type { NoteRow } from "~~/shared/model";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: null } }),
}));

/** The record under the choices, which reads the node and its relations for
 * itself - what it draws is NoteTriageCard.test.ts. Here it only says which
 * node it was mounted for, so that when the page mounts one can be asserted
 * without a server behind it. */
const SubjectStub = {
  props: { nodeId: { type: String, required: true } },
  template: '<div class="subject-stub" :data-node-id="nodeId" />',
};

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const row = (overrides: Partial<NoteRow> = {}): NoteRow => ({
  key: "note-1:0",
  noteId: "note-1",
  sourceIndex: 0,
  nodeId: "node-1",
  nodeName: "Jan Testowy",
  nodeType: "person",
  userUid: "user-a",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: null,
  note: "pierwsza notatka",
  url: "https://example.com/artykul",
  kind: "change_request",
  adminStatus: null,
  adminType: null,
  adminTypeDeferred: false,
  ...overrides,
});

/** Every GET the page makes answers with the same queue. */
const serveQueue = (notes: NoteRow[]) => {
  mockAuthRequest.mockImplementation(
    async (_url: string, opts: { method: string }) =>
      opts.method === "GET" ? { notes, total: notes.length } : { ok: true },
  );
};

// VSnackbar is stubbed because Vuetify's overlay reaches for `visualViewport`,
// which jsdom does not have - the failure it announces is asserted through the
// queue below instead.
const mount = () =>
  mountSuspended(KategoryzacjaPage, {
    global: {
      stubs: {
        UserChip: true,
        VSnackbar: true,
        NoteTriageSubject: SubjectStub,
      },
    },
  });

/** The tap target for one of the options under the card. */
const option = (wrapper: Awaited<ReturnType<typeof mount>>, label: string) =>
  wrapper.findAll(".v-list-item").find((item) => item.text().includes(label));

const posts = () =>
  mockAuthRequest.mock.calls.filter(([, opts]) => opts.method === "POST");

describe("/admin/notatki/kategoryzacja", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for the entries nobody has classified and shows the first", async () => {
    serveQueue([
      row(),
      row({ key: "note-2:0", noteId: "note-2", note: "druga notatka" }),
    ]);

    const wrapper = await mount();
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledWith(
      "/api/notes/admin",
      expect.objectContaining({
        method: "GET",
        // An entry already handed to the table view must not come round again.
        query: expect.objectContaining({
          adminType: "none",
          deferred: "false",
        }),
      }),
    );
    expect(wrapper.text()).toContain("pierwsza notatka");
    expect(wrapper.text()).toContain("Pozostało do oceny: 2");
  });

  it("saves the type in one tap and moves to the next entry", async () => {
    serveQueue([
      row(),
      row({ key: "note-2:0", noteId: "note-2", note: "druga notatka" }),
    ]);

    const wrapper = await mount();
    await flushPromises();

    await option(wrapper, "Nowe powiązanie")?.trigger("click");
    await flushPromises();

    expect(posts()[0]?.[1].body).toEqual({
      noteId: "note-1",
      sourceIndex: 0,
      adminType: "new_connection",
      adminTypeDeferred: false,
    });
    expect(wrapper.text()).not.toContain("pierwsza notatka");
    expect(wrapper.text()).toContain("druga notatka");
    expect(wrapper.text()).toContain("Pozostało do oceny: 1");
  });

  it("counts the backlog against the batch it belongs to", async () => {
    // A refill is answered by a server that has already seen this sitting's
    // verdicts, so subtracting the whole session from the fresh count would
    // subtract them twice and walk the header down to zero mid-queue.
    let fetches = 0;
    mockAuthRequest.mockImplementation(
      async (_url: string, opts: { method: string }) => {
        if (opts.method !== "GET") return { ok: true };
        fetches += 1;
        return fetches === 1
          ? { notes: [row()], total: 3 }
          : {
              notes: [
                row({
                  key: "note-2:0",
                  noteId: "note-2",
                  note: "druga notatka",
                }),
              ],
              total: 2,
            };
      },
    );

    const wrapper = await mount();
    await flushPromises();
    expect(wrapper.text()).toContain("Pozostało do oceny: 3");

    await option(wrapper, "Inne")?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("druga notatka");
    expect(wrapper.text()).toContain("Pozostało do oceny: 2");
  });

  it("draws who the note is about for a person or a company, not a region", async () => {
    serveQueue([
      row(),
      row({
        key: "note-2:0",
        noteId: "note-2",
        nodeId: "region-1",
        nodeType: "region",
        note: "o regionie",
      }),
      row({
        key: "note-3:0",
        noteId: "note-3",
        nodeId: "company-1",
        nodeType: "place",
        note: "o spółce",
      }),
    ]);
    const subject = (wrapper: Awaited<ReturnType<typeof mount>>) =>
      wrapper.find(".subject-stub");

    const wrapper = await mount();
    await flushPromises();
    // Loaded lazily, so it arrives after the card rather than with it.
    await vi.waitFor(
      () => expect(subject(wrapper).attributes("data-node-id")).toBe("node-1"),
      { timeout: 5000 },
    );

    // A region's relations are every institution in it, so nothing is read
    // for one - not even a loading line.
    await option(wrapper, "Inne")?.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("o regionie");
    expect(subject(wrapper).exists()).toBe(false);
    expect(
      wrapper.find("[data-testid='triage-subject-loading']").exists(),
    ).toBe(false);

    // The next note's node, not the last one's.
    await option(wrapper, "Inne")?.trigger("click");
    await flushPromises();
    await vi.waitFor(
      () =>
        expect(subject(wrapper).attributes("data-node-id")).toBe("company-1"),
      { timeout: 5000 },
    );
  });

  it("hands an entry it cannot judge to the table view", async () => {
    serveQueue([row()]);

    const wrapper = await mount();
    await flushPromises();

    await option(wrapper, "Nie da się ocenić tutaj")?.trigger("click");
    await flushPromises();

    expect(posts()[0]?.[1].body).toEqual({
      noteId: "note-1",
      sourceIndex: 0,
      adminType: null,
      adminTypeDeferred: true,
    });
    // The queue is empty and the entry is waiting elsewhere, not lost.
    expect(wrapper.text()).toContain("Wszystkie notatki skategoryzowane!");
    expect(wrapper.text()).toContain("czeka na ocenę w tabeli");
  });

  it("takes a mistap back", async () => {
    serveQueue([row()]);

    const wrapper = await mount();
    await flushPromises();

    await option(wrapper, "Inne")?.trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("pierwsza notatka");

    await wrapper
      .findAll("button")
      .find((b) => b.text().includes("Cofnij"))
      ?.trigger("click");
    await flushPromises();

    // Back on the card, and the stored verdict is cleared rather than left as
    // whatever the mistap wrote.
    expect(wrapper.text()).toContain("pierwsza notatka");
    expect(posts().at(-1)?.[1].body).toEqual({
      noteId: "note-1",
      sourceIndex: 0,
      adminType: null,
      adminTypeDeferred: false,
    });
  });

  it("puts the card back when the write fails", async () => {
    mockAuthRequest.mockImplementation(
      async (_url: string, opts: { method: string }) => {
        if (opts.method === "GET") return { notes: [row()], total: 1 };
        throw new Error("offline");
      },
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const wrapper = await mount();
    await flushPromises();

    await option(wrapper, "Ciekawostka")?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("pierwsza notatka");
    expect(wrapper.text()).toContain("Pozostało do oceny: 1");
    consoleError.mockRestore();
  });
});
