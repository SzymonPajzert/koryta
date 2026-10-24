import { describe, it, expect, vi } from "vitest";
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import EmploymentHistory from "../../../app/components/card/EmploymentHistory.vue";
import PartyChip from "../../../app/components/PartyChip.vue";
import ChipPublicCompany from "../../../app/components/chip/PublicCompany.vue";
import ChipRelativeDuration from "../../../app/components/chip/RelativeDuration.vue";
import type { EdgeNode } from "../../../app/composables/edges";

const vuetify = createVuetify({ components, directives });

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
mockNuxtImport("navigateTo", () => navigateTo);

function edge(fields: Partial<EdgeNode>): EdgeNode {
  return {
    id: "e1",
    type: "employed",
    label: "Zarząd",
    source: "person",
    target: "place",
    richNode: { id: "place", type: "place", name: "PKP" },
    ...fields,
  } as EdgeNode;
}

async function render(edges: EdgeNode[]) {
  return await mountSuspended(EmploymentHistory, { props: { edges } });
}

describe("CardEmploymentHistory", () => {
  it("shows the period of a dated relation", async () => {
    const wrapper = await render([
      edge({ start_date: "2014-11-06", end_date: "2017-08-25" }),
    ]);
    expect(wrapper.text()).toContain("2014-11-06 - 2017-08-25");
    // Anchors the selector the undated case asserts the absence of.
    expect(
      wrapper.findComponent({ name: "ChipRelativeDuration" }).exists(),
    ).toBe(true);
  });

  it("marks a candidacy the person won", async () => {
    // `elected` is set on 2 of the 14,518 stored candidacies and nothing
    // rendered it, so no page could say anybody won anything.
    const wrapper = await render([
      edge({
        id: "won",
        type: "election",
        label: "kandydatura",
        elected: true,
      }),
    ]);
    expect(wrapper.find('[data-testid="edge-elected-won"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain("Wybrany");
  });

  it("says nothing about a candidacy that carries no win", async () => {
    // `false` is not "lost": `useEdgeEdit` writes it for every box a
    // contributor left unticked, and PKW published no result at all for
    // 68,728 of its 97,748 candidacy rows. Neither case may print a verdict
    // about a named person.
    for (const elected of [false, undefined]) {
      const wrapper = await render([
        edge({ id: "e1", type: "election", label: "kandydatura", elected }),
      ]);
      expect(wrapper.find('[data-testid="edge-elected-e1"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).not.toContain("Wybrany");
    }
  });

  it("drops the duration bar for a relation that carries no dates", async () => {
    // `connection` has no date fields in the schema, so every one of them would
    // otherwise draw a full-width bar over a span nobody recorded.
    const wrapper = await render([
      edge({ type: "connection", label: "kolega z zarządu" }),
    ]);
    expect(wrapper.text()).toContain("kolega z zarządu");
    expect(
      wrapper.findComponent({ name: "ChipRelativeDuration" }).exists(),
    ).toBe(false);
  });

  it("never renders undefined for an undated employment", async () => {
    const wrapper = await render([edge({ label: "zastępca prezesa" })]);
    expect(wrapper.text()).not.toContain("undefined");
  });

  it("offers no removal to a reader who is not an admin", async () => {
    // Removing takes effect at once rather than joining a review queue, so the
    // control has to be absent rather than merely refused by the server.
    const wrapper = await render([edge({})]);
    expect(wrapper.find('[data-testid="edge-remove-e1"]').exists()).toBe(false);
  });

  it("hands each row's publication state to the badge that draws it", async () => {
    // What decides whether the badge offers „Opublikuj" is the rule
    // /api/edges/publish enforces - neither end still a draft - and the row is
    // where both halves of it are known: the far end off `richNode`, the near
    // one off the page this list belongs to.
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [
          edge({
            visibility: false,
            richNode: {
              id: "place",
              type: "place",
              name: "PKP",
              visibility: true,
            },
          }),
        ],
        subjectPublished: true,
      },
    });

    const badge = wrapper.findComponent({ name: "ChipEdgeDraftStatus" });
    expect(badge.props()).toMatchObject({
      edgeId: "e1",
      published: false,
      publishable: true,
    });
  });

  it("does not offer publishing a relation whose far end is a draft", async () => {
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [
          edge({
            visibility: false,
            richNode: {
              id: "place",
              type: "place",
              name: "PKP",
              visibility: false,
            },
          }),
        ],
        subjectPublished: true,
      },
    });

    expect(
      wrapper.findComponent({ name: "ChipEdgeDraftStatus" }).props(),
    ).toMatchObject({ publishable: false });
  });

  it("hands the candidacies of one election in two places their clash", async () => {
    // Jacek Wojciech Kowalski's page, 2026-10-14: powiat gnieźnieński (3003)
    // and powiat kozienicki (1407) in 2002, and only gnieźnieński after.
    const run = (id: string, teryt: string, year: string) =>
      edge({
        id,
        type: "election",
        label: "kandydatura",
        source: "kowalski",
        target: `teryt${teryt}`,
        start_date: `${year}-01-01`,
        position: "Samorząd",
        richNode: { id: `teryt${teryt}`, type: "region", name: teryt },
      });
    const wrapper = await render([
      run("gniezno-2002", "3003", "2002"),
      run("kozienice-2002", "1407", "2002"),
      run("gniezno-2006", "3003", "2006"),
      edge({}),
    ]);

    const clashOf = (id: string) =>
      wrapper
        .findAllComponents({ name: "ChipPlaceClash" })
        .find((chip) => (chip.props("edge") as EdgeNode).id === id)
        ?.props("clash") as { year: string; rows: EdgeNode[] } | undefined;
    expect(clashOf("gniezno-2002")?.year).toBe("2002");
    expect(clashOf("kozienice-2002")?.rows.map((row) => row.id)).toEqual([
      "gniezno-2002",
      "kozienice-2002",
    ]);
    expect(clashOf("gniezno-2006")).toBeUndefined();
    expect(clashOf("e1")).toBeUndefined();
  });

  it("asks the page to remove the row an admin clicked", async () => {
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: { edges: [edge({})], canRemove: true },
    });

    await wrapper.get('[data-testid="edge-remove-e1"]').trigger("click");

    // The edge itself, not its id: the dialog names the relation being removed
    // and needs the far end and the dates to do it.
    expect(wrapper.emitted("remove")?.[0]?.[0]).toMatchObject({ id: "e1" });
  });
});

