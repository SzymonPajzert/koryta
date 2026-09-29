import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import AddRelationDialog from "../../../app/components/form/AddRelationDialog.vue";
import type { Link, NodeType } from "~~/shared/model";

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

/** Stands in for the autocomplete, so a test can say "the reader picked Orlen"
 * without driving a search. It reports the kinds it was asked to offer, which
 * is the half of the picker's contract this component decides. */
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

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(AddRelationDialog, {
    props: {
      modelValue: true,
      nodeId: "node-1",
      nodeType: "person" as NodeType,
      nodeName: "Jan Kowalski",
      ...props,
    },
    global: {
      plugins: [vuetify],
      stubs: { FormEntityPicker: PickerStub },
    },
    attachTo: document.body,
  });
}

/** Says the reader chose `other` in the entity picker. */
async function pick(
  wrapper: ReturnType<typeof mountDialog>,
  other: Link<NodeType>,
) {
  const picker = wrapper.findAllComponents(PickerStub)[0]!;
  await picker.vm.$emit("update:modelValue", other);
  await flushPromises();
}

const orlen: Link<NodeType> = { id: "orlen", type: "place", name: "Orlen" };
const piotr: Link<NodeType> = { id: "piotr", type: "person", name: "Piotr W." };

/** The dialog's content is teleported to the body, so the wrapper cannot see
 * it - every query below goes through the document. */
function submitButton(): HTMLButtonElement {
  const el = document.querySelector(
    '[data-testid="add-relation-submit"]',
  ) as HTMLButtonElement | null;
  if (!el) throw new Error("submit button not rendered");
  return el;
}

async function submit() {
  submitButton().click();
  await flushPromises();
}

/** What reached /api/edges/create. */
function created() {
  const call = mockAuthRequest.mock.calls.find(
    ([url]) => url === "/api/edges/create",
  );
  return call?.[1]?.body as Record<string, unknown> | undefined;
}

/** Picks a kind of election in the „Typ wyborów" select, through the
 * component's own model event: its menu is teleported, and jsdom has no layout
 * to open it by. */
async function pickKind(wrapper: ReturnType<typeof mountDialog>, kind: string) {
  const select = wrapper
    .findAllComponents(components.VSelect)
    .find((candidate) => candidate.props("label") === "Typ wyborów");
  if (!select) throw new Error("no „Typ wyborów” select");
  select.vm.$emit("update:modelValue", kind);
  await flushPromises();
}

