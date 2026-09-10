import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearNuxtData, useRouter } from "#app";
import SukcesjePage from "../../../app/pages/eksploruj/sukcesje/[slug].vue";
import type { SuccessionChainStep } from "../../../server/api/edges/succession-chain.get";

/** Somebody is signed in for the whole of this file, and they have to be.
 *
 * The route carries `middleware: "auth"`, which awaits `getCurrentUser()`.
 * `tests/setup.ts` leaves that one real while stubbing everything that would
 * ever resolve it - `onAuthStateChanged` is a bare `vi.fn()` - so navigating
 * to this route with the default mocks never returns at all: `router.push`
 * hangs and `mountSuspended` with it, which reads as a test that times out
 * rather than as a page that redirects. Overriding `getCurrentUser` is what
 * lets the middleware fall through, and it is also the honest state for this
 * page, which nobody signed out can reach.
 */
const signedInUser = { uid: "qa-reader", getIdToken: async () => "token" };

vi.mock("vuefire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuefire")>();
  return {
    ...actual,
    useFirestore: vi.fn(() => ({})),
    useCollection: vi.fn(() => ref([])),
    useFirebaseAuth: vi.fn(() => ({ currentUser: signedInUser })),
    useCurrentUser: vi.fn(() => ref(signedInUser)),
    useIsCurrentUserLoaded: vi.fn(() => ref(true)),
    getCurrentUser: vi.fn(async () => signedInUser),
  };
});

/** What the endpoint answers, by person id. A person missing from here gets
 * the empty step the handler returns for an id it may not name, which is what
 * drives the „nie znaleźliśmy” card. */
let answers: Record<string, SuccessionChainStep> = {};

/** Every person the page asked about, in order. */
const asked: string[] = [];

registerEndpoint("/api/edges/succession-chain", (event) => {
  const params = new URL(event.node.req.url ?? "/", "http://test").searchParams;
  const personId = params.get("personId") ?? "";
  asked.push(personId);
  return answers[personId] ?? empty(personId);
});

function empty(personId: string): SuccessionChainStep {
  return {
    personId,
    personName: "",
    parties: [],
    published: false,
    posts: [],
    predecessors: [],
    successors: [],
    hidden: 0,
  };
}

function step(
  personId: string,
  fields: Partial<SuccessionChainStep> = {},
): SuccessionChainStep {
  return {
    ...empty(personId),
    personName: `Osoba ${personId}`,
    published: true,
    ...fields,
  };
}

function candidate(personId: string, personName: string) {
  return {
    personId,
    personName,
    parties: [],
    published: true,
    via: [
      {
        companyId: "orlen",
        companyName: "Orlen",
        role: "Zarząd",
        focusEdgeId: "e1",
        focusStart: "2010-01-01",
        focusEnd: "2015-01-01",
        edgeId: "e2",
        start: "2005-01-01",
        end: "2010-01-01",
        gapDays: 0,
        batchSize: 1,
      },
    ],
    closestGapDays: 0,
  };
}

/** The chain layout, stubbed down to the one thing this file is about: that the
 * page hands it the `nodes` list and the handlers.
 *
 * It has its own tests; what a page test can say about it is which people
 * reach it, and that survives the real component landing - the stub carries
 * the same `chain-columns` / `chain-node` testids the real one does.
 *
 * The bare button is the one thing it adds: expanding is the only way a second
 * person ever gets into the chain, and it is the columns that own that control
 * - so a page test that wants to watch the graph grow has to press it here.
 * `chain-stub-expand` is deliberately not a testid the real component uses,
 * because nothing outside this file may lean on it.
 */
