import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import AdminPage from "../../../app/pages/admin/index.vue";

const { mockAuthRequest, claims } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  claims: { current: {} as Record<string, unknown> },
}));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({
    user: {
      value: {
        uid: "me",
        getIdTokenResult: async () => ({ claims: claims.current }),
      },
    },
    isAdmin: { value: true },
  }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

/** The link, as a v-btn: under mountSuspended one with `to` renders no href,
 * so it is found by its label and read by its props. */
const newAdminsLink = (wrapper: Awaited<ReturnType<typeof mountSuspended>>) =>
  wrapper
    .findAllComponents({ name: "VBtn" })
    .find((node) => node.text() === "Nowi administratorzy");

describe("/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Neither panel matters here, and a failed one is the page's own concern.
    mockAuthRequest.mockRejectedValue(new Error("not under test"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("links an established administrator to the trial administrators", async () => {
    claims.current = { admin: true };
    const wrapper = await mountSuspended(AdminPage);
    await flushPromises();

    expect(newAdminsLink(wrapper)?.props("to")).toBe(
      "/aktywnosc?kto=nowi-admini",
    );
  });

  it("takes the link to the reports to the ones it counts", async () => {
    // The card counts the reports nobody has placed in the queue yet. The
    // page opens on the queue, and they are under it - a screen down, once
    // the queue is long.
    claims.current = { admin: true };
    const wrapper = await mountSuspended(AdminPage);
    await flushPromises();

    const link = wrapper
      .findAllComponents({ name: "VBtn" })
      .find((node) => node.text() === "Przejdź do zgłoszeń");
    expect(link?.props("to")).toBe("/admin/opinie#poza-kolejka");
  });

  it("does not link an administrator on trial to a filter they are refused", async () => {
    // The middleware lets them in on `admin` alone; /aktywnosc then ignored
    // the filter for them and said nothing, so the link was a dead end.
    claims.current = { admin: true, newAdmin: true };
    const wrapper = await mountSuspended(AdminPage);
    await flushPromises();

    expect(newAdminsLink(wrapper)).toBeUndefined();
  });

  it("opens each note waiting on an admin at its own entry in the notes queue", async () => {
    // The card listed who the notes were about and nothing could be clicked,
    // so the only way to act on one was to find it again on /admin/notatki.
    claims.current = { admin: true };
    mockAuthRequest.mockImplementation(async (url: string) => {
      if (url !== "/api/admin/summary") throw new Error("not under test");
      return {
        feedback: { needsAction: 0, sample: [] },
        notes: {
          needsAction: 1,
          uncategorized: 0,
          sample: [
            {
              key: "note-1:3",
              noteId: "note-1",
              nodeId: "node-1",
              name: "Jan Kowalski",
              url: null,
              note: "zła data urodzenia",
              kind: "change_request",
              adminType: null,
            },
          ],
        },
        revisions: {
          unapproved: 0,
          unapprovedManual: 0,
          inspected: 0,
          truncated: false,
          sample: [],
        },
      };
    });

    const wrapper = await mountSuspended(AdminPage);
    await flushPromises();

    const row = wrapper
      .findAllComponents({ name: "VListItem" })
      .find((item) => item.text().includes("Jan Kowalski"));
    expect(row).toBeDefined();
    expect(row?.props("to")).toEqual({
      path: "/admin/notatki",
      query: { note: "note-1:3" },
    });
  });
});