/** Whose organ names the seat. Both directions of the same rename, because
 * the card is drawn on a person's page and on an institution's and reads the
 * institution off a different end of the row in each. */
describe("EmploymentHistory sectors", () => {
  it("names the sector of an employer and links to the rest of it", async () => {
    const wrapper = await render([
      edge({
        richNode: {
          id: "place",
          type: "place",
          name: "PKP Intercity",
          categories: ["koleje"],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      }),
    ]);

    expect(wrapper.text()).toContain("Koleje");
    const chip = wrapper
      .findAllComponents({ name: "VChip" })
      .find((c) => c.text() === "Koleje")!;
    // Not a link of its own: the row already is one, to the employer, and a
    // link inside a link is what the browser's parser takes apart.
    expect(chip.element.tagName).not.toBe("A");
    navigateTo.mockClear();
    await chip.trigger("click");
    expect(navigateTo).toHaveBeenCalledWith(
      "/eksploruj/tabela?category=koleje",
    );
  });

  it("says nothing for an employer filed under no sector", async () => {
    const wrapper = await render([edge({})]);

    expect(
      wrapper.findComponent({ name: "ChipCompanyCategories" }).text(),
    ).toBe("");
  });

  it("says nothing for a row whose other end is not a company", async () => {
    // A candidacy points at a region, and `categories` there would be whatever
    // the region document happens to carry.
    const wrapper = await render([
      edge({
        type: "election",
        richNode: {
          id: "teryt1261",
          type: "region",
          name: "Kraków",
          categories: ["koleje"],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      }),
    ]);

    expect(wrapper.text()).not.toContain("Koleje");
  });
});

describe("EmploymentHistory supervisory seats", () => {
  /** A row as an institution's page draws it: the far end is the person. */
  function seat(fields: Partial<EdgeNode> = {}): EdgeNode {
    return edge({
      label: "Rada Nadzorcza",
      richNode: { id: "p1", type: "person", name: "Jan Kowalski" },
      ...fields,
    } as Partial<EdgeNode>);
  }

  it("names the hospital's own organ on the hospital's page", async () => {
    // The stored edge says "Rada Nadzorcza" - rejestr.io reports every
    // supervisory seat under that one label - and an SPZOZ has no such board.
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [seat()],
        company: { supervisoryBody: "rada-spoleczna" } as never,
      },
    });

    expect(wrapper.text()).toContain("Rada Społeczna");
    expect(wrapper.text()).not.toContain("Rada Nadzorcza");
  });

  it("still reads the organ off the row on a person's page", async () => {
    // No `company` prop here: the person's page has a different institution on
    // every row, and each row carries its own.
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [
          seat({
            richNode: {
              id: "h1",
              type: "place",
              name: "Szpital",
              supervisoryBody: "rada-spoleczna",
            },
          } as Partial<EdgeNode>),
        ],
      },
    });

    expect(wrapper.text()).toContain("Rada Społeczna");
  });

  it("leaves a spółka's board alone", async () => {
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: { edges: [seat()], company: {} as never },
    });

    expect(wrapper.text()).toContain("Rada Nadzorcza");
  });
});

