import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { clearNuxtData } from "#app";
import CompanySection from "../../../app/components/contract/CompanySection.vue";
import type {
  ContractCompanyStats,
  ContractCoverage,
  ContractRow,
} from "../../../shared/contracts";

/** „Umowy publiczne" on an institution's page, in the states the seed cannot
 * photograph.
 *
 * The one that matters most is the empty one: 4 103 of 4 928 companies have no
 * contract in the window we hold, `/instytucja/` draws 42% of the site's search
 * impressions, and a section that rendered a heading over „nic nie znaleźliśmy"
 * on five pages in six would be the most-printed thing this feature ships. So
 * the assertion is about the *heading*, not about the rows.
 *
 * The second is the copy that must not appear here at all. A both-sides search
 * coming back empty is a sentence for `/eksploruj/umowy`: we hold 825 of the
 * register's 12 858 contracting institutions, and on a page a stranger reads a
 * null result would pass for a clearance.
 */

const currentUser = ref<{ uid: string } | null>(null);
vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  useAuthState: () => ({ user: currentUser }),
}));

const NODE_ID = "company1";

function coverage(): ContractCoverage {
  return {
    total: 149683,
    stored: 149683,
    linked: 13333,
    bothLinked: 154,
    companies: 825,
    namedPeople: 900,
    withIndividual: 18505,
    registerInstitutions: 12858,
    from: "2026-07-01",
    to: "2026-08-10",
    computedAt: "2026-09-13T01:07:05.000Z",
    sources: ["cru"],
  };
}

function stats(over: Partial<ContractCompanyStats> = {}): ContractCompanyStats {
  return {
    nodeId: NODE_ID,
    buyerCount: 728,
    buyerValue: 46_900_000,
    supplierCount: 3,
    supplierValue: 12_000,
    totalCount: 728,
    totalValue: 46_900_000,
    medianValue: 1436,
    lastSignedAt: "2026-08-04",
    computedAt: "2026-09-13T01:07:05.000Z",
    ...over,
  };
}

function row(over: Partial<ContractRow> = {}): ContractRow {
  return {
    id: "cru_1",
    source: "cru",
    sourceId: "1",
    subject: "Dostawa materiałów biurowych",
    value: 1436,
    signedAt: "2026-07-14",
    buyer: {
      role: "buyer",
      kind: "jsfp",
      nodeId: NODE_ID,
      nodeName: "Szpital",
    },
    suppliers: [{ role: "supplier", kind: "firma", name: "PAPIER SP. Z O.O." }],
    nodeIds: [NODE_ID],
    linked: true,
    bothLinked: false,
    nips: ["1234563218"],
    buyerNodeId: NODE_ID,
    supplierNodeIds: [],
    hasIndividual: false,
    valueSort: 1436,
    signedSort: "2026-07-14",
    ...over,
  };
}

/** What the endpoint answers with, set by each test before it mounts. */
let response: {
  stats: ContractCompanyStats | null;
  rows: ContractRow[];
  nextCursor: string | null;
  topFiveShare: number | null;
  hiddenPeople: number;
  coverage: ContractCoverage;
};

registerEndpoint(`/api/contracts/company/${NODE_ID}`, () => response);

