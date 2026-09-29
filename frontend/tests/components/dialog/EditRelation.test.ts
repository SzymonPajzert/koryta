import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import EditRelation from "../../../app/components/dialog/EditRelation.vue";
import RelationDetailFields from "../../../app/components/form/RelationDetailFields.vue";
import type { EdgeNode } from "../../../app/composables/edges";
import { electionPositions } from "../../../shared/misc";

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

/** A candidacy as `useEdges` hands it over: the far end is the region the
 * person stood in. */
function candidacy(overrides: Partial<EdgeNode> = {}): EdgeNode {
  return {
    id: "e2",
    type: "election",
    label: "kandydatura",
    name: "kandydatura",
    source: "jan",
    target: "krakow",
    position: "Senat",
    start_date: "2023-01-01",
    richNode: { id: "krakow", type: "region", name: "Kraków" },
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

/** The „Typ wyborów" select. Its menu is teleported and jsdom has no layout
 * to open it by, so a test picks through the component's own model event -
 * which is what a click on an option ends in. */
function kindSelect(wrapper: ReturnType<typeof mountDialog>) {
  const select = wrapper
    .findAllComponents(components.VSelect)
    .find((candidate) => candidate.props("label") === "Typ wyborów");
  if (!select) throw new Error("no „Typ wyborów” select");
  return select;
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

    // No `elected`: the box is a candidacy's, and an employment's form does
    // not show it, so it has nothing to say about one.
    expect(sent()).toEqual({
      edge_id: "e1",
      name: "czlonek rady nadzorczej",
      start_date: "2019-01-01",
      end_date: "",
      party: "",
      committee: "",
    });
  });

  it("offers no win on a relation that is not a candidacy", async () => {
    mountDialog();
    await flushPromises();

    expect(
      document.querySelector('[data-testid="edit-relation-elected"]'),
    ).toBeNull();
  });

  it("shows a candidacy's win as ticked", async () => {
    const wrapper = mountDialog({ edge: candidacy({ elected: true }) });
    await flushPromises();

    const box = byTestId("edit-relation-elected").querySelector("input");
    expect(box?.checked).toBe(true);
    expect(
      wrapper.findComponent(RelationDetailFields).props("modelValue"),
    ).toMatchObject({ elected: true });
  });

  it("marks a candidacy as won", async () => {
    // The report: the edit view had no way to say a candidacy was won, which
    // only the old full-page form could do.
    mountDialog({ edge: candidacy() });
    await flushPromises();

    const box = byTestId("edit-relation-elected").querySelector("input")!;
    expect(box.checked).toBe(false);
    box.click();
    await flushPromises();
    await submit();

    expect(sent()).toMatchObject({ edge_id: "e2", elected: true });
  });

  describe("which election a candidacy was for", () => {
    it("is offered as the relation stores it", async () => {
      const wrapper = mountDialog({
        edge: candidacy({ position: "Samorząd" }),
      });
      await flushPromises();

      expect(
        wrapper.findComponent(RelationDetailFields).props("modelValue"),
      ).toMatchObject({ position: "Samorząd" });
      expect(kindSelect(wrapper).props("modelValue")).toBe("Samorząd");
    });

    it("offers every kind the site stores, and nothing else", async () => {
      // `edgeEditSchema` refuses anything off this list, so an option that is
      // not on it would be a pick that can only fail to save.
      const wrapper = mountDialog({ edge: candidacy() });
      await flushPromises();

      const offered = (
        kindSelect(wrapper).props("items") as Array<{ value: string }>
      ).map((item) => item.value);
      expect(offered).toEqual(electionPositions);
    });

    it("sends the kind the reader picked", async () => {
      // The report: the row said „Samorząd”, and the edit window had no field
      // to say that the run was for the sejmik.
      const wrapper = mountDialog({
        edge: candidacy({ position: "Samorząd" }),
      });
      await flushPromises();
      kindSelect(wrapper).vm.$emit("update:modelValue", "Sejmik");
      await flushPromises();
      await submit();

      expect(sent()).toMatchObject({ edge_id: "e2", position: "Sejmik" });
    });

    it("is left out while nobody has picked one", async () => {
      // A candidacy stored without a kind keeps having none when only its date
      // is corrected - and the server takes no empty kind.
      mountDialog({ edge: candidacy({ position: undefined }) });
      await flushPromises();
      await submit();

      expect(sent()).toMatchObject({ edge_id: "e2" });
      expect(sent()).not.toHaveProperty("position");
    });

    it("is not restated when the reader corrects something else", async () => {
      // A kind off the list - „Rada sejmiku” is what the PKW headers map
      // „Sejmik” to - would fail `edgeEditSchema` and the whole correction
      // with it, over a field nobody touched.
      mountDialog({
        edge: candidacy({
          position: "Rada sejmiku" as EdgeNode["position"],
        }),
      });
      await flushPromises();
      const box = byTestId("edit-relation-elected").querySelector("input")!;
      box.click();
      await flushPromises();
      await submit();

      expect(sent()).toMatchObject({ edge_id: "e2", elected: true });
      expect(sent()).not.toHaveProperty("position");
    });

    it("is not asked of a relation that is not a candidacy", async () => {
      mountDialog();
      await flushPromises();

      expect(
        document.querySelector('[data-testid="edit-relation-position"]'),
      ).toBeNull();
    });
  });

  describe("a candidacy's dates", () => {
    /** A candidacy the way the page hands it over: the pipeline stored
     * „2024-01-01", and `edgeFromDB` turned that into the day of the 2024
     * election and made the end the same day. */
    const shown = () =>
      candidacy({
        position: "Samorząd",
        start_date: "2024-04-07",
        end_date: "2024-04-07",
      });

    it("are not written back when the reader corrects something else", async () => {
      // They are not what is stored, so restating them would move the stored
      // date - and with it which candidacy the pipeline recognises this as.
      const wrapper = mountDialog({ edge: shown() });
      await flushPromises();
      kindSelect(wrapper).vm.$emit("update:modelValue", "Rada gminy");
      await flushPromises();
      await submit();

      expect(sent()).toMatchObject({ edge_id: "e2", position: "Rada gminy" });
      expect(sent()).not.toHaveProperty("start_date");
      expect(sent()).not.toHaveProperty("end_date");
    });

    it("are sent once the reader changes them", async () => {
      const wrapper = mountDialog({ edge: shown() });
      await flushPromises();
      await wrapper
        .findComponent(RelationDetailFields)
        .vm.$emit("update:modelValue", {
          ...wrapper.findComponent(RelationDetailFields).props("modelValue"),
          start_date: "2018-10-21",
        });
      await flushPromises();
      await submit();

      expect(sent()).toMatchObject({ start_date: "2018-10-21" });
      expect(sent()).not.toHaveProperty("end_date");
    });

    it("leave an employment's dates as they always went", async () => {
      // An employment's dates are the stored ones, so the dialog sends them
      // whether or not they changed - see the first test in this file.
      mountDialog();
      await flushPromises();
      await submit();

      expect(sent()).toMatchObject({ start_date: "2019-01-01", end_date: "" });
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
        elected: false,
      });
    await flushPromises();
    await submit();

    expect(sent()).toBeUndefined();
  });
});