/** The one-line hint that ties a row to the "Zmiany na stanowisku" section
 * below it: who sat in this seat before. */
describe("EmploymentHistory predecessors", () => {
  const predecessor = {
    edgeId: "e-hubert",
    personId: "hubert",
    personName: "Hubert Grzegorczyk",
    parties: ["PiS"],
    start: "2021-03-01",
    end: "2024-05-16",
    published: true,
    gapDays: 0,
  };

  it("names who held the seat before, with the party and the gap", async () => {
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [edge({ start_date: "2024-05-16" })],
        predecessors: { e1: predecessor },
      },
    });

    const hint = wrapper.get('[data-testid="edge-predecessor-e1"]');
    expect(hint.text()).toContain("Wcześniej:");
    expect(hint.text()).toContain("Hubert Grzegorczyk");
    expect(hint.text()).toContain("PiS");
    // `gapLabel` from shared/succession.ts, so this row and the section below
    // it cannot describe one handover two ways.
    expect(hint.text()).toContain("tego samego dnia");
  });

  it("does not put a link inside the row's own link", async () => {
    // The row is an anchor to the other end of the relation. An anchor inside
    // an anchor is invalid, and the parser recovers from it by closing the
    // outer one and reopening it around every following fragment - which broke
    // one row into three separate boxes on the person page.
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [edge({ start_date: "2024-05-16" })],
        predecessors: { e1: predecessor },
      },
    });

    expect(
      wrapper.get('[data-testid="edge-predecessor-e1"]').findAll("a"),
    ).toHaveLength(0);
  });

  it("leaves a row nobody was matched to alone", async () => {
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [edge({ id: "e2" })],
        predecessors: { e1: predecessor },
      },
    });

    expect(wrapper.find('[data-testid="edge-predecessor-e2"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain("Wcześniej");
  });

  it("says nothing on a card that was handed no successions at all", async () => {
    const wrapper = await render([edge({})]);

    expect(wrapper.find('[data-testid="edge-predecessor-e1"]').exists()).toBe(
      false,
    );
  });
});

/** The shape `useEdges` hands the card, narrowed to what this card reads. */
function candidacy(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    type: "election",
    label: "Kandydował/a w",
    source: "person1",
    target: "teryt1261",
    start_date: "2024-01-01",
    richNode: { id: "teryt1261", type: "region", name: "Kraków" },
    ...overrides,
  };
}