describe("AddRelationDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthRequest.mockResolvedValue({ id: "edge-new" });
    document.body.innerHTML = "";
  });

  it("asks for the entity before asking what the relation is", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    expect(document.body.textContent).not.toContain("jest powiązany/a z");
    expect(wrapper.findAllComponents(PickerStub).length).toBeGreaterThan(0);
  });

  it("searches only the kinds the page can be joined to", async () => {
    // A person can be tied to a person, a company or a region - never to an
    // article, which is the source picker's job.
    const wrapper = mountDialog();
    await flushPromises();

    const entity = wrapper
      .findAllComponents(PickerStub)[0]!
      .attributes("data-entity");
    expect(entity).toBe("person,place,region");
  });

  it("narrows the search when a section says what it is about", async () => {
    const wrapper = mountDialog({ types: ["employed"] });
    await flushPromises();

    expect(
      wrapper.findAllComponents(PickerStub)[0]!.attributes("data-entity"),
    ).toBe("place");
  });

  it("offers the verbs that fit the pair, once one is picked", async () => {
    const wrapper = mountDialog();
    await pick(wrapper, orlen);

    expect(document.body.textContent).toContain("pracował/a w");
    expect(document.body.textContent).not.toContain("jest powiązany/a z");
  });

  it("offers a different verb for a different kind of entity", async () => {
    const wrapper = mountDialog();
    await pick(wrapper, piotr);

    expect(document.body.textContent).toContain("jest powiązany/a z");
    expect(document.body.textContent).not.toContain("pracował/a w");
  });

  it("writes the page as the source when the verb reads outwards", async () => {
    const wrapper = mountDialog();
    await pick(wrapper, orlen);

    await submit();

    expect(created()).toMatchObject({
      source: "node-1",
      target: "orlen",
      type: "employed",
    });
  });

  it("swaps the ends when the verb reads inwards", async () => {
    // On a company's page "zatrudniał/a" means the company is the employer, so
    // the person has to go on the source end whatever was picked.
    const wrapper = mountDialog({ nodeType: "place", nodeName: "Orlen" });
    await pick(wrapper, piotr);

    await submit();

    expect(created()).toMatchObject({ source: "piotr", target: "node-1" });
  });

  it("records a candidacy's win when the box is ticked", async () => {
    // The same fields as the correction dialog, so a win can be said when the
    // candidacy is first typed rather than only in a second edit.
    const wrapper = mountDialog();
    await pick(wrapper, { id: "krakow", type: "region", name: "Kraków" });

    const box = document
      .querySelector('[data-testid="add-relation-elected"]')
      ?.querySelector("input");
    expect(box).toBeTruthy();
    box!.click();
    await flushPromises();
    await submit();

    expect(created()).toMatchObject({ type: "election", elected: true });
  });

  it("drops the win when the reader switches to a relation that has none", async () => {
    // The fields outlive a change of mind - only opening the dialog clears
    // them - so a box ticked on a region would otherwise ride along, unseen,
    // onto the employment picked after it.
    const wrapper = mountDialog();
    await pick(wrapper, { id: "krakow", type: "region", name: "Kraków" });
    document
      .querySelector('[data-testid="add-relation-elected"]')
      ?.querySelector("input")
      ?.click();
    await flushPromises();

    await pick(wrapper, orlen);
    await submit();

    expect(created()).toMatchObject({ type: "employed" });
    expect(created()?.elected).not.toBe(true);
  });

  it("records which election a candidacy was for", async () => {
    // Typed in when the candidacy is, or the row it makes reads „kandydatura”
    // and a region, which is the report this field answers.
    const wrapper = mountDialog();
    await pick(wrapper, { id: "krakow", type: "region", name: "Kraków" });
    await pickKind(wrapper, "Senat");
    await submit();

    expect(created()).toMatchObject({ type: "election", position: "Senat" });
  });

  it("drops the kind of election when the reader switches to an employment", async () => {
    // Kept across the switch like the win above, so it has to be dropped the
    // same way - an employment with „Sejm” on it would be a claim nobody made.
    const wrapper = mountDialog();
    await pick(wrapper, { id: "krakow", type: "region", name: "Kraków" });
    await pickKind(wrapper, "Sejm");

    await pick(wrapper, orlen);
    await submit();

    expect(created()).toMatchObject({ type: "employed", position: "" });
  });

  it("says so when nothing can join the two", async () => {
    const wrapper = mountDialog({ nodeType: "region", nodeName: "Mazowsze" });
    await pick(wrapper, { id: "r2", type: "region", name: "Podlasie" });

    expect(document.body.textContent).toContain(
      "Nie ma powiązania, które łączyłoby te dwie strony",
    );
  });

  it("refuses to submit before an entity is chosen", async () => {
    mountDialog();
    await flushPromises();

    expect(submitButton().disabled).toBe(true);
  });

  it("refuses to join a page to itself", async () => {
    const wrapper = mountDialog();
    await pick(wrapper, { id: "node-1", type: "person", name: "Jan Kowalski" });

    expect(submitButton().disabled).toBe(true);
  });

  it("reports what the server refused, rather than closing", async () => {
    mockAuthRequest.mockRejectedValueOnce({
      data: { message: "Brak uprawnień." },
    });
    const wrapper = mountDialog();
    await pick(wrapper, orlen);

    await submit();

    expect(document.body.textContent).toContain("Brak uprawnień.");
    expect(wrapper.emitted("added")).toBeUndefined();
  });

  it("announces the write and closes", async () => {
    const wrapper = mountDialog();
    await pick(wrapper, orlen);

    await submit();

    expect(wrapper.emitted("added")).toHaveLength(1);
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  });

  it("forgets the last relation when it reopens", async () => {
    // Leaving the fields filled is how somebody records the same job twice.
    const wrapper = mountDialog();
    await pick(wrapper, orlen);
    expect(document.body.textContent).toContain("pracował/a w");

    await wrapper.setProps({ modelValue: false });
    await flushPromises();
    await wrapper.setProps({ modelValue: true });
    await flushPromises();

    expect(document.body.textContent).not.toContain("pracował/a w");
  });
});
