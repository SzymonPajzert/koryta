import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import EdgeSourcesDialog from "../../../app/components/form/EdgeSourcesDialog.vue";

const { mockAuthRequest, currentUser } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  currentUser: { value: { uid: "u1" } as { uid: string } | null },
}));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: currentUser }),
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
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as unknown as VisualViewport;

/** Stands in for the article autocomplete, so a test can say "the editor chose
 * this article" without driving a search. */
const PickerStub = defineComponent({
  props: { modelValue: { type: Object, default: undefined }, entity: null },
  emits: ["update:modelValue"],
  setup(props) {
    return () =>
      h("div", { class: "picker-stub", "data-entity": String(props.entity) });
  },
});

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(EdgeSourcesDialog, {
    props: {
      modelValue: true,
      edgeId: "edge-1",
      edgeLabel: "Jan Kowalski - Prezes - Orlen",
      ...props,
    },
    global: { plugins: [vuetify], stubs: { FormEntityPicker: PickerStub } },
    attachTo: document.body,
  });
}

const zet = {
  id: "article-1",
  name: "Zet o spółce",
  sourceURL: "https://zet.pl/tekst",
  published: true,
};

/** The dialog's content is teleported to the body, so every query goes through
 * the document rather than the wrapper. */
function byTestId(testid: string) {
  return document.querySelector(
    `[data-testid="${testid}"]`,
  ) as HTMLElement | null;
}

/** The calls that changed something, as opposed to the reads around them. */
function posts() {
  return mockAuthRequest.mock.calls.filter(
    ([, options]) => options?.method === "POST",
  );
}

async function pickArticle(
  wrapper: ReturnType<typeof mountDialog>,
  article: { id: string; name: string },
) {
  const picker = wrapper.findAllComponents(PickerStub)[0]!;
  await picker.vm.$emit("update:modelValue", {
    type: "article",
    id: article.id,
    name: article.name,
  });
  await flushPromises();
}

describe("EdgeSourcesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser.value = { uid: "u1" };
    document.body.innerHTML = "";
    mockAuthRequest.mockImplementation(async (_url: string, options) =>
      options?.method === "POST"
        ? { id: "edge-1", references: [] }
        : { id: "edge-1", sources: [zet] },
    );
  });

  it("names what the relation rests on when it opens", async () => {
    mountDialog();
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledWith(
      "/api/edges/edge-1/references",
      { method: "GET", query: { latest: true } },
    );
    expect(document.body.textContent).toContain("Zet o spółce");
  });

  it("says so when nothing has been cited yet", async () => {
    mockAuthRequest.mockResolvedValue({ id: "edge-1", sources: [] });
    mountDialog();
    await flushPromises();

    expect(byTestId("edge-sources-empty")).not.toBeNull();
  });

  it("attaches the article that was picked", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await pickArticle(wrapper, { id: "article-9", name: "Nowy tekst" });

    byTestId("edge-sources-add")!.click();
    await flushPromises();

    expect(posts()[0]).toEqual([
      "/api/edges/edge-1/references",
      { method: "POST", body: { add: ["article-9"] } },
    ]);
    // Re-read rather than patched in the browser, so a source somebody else
    // added in the meantime is on screen too.
    expect(wrapper.emitted("changed")).toHaveLength(1);
    expect(
      mockAuthRequest.mock.calls.filter(([, o]) => o?.method === "GET"),
    ).toHaveLength(2);
  });

  it("detaches a source without touching the others", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    byTestId("edge-sources-detach-article-1")!.click();
    await flushPromises();

    expect(posts()[0]).toEqual([
      "/api/edges/edge-1/references",
      { method: "POST", body: { remove: ["article-1"] } },
    ]);
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("keeps the rejected write on screen instead of a blank dialog", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    mockAuthRequest.mockRejectedValueOnce({
      data: { message: "Źródło ghost nie jest artykułem w bazie." },
    });
    await pickArticle(wrapper, { id: "ghost", name: "Widmo" });

    byTestId("edge-sources-add")!.click();
    await flushPromises();

    expect(byTestId("edge-sources-error")?.textContent).toContain(
      "nie jest artykułem w bazie",
    );
    expect(wrapper.emitted("changed")).toBeUndefined();
  });

  it("shows a logged out reader the sources but no way to change them", async () => {
    currentUser.value = null;
    mountDialog();
    await flushPromises();

    expect(document.body.textContent).toContain("Zet o spółce");
    expect(byTestId("edge-sources-add")).toBeNull();
    expect(byTestId("edge-sources-detach-article-1")).toBeNull();
  });
});