function mountHistory(edges: unknown[]) {
  return mount(EmploymentHistory, {
    global: {
      plugins: [vuetify],
      components: { PartyChip, ChipPublicCompany, ChipRelativeDuration },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    props: { edges: edges as any },
  });
}

describe("EmploymentHistory", () => {
  it("names the party and the committee of a candidacy", () => {
    const wrapper = mountHistory([
      candidacy({
        party: "PiS",
        committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
      }),
    ]);

    expect(wrapper.text()).toContain("Kraków");
    expect(wrapper.text()).toContain("PiS");
    expect(wrapper.text()).toContain("Komitet Wyborczy Prawo i Sprawiedliwość");
  });

  it("names a local committee that maps onto no party", () => {
    const wrapper = mountHistory([
      candidacy({ committee: "Komitet Wyborczy Wyborców Wspólny Kalisz" }),
    ]);

    expect(wrapper.text()).toContain(
      "Komitet Wyborczy Wyborców Wspólny Kalisz",
    );
    expect(wrapper.findComponent(PartyChip).exists()).toBe(false);
  });

  it("does not repeat a committee that is spelled like its party", () => {
    const wrapper = mountHistory([
      candidacy({ party: "PSL", committee: "psl" }),
    ]);

    expect(wrapper.findComponent(PartyChip).exists()).toBe(true);
    expect(wrapper.text()).not.toContain("psl");
  });

  it("leaves a candidacy with neither field as it was", () => {
    const wrapper = mountHistory([candidacy()]);

    expect(wrapper.text()).toContain("Kandydował/a w");
    expect(wrapper.findComponent(PartyChip).exists()).toBe(false);
  });

  it("names the office a candidacy was for", () => {
    // The report: a 2023 row read „kandydatura", the region and the committee,
    // and nothing on it said that the run was for the Senate.
    const wrapper = mountHistory([
      candidacy({ label: "kandydatura", position: "Senat" }),
    ]);

    expect(wrapper.find('[data-testid="edge-office-e1"]').text()).toBe("Senat");
  });

  it("names no office on a relation that is not a candidacy", () => {
    const wrapper = mountHistory([
      candidacy({ type: "employed", label: "Prezes", position: "Senat" }),
    ]);

    expect(wrapper.find('[data-testid="edge-office-e1"]').exists()).toBe(false);
  });

  it("shows no party chip for an employment that carries one", () => {
    const wrapper = mountHistory([
      candidacy({ type: "employed", label: "Prezes", party: "PiS" }),
    ]);

    expect(wrapper.findComponent(PartyChip).exists()).toBe(false);
  });
});

/** A relation whose far end is another human being, as `useEdges` hands it over.
 * The only kind of row on a person's page that names one. */
function acquaintance(person: Record<string, unknown> = {}) {
  return {
    id: "e2",
    type: "connection",
    label: "Powiązanie z",
    source: "person1",
    target: "person2",
    richNode: { id: "person2", type: "person", name: "Anna Nowak", ...person },
  };
}

describe("EmploymentHistory connections", () => {
  it("names the party of the person a relation leads to", () => {
    const wrapper = mountHistory([acquaintance({ parties: ["PiS"] })]);

    expect(wrapper.text()).toContain("Anna Nowak");
    expect(wrapper.findComponent(PartyChip).props("party")).toBe("PiS");
  });

  it("names every party of somebody who has changed one", () => {
    const wrapper = mountHistory([
      acquaintance({ parties: ["SLD", "Nowa Lewica"] }),
    ]);

    expect(
      wrapper.findAllComponents(PartyChip).map((chip) => chip.props("party")),
    ).toEqual(["SLD", "Nowa Lewica"]);
  });

  it("reads a `parties` that was stored as a numbered-key object", () => {
    // What `sanitizeFirestoreData` wrote until 2026-07-28, and still the shape
    // of any nested array - see `asArray`.
    const wrapper = mountHistory([acquaintance({ parties: { 0: "PO" } })]);

    expect(wrapper.findComponent(PartyChip).props("party")).toBe("PO");
  });

  it("says nothing about a person with no party", () => {
    const wrapper = mountHistory([acquaintance()]);

    expect(wrapper.text()).toContain("Powiązanie z");
    expect(wrapper.findComponent(PartyChip).exists()).toBe(false);
  });

  it("leaves a relation to a company alone", () => {
    // `parties` cannot be on a company, but the guard is on the node type
    // rather than on the field, so a stray one must not paint a chip.
    const wrapper = mountHistory([
      { ...acquaintance(), richNode: { id: "p", type: "place", name: "PKP" } },
    ]);

    expect(wrapper.findComponent(PartyChip).exists()).toBe(false);
  });

  it("chips the people on a company's own list too", () => {
    // There every row is a person - the board - and "Obecny skład" directly
    // above this card already names the party of each of them.
    const wrapper = mount(EmploymentHistory, {
      global: {
        plugins: [vuetify],
        components: { PartyChip, ChipPublicCompany, ChipRelativeDuration },
      },
      props: {
        edges: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { ...acquaintance({ parties: ["PiS"] }), type: "employed" } as any,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        company: { id: "pkp", type: "place", name: "PKP" } as any,
      },
    });

    expect(wrapper.findComponent(PartyChip).props("party")).toBe("PiS");
  });
});

/** The per-row citation button: how many articles a claim rests on, and the way
 * into changing that. */
describe("EmploymentHistory sources", () => {
  function sourcesButton(wrapper: ReturnType<typeof mountHistory>) {
    return wrapper.find('[data-testid="edge-sources-open-e1"]');
  }

  // The buttons are `CardHistoryRowActions` now, which the card imports
  // itself: under a plain mount an auto-imported component renders as
  // nothing, and every case here would have passed over an empty row.
  it("counts the articles a relation is cited to", () => {
    const wrapper = mountHistory([
      candidacy({ references: ["a1", "a2"], label: "Prezes" }),
    ]);

    expect(sourcesButton(wrapper).exists()).toBe(true);
    expect(sourcesButton(wrapper).text()).toBe("2");
    expect(sourcesButton(wrapper).attributes("title")).toBe(
      "Pokaż źródła powiązania",
    );
  });

  it("offers an editor a way in on a relation with no source at all", () => {
    const wrapper = mount(EmploymentHistory, {
      global: {
        plugins: [vuetify],
        components: { PartyChip, ChipPublicCompany, ChipRelativeDuration },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props: { edges: [candidacy()] as any, canCite: true },
    });

    expect(sourcesButton(wrapper).exists()).toBe(true);
    expect(sourcesButton(wrapper).text()).toBe("");
    expect(sourcesButton(wrapper).attributes("title")).toBe(
      "Dodaj źródło powiązania",
    );
  });

  it("says nothing to a reader who cannot cite anything", () => {
    // Every candidacy comes from the register with no `references`, so an
    // anonymous reader would otherwise get a row of dead buttons down the page.
    const wrapper = mountHistory([candidacy()]);

    // The row itself is drawn, so the button's absence is the card's answer
    // and not an empty mount.
    expect(wrapper.find(".history-row").text()).toContain("Kraków");
    expect(sourcesButton(wrapper).exists()).toBe(false);
  });

  it("asks for the sources rather than following the row's link", async () => {
    const wrapper = mountHistory([candidacy({ references: ["a1"] })]);

    expect(sourcesButton(wrapper).exists()).toBe(true);
    await sourcesButton(wrapper).trigger("click");

    expect(wrapper.emitted("sources")?.[0]?.[0]).toMatchObject({ id: "e1" });
  });
  // The heading used to open unconditionally, so a page whose only relations
  // were de-duplicated away drew the heading over nothing.
  it("renders nothing at all when there is no relation and no way to add one", async () => {
    const wrapper = await render([]);
    expect(wrapper.text()).not.toContain("Historia powiązań");
    expect(wrapper.find('[data-testid="relations-history"]').exists()).toBe(
      false,
    );
  });

  it("keeps the empty heading for an editor, because Dodaj lives in it", async () => {
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: { edges: [], canAdd: true },
    });
    expect(wrapper.text()).toContain("Historia powiązań");
    expect(
      wrapper.find('[data-testid="add-relation-employment"]').exists(),
    ).toBe(true);
  });
});

