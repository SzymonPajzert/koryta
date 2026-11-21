import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import AddRelationDialog from "../../../app/components/form/AddRelationDialog.vue";
import type { Link, NodeType } from "~~/shared/model";
import type { RegionOfficeOption } from "~~/shared/offices";

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

  describe("a post in a region's urząd", () => {
    const wejherowo: Link<NodeType> = {
      id: "teryt2215031",
      type: "region",
      name: "Gmina Wejherowo",
    };
    const powiat: Link<NodeType> = {
      id: "teryt2215",
      type: "region",
      name: "Powiat wejherowski",
    };
    const urzad: RegionOfficeOption = {
      teryt: "2215031",
      region: "Wejherowo",
      name: "Urząd Miejski w Wejherowie",
      regon: "000526251",
      nip: "5882155172",
      node: null,
      gmina: null,
      seatId: "teryt2215031",
    };
    /** Wejherowo's offices as its powiat lists them: the starostwo, then the
     * town's urząd - which has a region node to be seated in - and the
     * villages', which has none and is seated in the powiat. */
    const powiatOffices: RegionOfficeOption[] = [
      {
        teryt: "2215",
        region: "wejherowski",
        name: "Starostwo Powiatowe w Wejherowie",
        regon: "191686414",
        nip: "5881831062",
        node: null,
        gmina: null,
        seatId: "teryt2215",
      },
      { ...urzad, gmina: "Gmina miejska Wejherowo" },
      {
        teryt: "2215102",
        region: "Wejherowo",
        name: "Urząd Gminy Wejherowo",
        regon: "000545113",
        nip: "5881007736",
        node: null,
        gmina: "Gmina wiejska Wejherowo",
        seatId: "teryt2215",
      },
    ];

    /** The server, as far as this flow talks to it: the offices of the
     * region, a proposal for a new place, and relations. */
    function serve(node: { id: string; name: string } | null) {
      mockAuthRequest.mockImplementation(async (url: string) => {
        if (url === "/api/nodes/teryt2215031/offices") {
          return { offices: [{ ...urzad, node }] };
        }
        if (url === "/api/nodes/teryt2215/offices") {
          return { offices: powiatOffices };
        }
        if (url === "/api/revisions/create") {
          return { id: "rev-1", node_id: "urzad-new" };
        }
        return { id: "edge-new" };
      });
    }

    /** Every call after the offices were read, as url and body. */
    function writes() {
      return mockAuthRequest.mock.calls
        .filter(([url]) => !String(url).endsWith("/offices"))
        .map(([url, options]) => [url, options?.body]);
    }

    async function chooseOffice(
      wrapper: ReturnType<typeof mountDialog>,
      region: Link<NodeType> = wejherowo,
    ) {
      await pick(wrapper, region);
      (
        document.querySelector(
          '[data-testid="add-relation-verb-office"]',
        ) as HTMLElement
      ).click();
      await flushPromises();
      const role = document.querySelector(
        '[data-testid="add-relation-name"] input',
      ) as HTMLInputElement;
      role.value = "zastępca prezydenta";
      role.dispatchEvent(new Event("input"));
      await flushPromises();
    }

    function officeOption(regon: string): HTMLInputElement {
      const input = document.querySelector(
        `[data-testid="region-workplace-office-${regon}"] input`,
      ) as HTMLInputElement | null;
      if (!input) throw new Error(`no option for REGON ${regon}`);
      return input;
    }

    it("is offered beside the candidacy once a region is picked", async () => {
      serve(null);
      const wrapper = mountDialog();
      await pick(wrapper, wejherowo);

      expect(document.body.textContent).toContain("kandydował/a w");
      expect(document.body.textContent).toContain(
        "pracował/a w urzędzie lub jednostce podległej",
      );
    });

    it("is not offered by a section about something else", async () => {
      serve(null);
      const wrapper = mountDialog({ types: ["election"] });
      await pick(wrapper, wejherowo);

      expect(
        document.querySelector('[data-testid="add-relation-verb-office"]'),
      ).toBeNull();
    });

    it("files the post under the urząd the site already has", async () => {
      serve({ id: "urzad-1", name: "Urząd Miejski w Wejherowie" });
      const wrapper = mountDialog();
      await chooseOffice(wrapper);

      expect(document.body.textContent).toContain("już jest w bazie");
      await submit();

      expect(writes()).toEqual([
        [
          "/api/edges/create",
          expect.objectContaining({
            source: "node-1",
            target: "urzad-1",
            type: "employed",
            name: "zastępca prezydenta",
          }),
        ],
      ]);
    });

    it("proposes the urząd from the register, seated in the region", async () => {
      serve(null);
      const wrapper = mountDialog();
      await chooseOffice(wrapper);
      await submit();

      expect(writes()).toEqual([
        [
          "/api/revisions/create",
          {
            type: "place",
            name: "Urząd Miejski w Wejherowie",
            regonNumber: "000526251",
            nipNumber: "5882155172",
            isPublic: true,
          },
        ],
        [
          "/api/edges/create",
          { type: "seat", source: "teryt2215031", target: "urzad-new" },
        ],
        [
          "/api/edges/create",
          expect.objectContaining({
            source: "node-1",
            target: "urzad-new",
            type: "employed",
          }),
        ],
      ]);
      expect(wrapper.emitted("added")).toHaveLength(1);
    });

    it("does not propose the urząd twice when the post fails to save", async () => {
      serve(null);
      const wrapper = mountDialog();
      await chooseOffice(wrapper);
      const server = mockAuthRequest.getMockImplementation()!;
      mockAuthRequest.mockImplementation(async (url: string, options) => {
        if (url === "/api/edges/create" && options?.body?.type === "employed") {
          throw { data: { message: "Chwilowy błąd." } };
        }
        return server(url, options);
      });
      await submit();
      expect(document.body.textContent).toContain("Chwilowy błąd.");

      mockAuthRequest.mockImplementation(server);
      await submit();

      const proposals = writes().filter(
        ([url]) => url === "/api/revisions/create",
      );
      expect(proposals).toHaveLength(1);
      expect(wrapper.emitted("added")).toHaveLength(1);
    });

    it("says a gmina missing from the regions is reached through its powiat", async () => {
      serve(null);
      const wrapper = mountDialog();
      await chooseOffice(wrapper);

      expect(
        document.querySelector('[data-testid="region-workplace-powiat-hint"]')
          ?.textContent,
      ).toContain("Wybierz jej powiat");
    });

    it("lists a powiat's gminy by name after its starostwo, picking none", async () => {
      // Most gminy have no region node, so the powiat is the way to them -
      // and the starostwo is not where a wójt or a burmistrz works.
      serve(null);
      const wrapper = mountDialog();
      await chooseOffice(wrapper, powiat);

      const list = document.querySelector(
        '[data-testid="region-workplace-options"]',
      )!.textContent!;
      const order = [
        "Starostwo Powiatowe w Wejherowie",
        "Urzędy gmin w tym powiecie",
        "Gmina miejska Wejherowo",
        "Gmina wiejska Wejherowo",
      ].map((text) => list.indexOf(text));
      expect(order.every((at) => at >= 0)).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(
        powiatOffices.map((office) => officeOption(office.regon).checked),
      ).toEqual([false, false, false]);
      expect(submitButton().disabled).toBe(true);
      // The list already is what the hint would send them to.
      expect(
        document.querySelector('[data-testid="region-workplace-powiat-hint"]'),
      ).toBeNull();
    });

    it("seats a gmina's urząd picked from the powiat where the server says", async () => {
      serve(null);
      const wrapper = mountDialog();
      await chooseOffice(wrapper, powiat);
      officeOption("000526251").click();
      await flushPromises();
      await submit();

      expect(writes()).toEqual([
        [
          "/api/revisions/create",
          expect.objectContaining({
            name: "Urząd Miejski w Wejherowie",
            regonNumber: "000526251",
          }),
        ],
        // In the town's own region rather than in the powiat it was picked
        // from, since the site has one.
        [
          "/api/edges/create",
          { type: "seat", source: "teryt2215031", target: "urzad-new" },
        ],
        [
          "/api/edges/create",
          expect.objectContaining({
            source: "node-1",
            target: "urzad-new",
            type: "employed",
          }),
        ],
      ]);
    });
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
