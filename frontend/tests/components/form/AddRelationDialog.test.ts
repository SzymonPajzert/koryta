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

/** Types into one of the dialog's text fields, found by its testid. */
async function type(testid: string, value: string) {
  const input = document.querySelector(
    `[data-testid="${testid}"] input`,
  ) as HTMLInputElement | null;
  if (!input) throw new Error(`no field ${testid}`);
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await flushPromises();
}

/** What reached /api/edges/create. */
function created() {
  const call = mockAuthRequest.mock.calls.find(
    ([url]) => url === "/api/edges/create",
  );
  return call?.[1]?.body as Record<string, unknown> | undefined;
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

  describe("a tie between two people", () => {
    it("names both readings, either side of an arrow", async () => {
      // Polish would want a case in a sentence here and there is no declining
      // an arbitrary surname, so the pair is shown either way round instead.
      const wrapper = mountDialog();
      await pick(wrapper, piotr);

      expect(document.body.textContent).toContain("Jan Kowalski → Piotr W.");
      expect(document.body.textContent).toContain("Piotr W. → Jan Kowalski");
    });

    it("will not store one word for both people", async () => {
      // The bug this feature is about: "żona" typed on Jan's page used to be
      // printed at him on Anna's too.
      const wrapper = mountDialog();
      await pick(wrapper, piotr);
      await type("add-relation-name", "ojciec");

      expect(submitButton().disabled).toBe(true);

      await type("add-relation-reverse-name", "syn");
      expect(submitButton().disabled).toBe(false);

      await submit();
      expect(created()).toMatchObject({
        type: "connection",
        name: "ojciec",
        reverse_name: "syn",
      });
    });

    it("offers the other side as chips to click", async () => {
      const wrapper = mountDialog();
      await pick(wrapper, piotr);
      await type("add-relation-name", "żona");

      const chip = document.querySelector(
        '[data-testid="add-relation-reverse-suggestion-mąż"]',
      ) as HTMLElement | null;
      expect(chip).not.toBeNull();

      chip!.click();
      await flushPromises();
      await submit();

      expect(created()).toMatchObject({ name: "żona", reverse_name: "mąż" });
    });

    it("lets a nameless tie through, having nothing to reverse", async () => {
      // With no word at all both pages print "Powiązanie z", which is already
      // the same claim from either end.
      const wrapper = mountDialog();
      await pick(wrapper, piotr);

      expect(submitButton().disabled).toBe(false);
    });
  });

  it("does not ask an employment for a second reading", async () => {
    // A job title reads the same on the person's page and the company's.
    const wrapper = mountDialog();
    await pick(wrapper, orlen);
    await type("add-relation-name", "prezes zarządu");

    expect(
      document.querySelector('[data-testid="add-relation-reverse-name"]'),
    ).toBeNull();
    expect(submitButton().disabled).toBe(false);
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