/** The report on PZO Gliwice's page: one prokurent listed as „Prokurent" and
 * again without a role, for one appointment stored twice. The row with no role
 * reads „Zatrudniony/a w", the edge type's phrase, which `useEdges` puts in
 * `label` when the edge has no `name`. See shared/rolelessSpells.ts. */
describe("EmploymentHistory role-less copies", () => {
  function janina(fields: Partial<EdgeNode>): EdgeNode {
    return edge({
      source: "janina",
      target: "pzo",
      label: "Zatrudniony/a w",
      richNode: { id: "janina", type: "person", name: "Janina Podwójna" },
      ...fields,
    } as Partial<EdgeNode>);
  }

  const prokura = janina({
    id: "prokurent",
    name: "Prokurent",
    label: "Prokurent",
    start_date: "2026-07-14",
  });

  it("lists a prokura once, not again without its role", async () => {
    const wrapper = await render([
      janina({ id: "bez-funkcji", start_date: "2026-07-14" }),
      prokura,
    ]);

    expect(wrapper.findAll(".history-row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Prokurent");
    expect(wrapper.text()).not.toContain("Zatrudniony/a w");
  });

  it("keeps a role-less stint from years before the prokura", async () => {
    const wrapper = await render([
      janina({
        id: "wczesniej",
        start_date: "2012-03-01",
        end_date: "2015-06-30",
      }),
      prokura,
    ]);

    expect(wrapper.findAll(".history-row")).toHaveLength(2);
    expect(wrapper.text()).toContain("Zatrudniony/a w");
  });
});

describe("EmploymentHistory links to drafts", () => {
  /** Where each row leads, by edge id: the `to` its list item was given. */
  const links = async (unlinkDrafts: boolean) => {
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        unlinkDrafts,
        edges: [
          edge({
            id: "live",
            richNode: {
              id: "pkp",
              type: "place",
              name: "PKP",
              visibility: true,
            },
          } as Partial<EdgeNode>),
          edge({
            id: "draft",
            richNode: {
              id: "spolka",
              type: "place",
              name: "Spółka w Przygotowaniu",
              visibility: false,
            },
          } as Partial<EdgeNode>),
        ],
      },
    });
    return wrapper
      .findAllComponents({ name: "VListItem" })
      .filter((item) => item.classes().includes("history-row"))
      .map((item) => item.props("to"));
  };

  it("links every row by default, drafts included", async () => {
    // A signed in reader opens a draft company like any page.
    const to = await links(false);
    expect(to).toHaveLength(2);
    expect(to.every((link) => typeof link === "string" && !!link)).toBe(true);
  });

  it("draws a row whose far end is a draft without a link when asked", async () => {
    // The teaser of an unpublished person: following the link would only be a
    // second wall for a logged out reader.
    const to = await links(true);
    expect(to.filter((link) => !link)).toHaveLength(1);
    expect(to.filter((link) => typeof link === "string")).toHaveLength(1);
  });
});