const ColumnsStub = {
  name: "SuccessionChainColumns",
  props: ["nodes", "focusKey"],
  template: `<div data-testid="chain-columns">
    <span
      v-for="node in nodes"
      :key="node.key"
      data-testid="chain-node"
      :data-person="node.personId"
    >{{ node.personName }}</span>
    <button
      v-for="view in (nodes[0] ? nodes[0].predecessors : [])"
      :key="view.candidate.personId"
      data-testid="chain-stub-expand"
      :data-person="view.candidate.personId"
      @click="$emit('expand', {
        nodeKey: nodes[0].key,
        direction: 'predecessor',
        personId: view.candidate.personId,
      })"
    >rozwiń</button>
  </div>`,
};

/** The graph above the columns, stubbed the same way and for the same reason.
 *
 * What it draws is covered where it can be: the markup in
 * `tests/components/succession/ChainGraph.test.ts`, the coordinates in
 * `tests/utils/successionGraphLayout.test.ts`. The only thing a page test can
 * say about it is that it is fed from the same place the columns are, so the
 * people it was handed - by id, in order - is all this stub exposes.
 */
const GraphStub = {
  name: "SuccessionChainGraph",
  props: ["nodes", "focusKey"],
  template: `<div data-testid="chain-graph">
    <span
      v-for="node in nodes"
      :key="node.key"
      data-testid="chain-graph-node"
      :data-person="node.personId"
    />
  </div>`,
};

/** The person ids one of the two stubs was handed, top to bottom. */
function people(
  wrapper: Awaited<ReturnType<typeof mountPage>>,
  testid: string,
): (string | undefined)[] {
  return wrapper
    .findAll(`[data-testid="${testid}"]`)
    .map((el) => el.attributes("data-person"));
}

/** Every wrapper this file has mounted, so `afterEach` can take them down.
 *
 * `mountSuspended` leaves a page mounted for the lifetime of the file and this
 * one watches the route: resetting the query in `beforeEach` would otherwise
 * make every still-live wrapper react to it. */
const mounted: { unmount: () => void }[] = [];

/** The slug the id `sukdanuta` is reached by. The id is the last dash
 * separated segment, so a fixture id must contain no hyphen of its own. */
const ROUTE = "/eksploruj/sukcesje/danuta-obejmujaca-sukdanuta";

async function mountPage(route: string = ROUTE) {
  const wrapper = await mountSuspended(SukcesjePage, {
    route,
    global: {
      stubs: {
        SuccessionChainColumns: ColumnsStub,
        SuccessionChainGraph: GraphStub,
      },
    },
  });
  mounted.push(wrapper);
  // `mountSuspended` returns before the chain's request lands: the page
  // deliberately does not await it, so there is nothing for suspense to hold.
  await vi.waitUntil(
    () =>
      wrapper.find('[data-testid="chain-node"]').exists() ||
      wrapper.find('[data-testid="chain-not-found"]').exists() ||
      wrapper.find('[data-testid="chain-error"]').exists(),
    { timeout: 5000 },
  );
  return wrapper;
}

