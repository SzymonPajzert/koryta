import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ChainColumns from "../../../app/components/succession/ChainColumns.vue";
import type {
  ChainCandidateView,
  ChainNode,
} from "../../../app/composables/successionChain";
import type {
  SuccessionCandidate,
  SuccessionChainPost,
  SuccessionChainStep,
  SuccessionVia,
} from "../../../server/api/edges/succession-chain.get";

/* Prop-driven, with no endpoint and no composable anywhere in the file. The
 * layouts hold no state - that is the whole reason there are two of them and
 * one composable - so everything worth asserting here is a function of the
 * `nodes` array, and building it by hand is what lets a case like „six
 * candidates, all on the same day, two of them at a second company” exist at
 * all: it is Ryszard Grobelny's real Związek Miast Polskich board, which no
 * seed fixture in this repo contains.
 *
 * The fixtures and every assertion below are deliberately duplicated in the
 * other layout's file. They are the contract between the two: the page swaps
 * one component for the other with no other change, so a reader who switches
 * must see the same people, the same caveat and the same buttons. Two files
 * that assert the same things in the same words are how that stays true - a
 * shared helper would let one of them quietly stop being run.
 */

const ZMP = {
  companyId: "zmp",
  companyName: "Związek Miast Polskich",
  role: "Zarząd",
};

const MTP = {
  companyId: "mtp",
  companyName: "Międzynarodowe Targi Poznańskie",
  role: "Rada Nadzorcza",
};

function via(
  company: { companyId: string; companyName: string; role: string },
  extra: Partial<SuccessionVia> = {},
): SuccessionVia {
  return {
    ...company,
    focusEdgeId: "eFocusZmp",
    focusStart: "2003-06-04",
    focusEnd: "2015-06-01",
    edgeId: "eVia",
    start: "2001-12-06",
    end: "2003-06-04",
    gapDays: 0,
    batchSize: 1,
    ...extra,
  };
}

/** An id with no hyphen in it, the way every node id in this register has to
 * be: `parseEntityUrlSlug` takes the id to be the last dash segment of a slug,
 * so `p-jan-1` would parse as `1`. Nothing here is routed, but a fixture that
 * breaks the rule is a fixture somebody copies into one that is. */
function idOf(name: string): string {
  return `p${name.replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g, "")}`;
}

function candidate(
  name: string,
  extra: Partial<SuccessionCandidate> = {},
): SuccessionCandidate {
  return {
    personId: idOf(name),
    personName: name,
    parties: [],
    published: true,
    via: [via(ZMP)],
    closestGapDays: 0,
    ...extra,
  };
}

function view(
  person: SuccessionCandidate,
  extra: Partial<ChainCandidateView> = {},
): ChainCandidateView {
  return { candidate: person, expandedKey: null, expandable: true, ...extra };
}

function post(extra: Partial<SuccessionChainPost> = {}): SuccessionChainPost {
  return {
    companyId: "zmp",
    companyName: "Związek Miast Polskich",
    role: "Zarząd",
    edgeId: "eFocusZmp",
    start: "2003-06-04",
    end: "2015-06-01",
    predecessorCount: 6,
    successorCount: 4,
    ...extra,
  };
}

function step(extra: Partial<SuccessionChainStep> = {}): SuccessionChainStep {
  return {
    personId: "pRyszardGrobelny",
    personName: "Ryszard Grobelny",
    parties: [],
    published: true,
    posts: [],
    predecessors: [],
    successors: [],
    hidden: 0,
    ...extra,
  };
}

function node(extra: Partial<ChainNode> = {}): ChainNode {
  const built: ChainNode = {
    key: "root",
    personId: "pRyszardGrobelny",
    personName: "Ryszard Grobelny",
    parentKey: null,
    direction: null,
    depth: 0,
    status: "ready",
    step: step(),
    predecessors: [],
    successors: [],
    ...extra,
  };
  return built;
}