/** A row as a person's page holds it: an employment at a company, dated as
 * given. */
function post(id: string, start?: string, end?: string, fields = {}) {
  return edge({
    id,
    label: "Członek Zarządu",
    start_date: start,
    end_date: end,
    richNode: { id: `c-${id}`, type: "place", name: `Spółka ${id}` },
    ...fields,
  } as Partial<EdgeNode>);
}

/** A row as a company's page holds it: the far end is the person. */
function holder(id: string, start?: string, end?: string) {
  return edge({
    id,
    source: `p-${id}`,
    target: "pkp",
    start_date: start,
    end_date: end,
    richNode: { id: `p-${id}`, type: "person", name: `Osoba ${id}` },
  } as Partial<EdgeNode>);
}

/** The groups a ledger drew, by key, in order. */
const groupKeys = (wrapper: {
  findAll: (s: string) => { attributes(a: string): string | undefined }[];
}) =>
  wrapper
    .findAll("[data-testid^='history-box-']")
    .map((box) => box.attributes("data-testid")?.replace("history-box-", ""));

/** A person's page and a company's read the list as a ledger: groups, the
 * period in a column of its own in one date format, and what ended a step
 * quieter. Every other host - the drawer, /eksploruj/nowe, the queues - keeps
 * the one list. */
