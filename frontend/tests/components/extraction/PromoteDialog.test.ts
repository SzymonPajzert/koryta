import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import PromoteDialog from "../../../app/components/extraction/PromoteDialog.vue";
import { factEdgeRule } from "../../../app/utils/extraction";
import type { ExtractionFact } from "../../../shared/model";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({ authRequest: mockAuthRequest }));

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
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as unknown as VisualViewport;

/** Stands in for the entity autocomplete, so a test can say "the reader picked
 * the company" without driving a search. */
const PickerStub = defineComponent({
  props: { modelValue: { type: Object, default: undefined } },
  emits: ["update:modelValue"],
  setup() {
    return () => h("div", { class: "picker-stub" });
  },
});

const fact: ExtractionFact = {
  id: "fact-1",
  url: "example.com/a",
  articleUrl: "example.com/a",
  justification: "prezes Spółki Wodnej Piotr Gajda",
  fact_type: "employment",
  person: "Piotr Gajda",
  organization: "Spółka Wodna",
  role: "prezes zarządu",
  personNodeId: "person-1",
  personNodeName: "Piotr Gajda",
  tag: "v26",
};

function mountDialog() {
  return mount(PromoteDialog, {
    props: {
      modelValue: false,
      fact,
      rule: factEdgeRule(fact)!,
      "onUpdate:modelValue": (value: boolean) =>
        wrapper.setProps({ modelValue: value }),
    },
    global: { plugins: [vuetify], stubs: { FormEntityPicker: PickerStub } },
    attachTo: document.body,
  });
}

let wrapper: ReturnType<typeof mountDialog>;

/** The dialog is teleported to the body, so every query goes through the
 * document rather than the wrapper. */
function byTestId(testid: string) {
  return document.querySelector(
    `[data-testid="${testid}"]`,
  ) as HTMLElement | null;
}

/** Opens the dialog, picks the company and sends it. */
async function promote() {
  // Opened after mounting, as the card does: the fields are filled in from
  // the fact when the dialog opens.
  await wrapper.setProps({ modelValue: true });
  await flushPromises();
  await wrapper.findComponent(PickerStub).vm.$emit("update:modelValue", {
    type: "place",
    id: "place-1",
    name: "Spółka Wodna",
  });
  await flushPromises();
  byTestId("promote-fact-submit")!.click();
  await flushPromises();
}

describe("ExtractionPromoteDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    wrapper = mountDialog();
  });

  it("names the fact it was opened on, so the fact can record the relation", async () => {
    mockAuthRequest.mockResolvedValue({ id: "edge-1", created: true });
    await promote();

    expect(mockAuthRequest).toHaveBeenCalledWith(
      "/api/edges/create",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          source: "person-1",
          target: "place-1",
          type: "employed",
          name: "prezes zarządu",
          extraction: "fact-1",
        }),
      }),
    );
  });

  it("closes on a new relation and tells the card", async () => {
    mockAuthRequest.mockResolvedValue({ id: "edge-1", created: true });
    await promote();

    expect(wrapper.emitted("promoted")).toEqual([["edge-1"]]);
    expect(wrapper.props("modelValue")).toBe(false);
  });

  it("says so, instead of closing as if it had made one, when the relation was there already", async () => {
    // The endpoint stores a relation under its identity and hands back the
    // stored one's id: promoting a fact twice, or a relation somebody already
    // added with „Dodaj”, writes nothing. Closing quietly would claim a
    // relation the reader did not add.
    mockAuthRequest.mockResolvedValue({ id: "edge-1", created: false });
    await promote();

    expect(wrapper.props("modelValue")).toBe(true);
    expect(byTestId("promote-fact-exists")?.textContent).toContain(
      "już jest w bazie",
    );
    // Nothing left to send: the one way on is to close.
    expect(byTestId("promote-fact-submit")).toBeNull();
    // The fact does stand for that relation now, so its card stops offering
    // the promotion all the same.
    expect(wrapper.emitted("promoted")).toEqual([["edge-1"]]);
  });

  it("says an administrator removed it, and does not retire the button", async () => {
    // The same relation existed and was deleted: nothing is written, and the
    // fact is not tied to a relation that is not in the graph.
    mockAuthRequest.mockResolvedValue({
      id: "edge-1",
      created: false,
      deleted: true,
    });
    await promote();

    expect(wrapper.props("modelValue")).toBe(true);
    expect(byTestId("promote-fact-deleted")?.textContent).toContain(
      "administrator je usunął",
    );
    expect(byTestId("promote-fact-exists")).toBeNull();
    expect(wrapper.emitted("promoted")).toBeUndefined();
  });

  it("forgets that when it is opened again", async () => {
    mockAuthRequest.mockResolvedValue({ id: "edge-1", created: false });
    await promote();
    await wrapper.setProps({ modelValue: false });
    await flushPromises();

    await wrapper.setProps({ modelValue: true });
    await flushPromises();

    expect(byTestId("promote-fact-exists")).toBeNull();
    expect(byTestId("promote-fact-submit")).not.toBeNull();
  });
});