/** Ryszard Grobelny's real Związek Miast Polskich board: six people whose
 * terms all ended on 2003-06-04, the day his began, so the register says the
 * seat changed hands six ways at once and not who followed whom. Two of them
 * carry a second candidacy at Międzynarodowe Targi Poznańskie, because the
 * endpoint merges a person into one card however many seats they stand next to
 * this person in - the two names a reader comes to this page for are at two
 * different companies. */
const ZMP_BOARD = [
  "Andrzej Zabiegliński",
  "Jerzy Barzowski",
  "Jerzy Jedliński",
  "Piotr Czesław Uszok",
  "Tadeusz Rozpara",
  "Wojciech Szczęsny Kaczmarek",
];

function zmpPredecessors(): ChainCandidateView[] {
  return ZMP_BOARD.map((name, index) =>
    view(
      candidate(name, {
        via:
          index < 2
            ? [
                via(ZMP, { batchSize: 6, edgeId: `eZmp${index}` }),
                via(MTP, {
                  batchSize: 1,
                  edgeId: `eMtp${index}`,
                  focusEdgeId: "eFocusMtp",
                  focusStart: "2004-04-13",
                  focusEnd: "2016-08-16",
                  gapDays: 23,
                  start: "2016-09-08",
                  end: null,
                }),
              ]
            : [via(ZMP, { batchSize: 6, edgeId: `eZmp${index}` })],
      }),
    ),
  );
}

/** The focus person with that board on their left, which is the fixture most
 * of these tests start from. */
function grobelny(extra: Partial<ChainNode> = {}): ChainNode[] {
  const predecessors = zmpPredecessors();
  return [
    node({
      predecessors,
      step: step({
        predecessors: predecessors.map((entry) => entry.candidate),
        posts: [post()],
      }),
      ...extra,
    }),
  ];
}

/** A branch three hops long, plus a second one hanging off the focus person.
 *
 * Nothing in the seed database reaches this shape - the seeded Rada Nadzorcza
 * is two out and two in on one day and the seeded Zarząd is Edward → Franciszek,
 * so expanding twice there walks back into the same people. It is exactly the
 * case both layouts have to get right, though: a chain is only worth a page of
 * its own past the first hop.
 */
function deep(): ChainNode[] {
  const rozpara = idOf("Tadeusz Rozpara");
  const barzowski = idOf("Jerzy Barzowski");
  const jedlinski = idOf("Jerzy Jedliński");
  const pluta = idOf("Marcin Pluta");

  return [
    node({
      predecessors: [
        view(candidate("Tadeusz Rozpara"), {
          expandedKey: `root>p:${rozpara}`,
        }),
      ],
      successors: [
        view(candidate("Marcin Pluta"), { expandedKey: `root>s:${pluta}` }),
      ],
      step: step({ posts: [post()] }),
    }),
    node({
      key: `root>p:${rozpara}`,
      personId: rozpara,
      personName: "Tadeusz Rozpara",
      parentKey: "root",
      direction: "predecessor",
      depth: 1,
      step: step({ personName: "Tadeusz Rozpara" }),
      predecessors: [
        view(candidate("Jerzy Barzowski"), {
          expandedKey: `root>p:${rozpara}>p:${barzowski}`,
        }),
      ],
    }),
    node({
      key: `root>p:${rozpara}>p:${barzowski}`,
      personId: barzowski,
      personName: "Jerzy Barzowski",
      parentKey: `root>p:${rozpara}`,
      direction: "predecessor",
      depth: 2,
      step: step({ personName: "Jerzy Barzowski" }),
      predecessors: [
        view(candidate("Jerzy Jedliński"), {
          expandedKey: `root>p:${rozpara}>p:${barzowski}>p:${jedlinski}`,
        }),
      ],
    }),
    node({
      key: `root>p:${rozpara}>p:${barzowski}>p:${jedlinski}`,
      personId: jedlinski,
      personName: "Jerzy Jedliński",
      parentKey: `root>p:${rozpara}>p:${barzowski}`,
      direction: "predecessor",
      depth: 3,
      step: step({ personName: "Jerzy Jedliński" }),
    }),
    node({
      key: `root>s:${pluta}`,
      personId: pluta,
      personName: "Marcin Pluta",
      parentKey: "root",
      direction: "successor",
      depth: 1,
      step: step({ personName: "Marcin Pluta" }),
    }),
  ];
}