describe("EmploymentHistory as a ledger", () => {
  const ledger = (edges: EdgeNode[], props: Record<string, unknown> = {}) =>
    mountSuspended(EmploymentHistory, {
      props: { edges, ledger: true, ...props },
    });

  it("files a person's rows under the people, then what is held, what ended and what has no dates", async () => {
    const wrapper = await ledger([
      post("ended", "2023-05-15", "2024-12-04"),
      post("undated"),
      post("current", "2026-08-19"),
      acquaintance() as unknown as EdgeNode,
    ]);

    // The people first: „they are in a sense current as well and the crux of
    // the whole website” (Szymon, 2026-10-16).
    expect(groupKeys(wrapper)).toEqual([
      "people",
      "current",
      "ended",
      "undated",
    ]);
    const heads = wrapper.findAll("h3.k-group-head");
    expect(heads.map((head) => head.text().replace(/\s+/g, " "))).toEqual([
      "Osoby 1",
      "Obecnie 1",
      "Zakończone 1",
      "Bez dat 1",
    ]);
    expect(wrapper.get("[data-testid='history-box-people']").text()).toContain(
      "Anna Nowak",
    );
    expect(wrapper.get("[data-testid='history-box-undated']").text()).toContain(
      "Spółka undated",
    );
  });

  it("heads no group when there is only one", async () => {
    // „Zakończone 1” over the teaser's one post read as the count of
    // everything the person ever held.
    const wrapper = await ledger([
      post("a", "2010-01-01", "2012-01-01"),
      post("b", "2013-01-01", "2015-01-01"),
    ]);

    expect(groupKeys(wrapper)).toEqual(["ended"]);
    expect(wrapper.find("h3").exists()).toBe(false);
  });

  it("files a company's people by their period, with no group of people", async () => {
    const wrapper = await ledger(
      [
        holder("held", "2026-08-19"),
        holder("left", "2016-02-16", "2024-04-12"),
        holder("undated"),
      ],
      { peopleByPeriod: true, company: { id: "pkp" } },
    );

    expect(groupKeys(wrapper)).toEqual(["current", "ended", "undated"]);
    expect(wrapper.text()).not.toContain("Osoby");
  });

  it("prints a post held today from its first day, and an ended one with both", async () => {
    const wrapper = await ledger([
      post("current", "2026-08-19"),
      post("ended", "2023-05-15", "2024-12-04"),
    ]);

    const current = wrapper.get("[data-testid='edge-period-current']");
    expect(current.get(".history-period__full").text()).toBe("od 19.08.2026");
    expect(current.classes()).toContain("history-period--current");
    // Never „- obecnie”: „od” already says the post is held.
    expect(current.text()).not.toContain("obecnie");

    const ended = wrapper.get("[data-testid='edge-period-ended']");
    expect(ended.get(".history-period__full").text()).toBe(
      "15.05.2023 - 04.12.2024",
    );
    // The phone's form of an ended post: its years, unspaced.
    expect(ended.get(".history-period__years").text()).toBe("2023-2024");
    expect(ended.classes()).not.toContain("history-period--current");
  });

  it("keeps a term whose end is still ahead among what is held", async () => {
    const wrapper = await ledger([
      post("term", "2023-01-01", "2099-06-30"),
      post("ended", "2010-01-01", "2012-01-01"),
    ]);

    expect(
      wrapper
        .find(
          "[data-testid='history-box-current'] [data-testid='edge-period-term']",
        )
        .exists(),
    ).toBe(true);
    expect(
      wrapper
        .get("[data-testid='edge-period-term'] .history-period__full")
        .text(),
    ).toBe("01.01.2023 - 30.06.2099");
  });

  it("sets what ended a step quieter than what is held", async () => {
    const wrapper = await ledger([
      post("current", "2026-08-19"),
      post("ended", "2023-05-15", "2024-12-04"),
    ]);

    const rows = wrapper.findAll(".history-row");
    expect(
      rows.every((row) => row.classes().includes("history-row--ledger")),
    ).toBe(true);
    expect(
      wrapper.get("[data-testid='history-box-ended'] .history-row").classes(),
    ).toContain("history-row--ended");
    expect(
      wrapper.get("[data-testid='history-box-current'] .history-row").classes(),
    ).not.toContain("history-row--ended");
  });

  it("prints a candidacy's year alone, the part of its date that is true", async () => {
    // The server substitutes one election day per year whatever the office,
    // so a 2010 council candidacy would read 20.06.2010 - the presidential
    // vote.
    const wrapper = await ledger([
      edge({
        id: "run",
        type: "election",
        label: "kandydatura",
        start_date: "2010-06-20",
        end_date: "2010-06-20",
        committee: "KWW Wspólny Kalisz",
        richNode: { id: "teryt3061", type: "region", name: "Kalisz" },
      }),
    ]);

    expect(
      wrapper
        .get("[data-testid='edge-period-run'] .history-period__full")
        .text(),
    ).toBe("2010");
    // Last on its role line, where its long name wraps rather than pushing
    // the draft's „Opublikuj” down.
    expect(wrapper.get(".history-meta__committee").text()).toBe(
      "KWW Wspólny Kalisz",
    );
  });

  it("draws the bar bare beside its own column of dates", async () => {
    const wrapper = await ledger([post("ended", "2023-05-15", "2024-12-04")]);

    const bar = wrapper.findComponent(ChipRelativeDuration);
    expect(bar.props("bare")).toBe(true);
    // The dates are the ledger's column, not the bar's caption under it.
    expect(bar.text()).toBe("");
  });

  it("draws no period for a relation with no dates", async () => {
    const wrapper = await ledger([post("undated")]);

    expect(wrapper.find("[data-testid='edge-period-undated']").exists()).toBe(
      false,
    );
    expect(wrapper.findComponent(ChipRelativeDuration).exists()).toBe(false);
  });

  it("says whose a company is only where it is the exception, on a person's ledger", async () => {
    // Nearly every row there is a public company, which is what the page is
    // about, and fifteen identical sage chips said nothing per row.
    const company = (id: string, fields: Record<string, unknown>) =>
      post(id, "2020-01-01", "2021-01-01", {
        richNode: { id, type: "place", name: id, ...fields },
      });

    const onLedger = await ledger([
      company("publiczna", { isPublic: true }),
      company("prywatna", { isPublic: false, isPublicSource: "manual" }),
    ]);
    expect(onLedger.text()).not.toContain("Instytucja publiczna");
    expect(onLedger.text()).toContain("Podmiot prywatny");

    const elsewhere = await render([company("publiczna", { isPublic: true })]);
    expect(elsewhere.text()).toContain("Instytucja publiczna");
  });

  it("offers the row's buttons on a ledger row as on any other", async () => {
    const wrapper = await ledger(
      [post("e1", "2023-05-15", "2024-12-04", { references: ["a1"] })],
      { canCite: true, canCorrect: true, canRemove: true },
    );

    for (const testid of [
      "edge-sources-open-e1",
      "edge-edit-e1",
      "edge-remove-e1",
    ]) {
      expect(wrapper.find(`[data-testid='${testid}']`).exists()).toBe(true);
    }
    await wrapper.get("[data-testid='edge-edit-e1']").trigger("click");
    expect(wrapper.emitted("edit")?.[0]?.[0]).toMatchObject({ id: "e1" });
  });

  // A reader who cannot cite sees the sources button on the cited rows only,
  // and a dated row without one had its dates 58px to the right of its
  // neighbours'.
  it("keeps the sources button's room on an uncited row beside a cited one", async () => {
    const wrapper = await ledger([
      post("cited", "2023-05-15", "2024-12-04", { references: ["a1"] }),
      post("uncited", "2016-01-01", "2019-03-31"),
    ]);

    const rowOf = (id: string) =>
      wrapper
        .findAll(".history-row")
        .find((row) => row.find(`[data-testid='edge-period-${id}']`).exists())!;
    expect(
      rowOf("cited").find("[data-testid='edge-sources-open-cited']").exists(),
    ).toBe(true);
    expect(rowOf("uncited").find(".row-actions__gap").exists()).toBe(true);
    // Both rows take the buttons' column, so their dates stand in one line.
    for (const id of ["cited", "uncited"]) {
      expect(rowOf(id).get(".history-cell").classes()).toEqual(
        expect.arrayContaining(["history-cell--dated", "history-cell--acts"]),
      );
    }
  });

  it("holds no room where nothing on the list is cited, or the reader may cite", async () => {
    const bare = await ledger([
      post("a", "2023-05-15", "2024-12-04"),
      post("b", "2016-01-01", "2019-03-31"),
    ]);
    expect(bare.find(".row-actions__gap").exists()).toBe(false);
    expect(bare.find(".history-cell--acts").exists()).toBe(false);

    // Signed in, every row has the button itself.
    const editor = await ledger(
      [
        post("a", "2023-05-15", "2024-12-04", { references: ["a1"] }),
        post("b", "2016-01-01", "2019-03-31"),
      ],
      { canCite: true },
    );
    expect(editor.find(".row-actions__gap").exists()).toBe(false);
    expect(editor.find("[data-testid='edge-sources-open-b']").exists()).toBe(
      true,
    );
  });

  it("leaves every other host's list as it was", async () => {
    // The drawer, /eksploruj/nowe and the queues pass no `ledger`.
    const wrapper = await render([
      post("current", "2026-08-19"),
      post("ended", "2014-11-06", "2017-08-25"),
    ]);

    expect(groupKeys(wrapper)).toEqual(["all"]);
    expect(wrapper.find("h3").exists()).toBe(false);
    expect(wrapper.find("[data-testid^='edge-period-']").exists()).toBe(false);
    expect(wrapper.find(".history-row--ledger").exists()).toBe(false);
    // The bar with its own caption, and the phone's period line.
    const bars = wrapper.findAllComponents(ChipRelativeDuration);
    expect(bars.every((bar) => !bar.props("bare"))).toBe(true);
    expect(wrapper.text()).toContain("2014-11-06 - 2017-08-25");
    expect(wrapper.text()).toContain("2026-08-19 - obecnie");
  });
});