async function mount() {
  const wrapper = await mountSuspended(CompanySection, {
    props: { nodeId: NODE_ID, companyName: "Szpital Uniwersytecki" },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  clearNuxtData();
  currentUser.value = null;
  response = {
    stats: stats(),
    rows: [row()],
    nextCursor: null,
    topFiveShare: 0.813,
    hiddenPeople: 0,
    coverage: coverage(),
  };
});

describe("ContractCompanySection", () => {
  it("renders nothing at all for a company with no contracts", async () => {
    response = { ...response, stats: null, rows: [], topFiveShare: null };

    const wrapper = await mount();

    expect(wrapper.find('[data-testid="company-contracts"]').exists()).toBe(
      false,
    );
    // The heading and not just the rows: an empty section with a title is still
    // a section, on 4 103 company pages.
    expect(wrapper.html()).not.toContain("Umowy publiczne");
  });

  it("states the coverage in the singular for a single contract", async () => {
    response = {
      ...response,
      stats: stats({ totalCount: 1, buyerCount: 1, supplierCount: 0 }),
      topFiveShare: null,
    };

    const wrapper = await mount();
    const lead = wrapper.find('[data-testid="company-contracts-coverage"]');

    expect(lead.text()).toContain("stroną jednej umowy zarejestrowanej");
    expect(lead.text()).toContain("1 lipca 2026");
    expect(lead.text()).toContain("10 sierpnia 2026");
  });

  it("drops the median, the role toggle and the full list at n=1", async () => {
    response = {
      ...response,
      stats: stats({
        totalCount: 1,
        buyerCount: 1,
        supplierCount: 0,
        totalValue: 1500,
        medianValue: 1500,
      }),
      topFiveShare: null,
    };

    const wrapper = await mount();

    // One contract is its own median, and printing both would say the same
    // number twice.
    expect(
      wrapper.find('[data-testid="company-contracts-summary"]').text(),
    ).not.toContain("mediana");
    expect(
      wrapper.find('[data-testid="company-contracts-role"]').exists(),
    ).toBe(false);
    expect(wrapper.html()).not.toContain("Pokaż wszystkie umowy");
  });

  it("prints the sum, the count and the median together above n=1", async () => {
    // Whitespace normalised first: every figure `shared/money.ts` prints is
    // held together by non-breaking spaces, on purpose - a value must never
    // wrap between „46,9" and „mln" or between the thousands and „zł".
    const text = (await mount())
      .find('[data-testid="company-contracts-summary"]')
      .text()
      .replace(/\s/g, " ");

    expect(text).toContain("728 umów");
    expect(text).toContain("46,9 mln zł");
    // The distribution is median 1 436 zł against a maximum of 1,1 mld: a sum
    // on its own reads as what this institution typically spends.
    expect(text).toContain("mediana 1 436 zł");
  });

  it("says how concentrated the money is, rounded off the served share", async () => {
    const wrapper = await mount();

    expect(
      wrapper.find('[data-testid="company-contracts-concentration"]').text(),
    ).toContain("Pięć największych to 81% tej kwoty.");
  });

  it("says nothing about concentration when the handler withheld the share", async () => {
    response = { ...response, topFiveShare: null };

    const wrapper = await mount();

    expect(
      wrapper.find('[data-testid="company-contracts-concentration"]').exists(),
    ).toBe(false);
  });

  it("says nothing about concentration below ten contracts", async () => {
    response = {
      ...response,
      stats: stats({ totalCount: 9, buyerCount: 9 }),
      topFiveShare: 0.9,
    };

    const wrapper = await mount();

    expect(
      wrapper.find('[data-testid="company-contracts-concentration"]').exists(),
    ).toBe(false);
  });

  it("offers the role filter only where the institution is on both sides", async () => {
    const wrapper = await mount();
    const toggle = wrapper.find('[data-testid="company-contracts-role"]');

    expect(toggle.exists()).toBe(true);
    expect(toggle.text()).toContain("Jako zamawiający");
    expect(toggle.text()).toContain("Jako wykonawca");
  });

  it("hides the role filter for an institution that only ever buys", async () => {
    response = { ...response, stats: stats({ supplierCount: 0 }) };

    const wrapper = await mount();

    expect(
      wrapper.find('[data-testid="company-contracts-role"]').exists(),
    ).toBe(false);
  });

  it("asks a logged out reader to sign in once, not once per row", async () => {
    response = {
      ...response,
      hiddenPeople: 4,
      rows: [row(), row({ id: "b" })],
    };

    const wrapper = await mount();

    expect(
      wrapper.findAllComponents({ name: "ExploreLoginBanner" }),
    ).toHaveLength(1);
  });

  it("does not ask a signed-in reader to sign in", async () => {
    currentUser.value = { uid: "reader" };
    response = { ...response, hiddenPeople: 4 };

    const wrapper = await mount();

    expect(
      wrapper.findAllComponents({ name: "ExploreLoginBanner" }),
    ).toHaveLength(0);
  });

  it("never reports a both-sides search on a company page", async () => {
    const html = (await mount()).html();

    // Both sentences belong to /eksploruj/umowy. Here they would read as a
    // clearance for an institution whose counterparties we simply do not hold.
    expect(html).not.toContain("po obu stronach");
    expect(html).not.toContain("nie znaleźliśmy nikogo");
  });
});