describe("eksploruj/sukcesje/[slug]", () => {
  beforeEach(async () => {
    asked.length = 0;
    answers = {};
    await useRouter().replace({ query: {} });
  });

  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
    clearNuxtData();
  });

  it("asks about the id at the end of the slug, and draws that person", async () => {
    answers.sukdanuta = step("sukdanuta", {
      personName: "Danuta Obejmująca",
      predecessors: [candidate("sukbogdan", "Bogdan Poprzedni")],
      successors: [candidate("sukcelina", "Celina Następna")],
    });

    const wrapper = await mountPage();

    expect(asked).toEqual(["sukdanuta"]);
    expect(wrapper.find('[data-testid="succession-chain"]').exists()).toBe(
      true,
    );
    expect(wrapper.find("h1").text()).toBe(
      "Łańcuch następstw: Danuta Obejmująca",
    );
    expect(wrapper.text()).toContain("Danuta Obejmująca");
  });

  it("says the address is wrong rather than showing an empty chain", async () => {
    // The endpoint answers 200 with an empty name for an id it may not name,
    // and the commonest cause by far is a link that lost its capitals - the id
    // is a case sensitive Firestore document id.
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="chain-not-found"]').text()).toContain(
      "identyfikator na końcu jest wrażliwy na wielkość liter",
    );
    expect(wrapper.find('[data-testid="chain-columns"]').exists()).toBe(false);
    // The graph goes with them. It lives inside the same `v-else`, so a page
    // that is telling the reader the address is wrong cannot also be drawing
    // a circle for the person it did not find.
    expect(wrapper.find('[data-testid="chain-graph"]').exists()).toBe(false);
  });

  it("draws the same people above the columns as in them", async () => {
    answers.sukdanuta = step("sukdanuta", {
      personName: "Danuta Obejmująca",
      predecessors: [candidate("sukbogdan", "Bogdan Poprzedni")],
    });
    answers.sukbogdan = step("sukbogdan", {
      personName: "Bogdan Poprzedni",
      predecessors: [candidate("sukalicja", "Alicja Wcześniejsza")],
    });

    const wrapper = await mountPage();

    // One person open, so one circle: the graph shows what has been explored,
    // not what could be.
    expect(people(wrapper, "chain-graph-node")).toEqual(["sukdanuta"]);

    // Expanded through the columns - the only control there is - and the graph
    // has to follow from the same array without being told.
    await wrapper.find('[data-testid="chain-stub-expand"]').trigger("click");
    await vi.waitUntil(() => people(wrapper, "chain-node").length === 2, {
      timeout: 5000,
    });

    expect(people(wrapper, "chain-graph-node")).toEqual([
      "sukdanuta",
      "sukbogdan",
    ]);
    expect(people(wrapper, "chain-graph-node")).toEqual(
      people(wrapper, "chain-node"),
    );
    // And it cost nothing: both drawings read one composable, so the second
    // person was fetched once and the graph never asked at all.
    expect(asked).toEqual(["sukdanuta", "sukbogdan"]);
  });

  it("explains the picture without promising one where nobody matched", async () => {
    answers.sukdanuta = step("sukdanuta", {
      personName: "Danuta Obejmująca",
      predecessors: [candidate("sukbogdan", "Bogdan Poprzedni")],
    });

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="chain-graph-lead"]').text()).toContain(
      "dopasowania po datach, a nie ustalenia",
    );

    // A person nobody matched still gets their circle - it is them, and their
    // posts below are the answer to "why nobody" - but there will never be an
    // arrow between it and anything, so the sentence about arrows goes.
    while (mounted.length) mounted.pop()!.unmount();
    answers.sukdanuta = step("sukdanuta", { personName: "Danuta Obejmująca" });
    const alone = await mountPage();

    expect(alone.find('[data-testid="chain-graph"]').exists()).toBe(true);
    expect(alone.find('[data-testid="chain-graph-lead"]').exists()).toBe(false);
  });

  it("distinguishes a person nobody matched from a person we cannot show", async () => {
    answers.sukdanuta = step("sukdanuta", {
      personName: "Danuta Obejmująca",
      posts: [
        {
          companyId: "orlen",
          companyName: "Orlen",
          role: "Zarząd",
          edgeId: "e1",
          start: "2010-01-01",
          end: "2015-01-01",
          predecessorCount: 0,
          successorCount: 0,
        },
      ],
    });

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="chain-not-found"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="chain-empty"]').text()).toContain(
      "Nie znaleźliśmy nikogo, kto pasowałby datami",
    );
    // The person is still drawn: their posts are the answer to "why nobody".
    expect(wrapper.find('[data-testid="chain-columns"]').exists()).toBe(true);
  });

  it("counts the people it is not naming", async () => {
    answers.sukdanuta = step("sukdanuta", {
      personName: "Danuta Obejmująca",
      predecessors: [candidate("sukbogdan", "Bogdan Poprzedni")],
      hidden: 3,
    });

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="chain-hidden"]').text()).toBe(
      "Nie pokazujemy 3 osób - brakuje ich stron, więc nie nazywamy ich tutaj.",
    );
  });
});