/** „12 osób · wpisy od 2001” beside the head of a company's history. */
describe("EmploymentHistory caption", () => {
  it("counts the people a company's history holds and how far back it goes", async () => {
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [
          holder("a", "2016-02-16", "2024-04-12"),
          holder("b", "2001-05-01", "2006-01-01"),
        ],
        company: { id: "pkp", type: "place", name: "PKP" },
      },
    });

    expect(wrapper.get("[data-testid='history-caption']").text()).toBe(
      "2 osoby · wpisy od 2001",
    );
  });

  it("counts the whole history while it lists less of it", async () => {
    // The posts „Obecny skład” draws as cards are left out of the rows
    // (Szymon, 2026-10-23), and the caption still counts them.
    const board = holder("board", "1998-03-01");
    const left = holder("left", "2016-02-16", "2024-04-12");
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [left],
        captionEdges: [board, left],
        company: { id: "pkp", type: "place", name: "PKP" },
      },
    });

    expect(wrapper.findAll(".history-row")).toHaveLength(1);
    expect(wrapper.get("[data-testid='history-caption']").text()).toBe(
      "2 osoby · wpisy od 1998",
    );
  });

  it("has no caption on a person's page", async () => {
    const wrapper = await render([post("a", "2016-02-16", "2024-04-12")]);

    expect(wrapper.find("[data-testid='history-caption']").exists()).toBe(
      false,
    );
  });
});
