import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import RelacjePage from "../../../app/pages/admin/relacje.vue";
import type { MissingReverseRow } from "~~/server/api/edges/missingReverse.get";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: { uid: "admin" } } }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

function row(id: string, name: string): MissingReverseRow {
  return {
    id,
    name,
    sourceId: "jan",
    sourceName: "Jan Kowalski",
    targetId: "anna",
    targetName: "Anna Kowalska",
    content: null,
    published: true,
  };
}

/** The queue answers the GET; every POST reports everything as written. */
function serve(rows: MissingReverseRow[]) {
  mockAuthRequest.mockImplementation(
    async (url: string, opts: { method?: string; body?: unknown }) => {
      if (url === "/api/edges/missingReverse") {
        return {
          edges: rows,
          nextCursor: null,
          scanned: rows.length,
          truncated: false,
        };
      }
      const updates = (opts.body as { updates: { edge_id: string }[] }).updates;
      return {
        updated: updates.map((update) => update.edge_id),
        unchanged: [],
        skipped: [],
      };
    },
  );
}

const mount = () => mountSuspended(RelacjePage);

/** What reached /api/edges/reverseNames, flattened across chunks. */
function saved() {
  return mockAuthRequest.mock.calls
    .filter(([url]) => url === "/api/edges/reverseNames")
    .flatMap(([, opts]) => opts.body.updates as unknown[]);
}

describe("admin queue of one-sided relations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows what each relation says and offers the other side", async () => {
    serve([row("e1", "żona")]);
    const wrapper = await mount();

    expect(wrapper.text()).toContain("żona");
    expect(
      wrapper.find('[data-testid="reverse-suggestion-e1-mąż"]').exists(),
    ).toBe(true);
  });

  it("counts only the rows the vocabulary answers without a choice", async () => {
    // A father's child is a "syn" or a "córka" and the relation says nothing
    // about which, so that row is never filled in unattended.
    serve([row("e1", "żona"), row("e2", "ojciec"), row("e3", "kanclerz")]);
    const wrapper = await mount();

    expect(wrapper.text()).toContain("Wypełnij oczywiste (1)");
  });

  it("fills the obvious ones and saves them together", async () => {
    serve([row("e1", "żona"), row("e2", "mąż"), row("e3", "ojciec")]);
    const wrapper = await mount();

    await wrapper.get('[data-testid="reverse-fill-obvious"]').trigger("click");
    expect(wrapper.text()).toContain("Zapisz wypełnione (2)");

    await wrapper.get('[data-testid="reverse-save"]').trigger("click");

    expect(saved()).toEqual([
      { edge_id: "e1", reverse_name: "mąż" },
      { edge_id: "e2", reverse_name: "żona" },
    ]);
  });

  it("saves a word picked off a chip", async () => {
    serve([row("e1", "ojciec")]);
    const wrapper = await mount();

    await wrapper
      .get('[data-testid="reverse-suggestion-e1-córka"]')
      .trigger("click");
    await wrapper.get('[data-testid="reverse-save"]').trigger("click");

    expect(saved()).toEqual([{ edge_id: "e1", reverse_name: "córka" }]);
  });

  it("has nothing to save until something is filled in", async () => {
    serve([row("e1", "żona")]);
    const wrapper = await mount();

    expect(
      wrapper.get('[data-testid="reverse-save"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("says how much of the collection it had to read", async () => {
    // The scan is the cost, and a page that cost 3000 reads for two rows is
    // worth knowing about - see `scanEdges`.
    serve([row("e1", "żona")]);
    const wrapper = await mount();

    expect(wrapper.text()).toContain("Przejrzano 1 powiązań osobistych");
  });

  it("reports what the server refused rather than claiming it saved", async () => {
    mockAuthRequest.mockImplementation(async (url: string) => {
      if (url === "/api/edges/missingReverse") {
        return {
          edges: [row("e1", "żona")],
          nextCursor: null,
          scanned: 1,
          truncated: false,
        };
      }
      return {
        updated: [],
        unchanged: [],
        skipped: [{ edge_id: "e1", reason: "Powiązanie usunięte." }],
      };
    });
    const wrapper = await mount();

    await wrapper
      .get('[data-testid="reverse-suggestion-e1-mąż"]')
      .trigger("click");
    await wrapper.get('[data-testid="reverse-save"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="reverse-queue-error"]').text()).toContain(
      "Powiązanie usunięte.",
    );
  });
});