async function render(nodes: ChainNode[]) {
  return await mountSuspended(ChainColumns, {
    props: { nodes, focusKey: "root" },
  });
}

function cards(wrapper: Awaited<ReturnType<typeof render>>, testid: string) {
  return wrapper.findAll(`[data-testid="${testid}"]`);
}

describe("SuccessionChainColumns", () => {
  it("names every candidate the register allows, however many there are", async () => {
    const wrapper = await render(grobelny());
    const text = wrapper.text();
    for (const name of ZMP_BOARD) expect(text).toContain(name);
    expect(cards(wrapper, "chain-candidate")).toHaveLength(6);
    // The count beside the heading, so the column says how long it is before a
    // reader has counted it themselves.
    expect(text).toContain("6 osób");
  });

  it("says the register filed a batch once for the list, not once per name", async () => {
    const wrapper = await render(grobelny());
    const notes = cards(wrapper, "chain-batch-note");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text()).toContain(
      "Rejestr nie zapisuje, po kim konkretnie ta osoba objęła stanowisko",
    );
  });

  it("carries every seat a merged candidate rests on", async () => {
    const wrapper = await render(grobelny());
    // Two of the six stand next to this person at a second company as well.
    // One card, two provenance lines - a second card with the same name would
    // give the chain two nodes for one human.
    const merged = wrapper.find(
      `[data-testid="chain-candidate"][data-person="${idOf("Andrzej Zabiegliński")}"]`,
    );
    expect(merged.text()).toContain("Związek Miast Polskich · Zarząd");
    expect(merged.text()).toContain(
      "Międzynarodowe Targi Poznańskie · Rada Nadzorcza",
    );
    // `gapLabel` and `shortDate` from the shared modules, so this line and the
    // „Zmiany na stanowisku” section on the person's own page say the same
    // thing about the same two filings.
    expect(merged.text()).toContain("tego samego dnia");
    expect(merged.text()).toContain("po 23 dniach przerwy");
    expect(merged.text()).toContain("08.09.2016 – nadal");
  });

  it("asks the chain to grow, naming the node the card sits in", async () => {
    const wrapper = await render(grobelny());
    const card = wrapper.find(
      `[data-testid="chain-candidate"][data-person="${idOf("Tadeusz Rozpara")}"]`,
    );
    await card.find('[data-testid="chain-expand"]').trigger("click");
    expect(wrapper.emitted("expand")).toEqual([
      [
        {
          nodeKey: "root",
          direction: "predecessor",
          personId: idOf("Tadeusz Rozpara"),
        },
      ],
    ]);

    // And from a card that is not on the focus person. One human can be a
    // candidate under several nodes at once - the chain is keyed by the path
    // and not by the person, so that collapsing one branch does not collapse
    // the other - which is why the payload has to carry the node that was
    // clicked rather than the person's own id or the root.
    const rozpara = idOf("Tadeusz Rozpara");
    const deeper = await render([
      node({
        successors: [
          view(candidate("Tadeusz Rozpara"), {
            expandedKey: `root>s:${rozpara}`,
          }),
        ],
      }),
      node({
        key: `root>s:${rozpara}`,
        personId: rozpara,
        personName: "Tadeusz Rozpara",
        parentKey: "root",
        direction: "successor",
        depth: 1,
        step: step({ personName: "Tadeusz Rozpara" }),
        successors: [view(candidate("Marcin Pluta"))],
      }),
    ]);
    await deeper
      .find(
        `[data-testid="chain-candidate"][data-person="${idOf("Marcin Pluta")}"]`,
      )
      .find('[data-testid="chain-expand"]')
      .trigger("click");
    expect(deeper.emitted("expand")).toEqual([
      [
        {
          nodeKey: `root>s:${rozpara}`,
          direction: "successor",
          personId: idOf("Marcin Pluta"),
        },
      ],
    ]);
  });

  it("offers to close a candidate that is already open, by the key it was opened as", async () => {
    const opened = zmpPredecessors();
    opened[4] = view(opened[4]!.candidate, {
      expandedKey: `root>p:${idOf("Tadeusz Rozpara")}`,
    });
    const wrapper = await render([node({ predecessors: opened })]);
    const card = wrapper.find(
      `[data-testid="chain-candidate"][data-person="${idOf("Tadeusz Rozpara")}"]`,
    );
    expect(card.find('[data-testid="chain-expand"]').exists()).toBe(false);
    await card.find('[data-testid="chain-collapse"]').trigger("click");
    expect(wrapper.emitted("collapse")).toEqual([
      [`root>p:${idOf("Tadeusz Rozpara")}`],
    ]);
  });

  it("refuses to follow somebody already in the chain, and says why", async () => {
    // A → B → A: the register says the seat came back to the person the page
    // is about. Worth printing, worth never following.
    const back = view(candidate("Ryszard Grobelny"), { expandable: false });
    const wrapper = await render([
      node({
        key: "root",
        successors: [
          view(candidate("Tadeusz Rozpara"), {
            expandedKey: `root>s:${idOf("Tadeusz Rozpara")}`,
          }),
        ],
      }),
      node({
        key: `root>s:${idOf("Tadeusz Rozpara")}`,
        personId: idOf("Tadeusz Rozpara"),
        personName: "Tadeusz Rozpara",
        parentKey: "root",
        direction: "successor",
        depth: 1,
        step: step({ personName: "Tadeusz Rozpara" }),
        successors: [back],
      }),
    ]);

    const card = wrapper.find(
      `[data-testid="chain-candidate"][data-person="${idOf("Ryszard Grobelny")}"]`,
    );
    expect(card.find('[data-testid="chain-candidate-cycle"]').text()).toBe(
      "już w łańcuchu",
    );
    expect(card.find('[data-testid="chain-expand"]').exists()).toBe(false);
    expect(card.find('[data-testid="chain-collapse"]').exists()).toBe(false);
  });

  it("draws a chain three steps deep, every node tagged with whose it is", async () => {
    const wrapper = await render(deep());
    const drawn = cards(wrapper, "chain-node");
    expect(drawn).toHaveLength(5);
    // Compared as a set: the two layouts put these five nodes on screen in a
    // different ORDER on purpose - one reads left to right by depth, the other
    // top to bottom by the array - and the order each of them draws is pinned
    // in its own test below. What both must agree on is which people are on
    // screen and how far from the focus person each of them stands.
    expect(
      drawn
        .map(
          (el) =>
            `${el.attributes("data-depth")}:${el.attributes("data-person")}`,
        )
        .sort(),
    ).toEqual(
      [
        `0:pRyszardGrobelny`,
        `1:${idOf("Tadeusz Rozpara")}`,
        `2:${idOf("Jerzy Barzowski")}`,
        `3:${idOf("Jerzy Jedliński")}`,
        `1:${idOf("Marcin Pluta")}`,
      ].sort(),
    );
    // Every node also carries the path it was opened by, which is what a
    // collapse names and what makes two branches that reach one human two
    // nodes rather than one.
    expect(drawn.map((el) => el.attributes("data-key")).sort()).toContain(
      `root>p:${idOf("Tadeusz Rozpara")}>p:${idOf("Jerzy Barzowski")}`,
    );
    // The lists deeper in stop claiming to be about the person the page is
    // about: „Kto mógł być wcześniej” is only true of the first hop, and past
    // it the heading has to count the steps or a reader has no way of telling
    // whose predecessors they are reading.
    const at = (depth: number) =>
      wrapper.find(`[data-testid="chain-node"][data-depth="${depth}"]`).text();
    expect(at(0)).toContain("Kto mógł być wcześniej");
    expect(at(0)).toContain("Kto mógł być później");
    expect(at(1)).toContain("Krok 2 wstecz");
    expect(at(1)).not.toContain("Kto mógł być wcześniej");
    expect(at(2)).toContain("Krok 3 wstecz");
    expect(at(3)).toContain("Krok 4 wstecz");
  });

  it("marks the focus person, and lists posts under nobody else", async () => {
    // Every node in this fixture carries posts, including the ones deeper in:
    // whose posts get drawn is a decision about the focus, not about whether
    // the endpoint filled the field. Deeper in they would be the same list for
    // a reason nobody came here for, six of them at a time in a 260px column.
    const chain = deep().map((entry) => ({
      ...entry,
      step: entry.step ? { ...entry.step, posts: [post()] } : null,
    }));
    const wrapper = await render(chain);

    expect(cards(wrapper, "chain-focus")).toHaveLength(1);
    expect(cards(wrapper, "chain-focus")[0]!.text()).toContain(
      "Ryszard Grobelny",
    );
    const posts = cards(wrapper, "chain-posts");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.text()).toContain("Stanowiska tej osoby");
  });

  it("lists every post of the focus person, including the ones nobody could match", async () => {
    const wrapper = await render(
      grobelny({
        step: step({
          posts: [
            post(),
            post({
              companyId: "mtp",
              companyName: "Międzynarodowe Targi Poznańskie",
              role: "Rada Nadzorcza",
              edgeId: "eFocusMtp",
              start: "2004-04-13",
              end: "2016-08-16",
              predecessorCount: 0,
              successorCount: 1,
            }),
            post({
              companyId: "meetcore",
              companyName: "Meetcore",
              role: null,
              edgeId: "eFocusMeetcore",
              predecessorCount: 0,
              successorCount: 0,
            }),
            post({
              companyId: "metropolia",
              companyName: "Metropolia Poznań",
              role: "Zarząd",
              edgeId: "eFocusMetropolia",
              predecessorCount: 0,
              successorCount: 0,
            }),
          ],
        }),
      }),
    );

    const rows = cards(wrapper, "chain-post");
    expect(rows).toHaveLength(4);
    expect(rows[0]!.text()).toContain(
      "Związek Miast Polskich · Zarząd · 04.06.2003 – 01.06.2015 - 6 przed, 4 po",
    );
    // A post with no role in the register cannot be matched to anybody at all,
    // which is a different sentence from „we looked and found nobody”.
    expect(cards(wrapper, "chain-post-no-role")).toHaveLength(1);
    expect(rows[2]!.text()).toContain(
      "w rejestrze nie ma funkcji dla tego wpisu",
    );
    expect(rows[3]!.text()).toContain(
      "nikt inny nie zajmował tej funkcji w oknie, które sprawdzamy",
    );
  });

  it("says so when a side of somebody is empty", async () => {
    const wrapper = await render([node()]);
    // Both sides: two thirds of the spells in the register have no neighbour
    // at all, so this is the commonest thing this page has to say.
    expect(wrapper.text().match(/Nikogo tu nie znaleźliśmy\./g)).toHaveLength(
      2,
    );
  });

  it("draws one card per person until asked for the rest", async () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      view(candidate(`Kandydat ${"ABCDEFGHIJKLMNO"[index]!}`)),
    );
    const wrapper = await render([node({ successors: many })]);

    expect(cards(wrapper, "chain-candidate")).toHaveLength(12);
    const more = wrapper.find('[data-testid="chain-more"]');
    expect(more.text()).toBe("Pokaż wszystkich (15)");

    await more.trigger("click");
    expect(cards(wrapper, "chain-candidate")).toHaveLength(15);
    expect(wrapper.find('[data-testid="chain-more"]').text()).toBe(
      "Pokaż mniej",
    );
  });

  it("marks a candidate whose page is not published", async () => {
    const wrapper = await render([
      node({
        successors: [
          view(candidate("Tomasz Jacek Lewandowski", { published: false })),
        ],
      }),
    ]);
    expect(cards(wrapper, "chain-candidate-draft")).toHaveLength(1);
    expect(cards(wrapper, "chain-candidate-draft")[0]!.text()).toBe("szkic");
  });

  it("turns one person's failed request into one card, not a broken layout", async () => {
    const wrapper = await render([
      node(),
      node({
        key: `root>s:${idOf("Tadeusz Rozpara")}`,
        personId: idOf("Tadeusz Rozpara"),
        personName: "",
        parentKey: "root",
        direction: "successor",
        depth: 1,
        status: "error",
        step: null,
      }),
    ]);

    const failed = cards(wrapper, "chain-node-error");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.text()).toContain("Nie udało się wczytać tej osoby.");
    // The focus person is still drawn beside it.
    expect(wrapper.text()).toContain("Ryszard Grobelny");

    await wrapper.find('[data-testid="chain-node-retry"]').trigger("click");
    expect(wrapper.emitted("retry")).toEqual([
      [`root>s:${idOf("Tadeusz Rozpara")}`],
    ]);
  });

  it("draws no candidate list at all for a person still on their way", async () => {
    const wrapper = await render([
      node({ status: "pending", step: null, personName: "" }),
    ]);
    // „Nikogo tu nie znaleźliśmy” over a request that has not landed would be
    // a claim the spinner two lines above is contradicting.
    expect(cards(wrapper, "chain-candidates")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Nikogo tu nie znaleźliśmy.");
  });

  it("puts the predecessors on the left in decreasing depth and the focus in the middle", async () => {
    const wrapper = await render(deep());
    const columns = cards(wrapper, "chain-column");
    expect(
      columns.map((el) => [
        el.attributes("data-direction"),
        el.attributes("data-depth"),
      ]),
    ).toEqual([
      ["predecessor", "3"],
      ["predecessor", "2"],
      ["predecessor", "1"],
      ["focus", "0"],
      ["successor", "1"],
    ]);
    // Left to right, deepest predecessor first: the reader walks back in time
    // by walking left.
    expect(
      cards(wrapper, "chain-node").map((el) => el.attributes("data-person")),
    ).toEqual([
      idOf("Jerzy Jedliński"),
      idOf("Jerzy Barzowski"),
      idOf("Tadeusz Rozpara"),
      "pRyszardGrobelny",
      idOf("Marcin Pluta"),
    ]);
    // Every card is tagged with the chain's path key, which is the only thing
    // that ties it to the dot the graph above drew for the same person. Two
    // routes can reach one person, so the key - not the person id - has to be
    // what is unique here, or the join would be ambiguous exactly where a
    // chain doubles back.
    const keys = cards(wrapper, "chain-node").map((el) =>
      el.attributes("data-key"),
    );
    expect(keys.every((key) => Boolean(key))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stacks two branches of the same depth in one column", async () => {
    const rozpara = idOf("Tadeusz Rozpara");
    const kaczmarek = idOf("Wojciech Szczęsny Kaczmarek");
    const wrapper = await render([
      node({
        predecessors: [
          view(candidate("Tadeusz Rozpara"), {
            expandedKey: `root>p:${rozpara}`,
          }),
          view(candidate("Wojciech Szczęsny Kaczmarek"), {
            expandedKey: `root>p:${kaczmarek}`,
          }),
        ],
      }),
      node({
        key: `root>p:${rozpara}`,
        personId: rozpara,
        personName: "Tadeusz Rozpara",
        parentKey: "root",
        direction: "predecessor",
        depth: 1,
        step: step({ personName: "Tadeusz Rozpara" }),
      }),
      node({
        key: `root>p:${kaczmarek}`,
        personId: kaczmarek,
        personName: "Wojciech Szczęsny Kaczmarek",
        parentKey: "root",
        direction: "predecessor",
        depth: 1,
        step: step({ personName: "Wojciech Szczęsny Kaczmarek" }),
      }),
    ]);

    const columns = cards(wrapper, "chain-column");
    expect(columns).toHaveLength(2);
    // One step back is one column, however many people a reader has opened
    // there - a column per branch would walk off the right of the screen after
    // three clicks.
    expect(
      columns[0]!
        .findAll('[data-testid="chain-node"]')
        .map((el) => el.attributes("data-person")),
    ).toEqual([rozpara, kaczmarek]);
  });
});
