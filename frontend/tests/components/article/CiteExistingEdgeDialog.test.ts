import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import CiteExistingEdgeDialog from "../../../app/components/article/CiteExistingEdgeDialog.vue";

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

/** Stands in for the entity autocomplete, so a test can say "the editor looked
 * up Jan Kowalski" without driving a search. */
const PickerStub = defineComponent({
  props: { modelValue: { type: Object, default: undefined }, entity: null },
  emits: ["update:modelValue"],
  setup(props) {
    return () =>
      h("div", {
        class: "picker-stub",
        "data-entity": Array.isArray(props.entity)
          ? [...(props.entity as string[])].sort().join(",")
          : String(props.entity),
      });
  },
});

/** What /api/graph/local/[id] answers for Jan Kowalski: a job somebody already
 * cited to this article, and a candidacy resting on nothing. */
const graph = {
  nodes: {
    jan: { name: "Jan Kowalski" },
    orlen: { name: "Orlen" },
    krakow: { name: "Kraków" },
  },
  edges: [
    {
      id: "edge-job",
      source: "jan",
      target: "orlen",
      type: "employed",
      name: "prezes zarządu",
      start_date: "2014-11-06",
      end_date: "2017-08-25",
      references: ["some-other-article"],
    },
    {
      id: "edge-vote",
      source: "jan",
      target: "krakow",
      type: "election",
      references: ["article-1"],
    },
  ],
};

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(CiteExistingEdgeDialog, {
    props: {
      modelValue: true,
      articleId: "article-1",
      articleName: "Zet o spółce",
      ...props,
    },
    global: { plugins: [vuetify], stubs: { FormEntityPicker: PickerStub } },
    attachTo: document.body,
  });
}

/** The dialog is teleported to the body, so every query goes through the
 * document rather than the wrapper. */
function byTestId(testid: string) {
  return document.querySelector(
    `[data-testid="${testid}"]`,
  ) as HTMLElement | null;
}

async function lookUp(wrapper: ReturnType<typeof mountDialog>) {
  const picker = wrapper.findAllComponents(PickerStub)[0]!;
  await picker.vm.$emit("update:modelValue", {
    type: "person",
    id: "jan",
    name: "Jan Kowalski",
  });
  await flushPromises();
}

describe("CiteExistingEdgeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    mockAuthRequest.mockImplementation(async (url: string) =>
      url.startsWith("/api/graph/local/") ? graph : { id: "edge-job" },
    );
  });

  it("lists the relations of whoever was looked up", async () => {
    const wrapper = mountDialog();
    await lookUp(wrapper);

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/graph/local/jan", {
      method: "GET",
      query: { latest: true, distance: 1, center: "jan" },
    });
    expect(byTestId("cite-existing-edge-edge-job")?.textContent).toContain(
      "Jan Kowalski → Orlen",
    );
    expect(byTestId("cite-existing-edge-edge-job")?.textContent).toContain(
      "prezes zarządu · 2014-11-06 - 2017-08-25",
    );
  });

  it("cites the relation that was chosen", async () => {
    const wrapper = mountDialog();
    await lookUp(wrapper);

    byTestId("cite-existing-edge-edge-job")!.click();
    await flushPromises();
    byTestId("cite-existing-submit")!.click();
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledWith(
      "/api/edges/edge-job/references",
      { method: "POST", body: { add: ["article-1"] } },
    );
    expect(wrapper.emitted("added")).toHaveLength(1);
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  });

  it("will not cite the same article twice", async () => {
    // `edge-vote` already rests on this article; the POST would be a no-op, and
    // offering it reads as though the citation had not gone through.
    const wrapper = mountDialog();
    await lookUp(wrapper);

    const row = byTestId("cite-existing-edge-edge-vote")!;
    expect(row.textContent).toContain("już powołuje się na ten artykuł");
    expect(row.className).toContain("disabled");
  });

  it("refuses to submit before a relation is chosen", async () => {
    const wrapper = mountDialog();
    await lookUp(wrapper);

    expect(
      (byTestId("cite-existing-submit") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("says so when the entity has no relations to cite", async () => {
    mockAuthRequest.mockResolvedValue({ nodes: {}, edges: [] });
    const wrapper = mountDialog();
    await lookUp(wrapper);

    expect(byTestId("cite-existing-none")).not.toBeNull();
  });

  it("offers only what the graph draws", async () => {
    // An article is never an end of a citable relation - its own mentions are
    // added from the article page itself.
    const wrapper = mountDialog();
    await flushPromises();

    expect(
      wrapper.findAllComponents(PickerStub)[0]!.attributes("data-entity"),
    ).toBe("person,place,region");
  });
});
