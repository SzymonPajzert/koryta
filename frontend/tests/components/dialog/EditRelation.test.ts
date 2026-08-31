import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import EditRelation from "../../../app/components/dialog/EditRelation.vue";
import RelationDetailFields from "../../../app/components/form/RelationDetailFields.vue";
import type { EdgeNode } from "../../../app/composables/edges";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: { uid: "u1" } } }),
}));

const vuetify = createVuetify({ components, directives });

// Vuetify's overlay measures the viewport as it opens, and jsdom has neither of
// these. Without them the dialog throws before it renders anything.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
global.visualViewport = {
  width: 1024,
  height: 768,
  offsetLeft: 0,
  offsetTop: 0,
  pageLeft: 0,
  pageTop: 0,
  scale: 1,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as unknown as VisualViewport;

/** An employment as `useEdges` hands it over: the stored fields plus the node
 * at the other end, and a `label` that stands in for a missing name. */
function employment(overrides: Partial<EdgeNode> = {}): EdgeNode {
  return {
    id: "e1",
    type: "employed",
    label: "czlonek rady nadzorczej",
    name: "czlonek rady nadzorczej",
    source: "jan",
    target: "orlen",
    start_date: "2019-01-01",
    richNode: { id: "orlen", type: "place", name: "Orlen" },
    ...overrides,
  } as EdgeNode;
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(EditRelation, {
    props: {
      modelValue: true,
      edge: employment(),
      edgeLabel: "Jan Kowalski - czlonek rady nadzorczej - Orlen",
      ...props,
    },
    global: { plugins: [vuetify] },
    attachTo: document.body,
  });
}

/** The dialog's content is teleported to the body, so every query below goes
 * through the document rather than through the wrapper. */
function byTestId(id: string): HTMLElement {
  const el = document.querySelector(`[data-testid="${id}"]`);
  if (!el) throw new Error(`${id} not rendered`);
  return el as HTMLElement;
}

/** What reached /api/edges/update. */
function sent() {
  const call = mockAuthRequest.mock.calls.find(
    ([url]) => url === "/api/edges/update",
  );
  return call?.[1]?.body as Record<string, unknown> | undefined;
}

async function submit() {
  (byTestId("edit-relation-submit") as HTMLButtonElement).click();
  await flushPromises();
}

describe("DialogEditRelation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthRequest.mockResolvedValue({
      edge_id: "e1",
      revision_id: "r1",
      applied: false,
      unchanged: false,
    });
    document.body.innerHTML = "";
  });

  it("prefills from what the relation stores", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    expect(wrapper.findComponent(RelationDetailFields).props()).toMatchObject({
      realType: "employed",
      modelValue: expect.objectContaining({
        name: "czlonek rady nadzorczej",
        start_date: "2019-01-01",
      }),
    });
  });

  it("does not offer the fallback label back as a job title", async () => {
    // A relation with no name of its own prints the edge type's phrase; storing
    // that as the role on the first save is how "Zatrudniony/a w" would end up
    // in the position column of somebody's page.
    const wrapper = mountDialog({
      edge: employment({ name: undefined, label: "Zatrudniony/a w" }),
    });
    await flushPromises();

    expect(
      wrapper.findComponent(RelationDetailFields).props("modelValue"),
    ).toMatchObject({ name: "" });
  });

  it("sends the edited fields and the edge id, and nothing else", async () => {
    mountDialog();
    await flushPromises();
    await submit();

    expect(sent()).toEqual({
      edge_id: "e1",
      name: "czlonek rady nadzorczej",
      start_date: "2019-01-01",
      end_date: "",
      party: "",
      committee: "",
    });
  });

  it("reports whether the change went live or into the queue", async () => {
    mockAuthRequest.mockResolvedValue({
      edge_id: "e1",
      revision_id: "r1",
      applied: true,
      unchanged: false,
    });
    const wrapper = mountDialog();
    await flushPromises();
    await submit();

    expect(wrapper.emitted("saved")).toEqual([[true]]);
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  });

  it("says what went wrong and stays open", async () => {
    mockAuthRequest.mockRejectedValue({
      data: { message: "To powiązanie zostało usunięte" },
    });
    const wrapper = mountDialog();
    await flushPromises();
    await submit();

    expect(byTestId("edit-relation-error").textContent).toContain(
      "To powiązanie zostało usunięte",
    );
    expect(wrapper.emitted("saved")).toBeUndefined();
  });

  it("will not save a date it cannot parse", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper
      .findComponent(RelationDetailFields)
      .vm.$emit("update:modelValue", {
        name: "prezes",
        start_date: "styczeń 2019",
        end_date: "",
        party: "",
        committee: "",
      });
    await flushPromises();
    await submit();

    expect(sent()).toBeUndefined();
  });
});
