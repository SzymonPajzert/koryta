import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Card from "../../../app/components/contract/link/Card.vue";
import Teaser from "../../../app/components/contract/link/Teaser.vue";
import {
  captureFeedbackContext,
  useFeedbackSubject,
} from "../../../app/composables/feedback";
import { useFeedbackDialog } from "../../../app/composables/feedbackDialog";
import {
  CONTRACT_LINK_UNCONFIRMED_HOOK,
  type ContractLinkPerson,
  type ContractLinkRow,
  type ContractLinkTeaser,
} from "../../../shared/contractLinks";
import type { ContractParty, ContractRow } from "../../../shared/contracts";

/** The finding rows on /eksploruj/umowy: what a card says that the seed's
 * five fixtures cannot make it say - a namesake, a firm with more payers than
 * the list holds, ties left out for an anonymous reader, a shared contract. */

const trackGoal = vi.fn();
vi.mock("~/composables/analytics", () => ({
  trackGoal: (...args: unknown[]) => trackGoal(...args),
  setGlobalProp: vi.fn(),
}));

const fetchContractLink = vi.fn();
vi.mock("~/composables/contractLinks", () => ({
  fetchContractLink: (...args: unknown[]) => fetchContractLink(...args),
}));

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

function person(
  overrides: Partial<ContractLinkPerson> = {},
): ContractLinkPerson {
  return {
    name: "Jan Testowy",
    kind: "politician",
    roles: ["udziałowiec"],
    sharePct: 33,
    controlNow: true,
    candidacies: [
      { year: 2024, office: "rada powiatu testowskiego", result: "won" },
    ],
    wonYears: [2024],
    inOfficeNow: true,
    committees: [],
    ...overrides,
  };
}

function link(overrides: Partial<ContractLinkRow> = {}): ContractLinkRow {
  return {
    id: "cru_9990000011",
    locked: false,
    nip: "9990000011",
    krs: ["0000999011"],
    company: "BUDTEST SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    companySeat: "gmina Testowo, powiat testowski",
    status: "verified",
    strength: "A",
    visibility: "public",
    rank: 3,
    inOfficeNow: true,
    controlNow: true,
    people: [person()],
    ties: [],
    total: 2_000_000,
    ownAreaTotal: 2_000_000,
    firmTotal: 2_000_000,
    firmContracts: 6,
    deals: 6,
    basis: "own_territory",
    buyers: [
      {
        name: "STAROSTWO POWIATOWE W TESTOWIE",
        value: 1_500_000,
        contracts: 3,
        ownArea: true,
      },
      { name: "GMINA TESTOWO", value: 300_000, contracts: 1, ownArea: true },
    ],
    buyerCount: 5,
    place: { wojewodztwo: "mazowieckie" },
    contractIds: [],
    flags: [],
    hook: "mandat w radzie powiatu",
    updatedAt: "2026-09-25T00:00:00Z",
    ...overrides,
  };
}

const supplier = (name: string): ContractParty => ({
  role: "supplier",
  kind: "firma",
  name,
});

function contract(index: number, fields: Partial<ContractRow> = {}) {
  return {
    id: `cru_${index}`,
    source: "cru",
    sourceId: `id-${index}`,
    number: `ZP.272.${index}.2026`,
    subject: "Dostawa materiałów biurowych",
    value: 1_000,
    signedAt: "2026-07-24",
    buyer: { role: "buyer", kind: "jsfp", name: "GMINA TESTOWO" },
    suppliers: [supplier("BUDTEST")],
    nodeIds: [],
    linked: false,
    bothLinked: false,
    nips: [],
    supplierNodeIds: [],
    hasIndividual: false,
    valueSort: 1_000,
    signedSort: "2026-07-24",
    ...fields,
  } as ContractRow;
}

const mountCard = (
  props: Partial<InstanceType<typeof Card>["$props"]> = {},
  fields: Partial<ContractLinkRow> = {},
) => mountSuspended(Card, { props: { link: link(fields), ...props } });

const button = (
  wrapper: Awaited<ReturnType<typeof mountCard>>,
  testId: string,
) => wrapper.find(`[data-testid="${testId}"]`);

beforeEach(() => {
  trackGoal.mockClear();
  fetchContractLink.mockReset();
  fetchContractLink.mockResolvedValue({ link: link(), contracts: [] });
});

describe("ContractLinkCard, collapsed", () => {
  it("carries its id and rank, for a permalink and the list's cursor", async () => {
    const wrapper = await mountCard();
    const root = wrapper.find("article");
    expect(root.attributes("id")).toBe("cru_9990000011");
    expect(root.attributes("data-rank")).toBe("3");
    expect(root.attributes("data-testid")).toBe("powiazanie-cru_9990000011");
  });

  it("counts the other payers from buyerCount, not from the list", async () => {
    const text = (await mountCard()).text();
    expect(text).toContain("i 4 inne jednostki");
  });

  it("drops „dziś w urzędzie” for a namesake and says why", async () => {
    expect((await mountCard()).text()).toContain("dziś w urzędzie");
    const text = (
      await mountCard({}, { flags: ["identity_unconfirmed"] })
    ).text();
    expect(text).not.toContain("dziś w urzędzie");
    expect(text).toContain("Nie mamy pewności, że to ta sama osoba");
  });

  it("leads with whoever is in office today", async () => {
    const wrapper = await mountCard(
      {},
      {
        people: [
          person({
            name: "Marek Przykładowy",
            inOfficeNow: false,
            wonYears: [2002],
          }),
          person({ name: "Ewa Przykładowa" }),
        ],
      },
    );
    expect(wrapper.find(".link-row__name").text()).toBe("Ewa Przykładowa");
  });

  it("says who holds the firm today when the person no longer does", async () => {
    const text = (
      await mountCard(
        {},
        {
          flags: ["control_through_tie"],
          people: [person({ controlNow: false, controlUntil: "2025-11-21" })],
          ties: [{ name: "Anna Testowa", tie: "wspólniczka", confirmed: true }],
        },
      )
    ).text();
    expect(text).toContain("do 21 listopada 2025 r.");
    expect(text).toContain("dziś w firmie: wspólniczka");
  });

  it("tells an anonymous reader about the ties left out, with the way in", async () => {
    const wrapper = await mountCard(
      { loginLink: "/login?konto=nowe&powod=powiazania-osoby" },
      { hiddenTies: 2 },
    );
    const line = button(wrapper, "powiazanie-ukryte-osoby");
    expect(line.text()).toContain(
      "Z firmą są powiązane jeszcze 2 osoby — ich nazwiska widzą zalogowani.",
    );
    const anchor = line.find("a");
    expect(anchor.attributes("href")).toBe(
      "/login?konto=nowe&powod=powiazania-osoby",
    );
    await anchor.trigger("click");
    expect(wrapper.emitted("gate")).toHaveLength(1);

    expect(
      (await mountCard())
        .find('[data-testid="powiazanie-ukryte-osoby"]')
        .exists(),
    ).toBe(false);
  });
});

describe("ContractLinkCard, opened", () => {
  it("counts an open once per card, and not one a link opened", async () => {
    const wrapper = await mountCard();
    const toggle = button(wrapper, "powiazanie-rozwin");
    await toggle.trigger("click");
    await toggle.trigger("click");
    await toggle.trigger("click");
    expect(trackGoal).toHaveBeenCalledTimes(1);
    expect(trackGoal).toHaveBeenCalledWith("powiazania:open", {
      strength: "A",
    });

    trackGoal.mockClear();
    const linked = await mountCard({ startOpen: true });
    expect(linked.find(".link-row__detail").exists()).toBe(true);
    expect(trackGoal).not.toHaveBeenCalled();
  });

  it("shows the registers, the seat and every office with its real result", async () => {
    const wrapper = await mountCard(
      { startOpen: true },
      {
        people: [
          person({
            candidacies: [
              {
                year: 2024,
                office: "rada powiatu testowskiego",
                result: "won",
              },
              {
                year: 2014,
                office: "wójt Wzorcowo",
                result: "unknown",
              },
            ],
          }),
          person({
            name: "Marek Przykładowy",
            inOfficeNow: false,
            candidacies: [],
            wonYears: [1998, 2002],
          }),
        ],
      },
    );
    const text = wrapper.text();
    expect(text).toContain("siedziba: gmina Testowo, powiat testowski");
    expect(text).toContain("NIP 9990000011");
    expect(
      wrapper.find('[data-testid="powiazanie-rejestry"] a').attributes("href"),
    ).toBe("https://rejestr.io/krs/0000999011");
    expect(text).toContain("wójt Wzorcowo: wynik nieznany 2014");
    expect(text).not.toContain("bez mandatu");
    expect(text).toContain("mandat: 1998 i 2002");
  });

  it("closes „Kto płacił” with the payers past the listed ones", async () => {
    const text = (await mountCard({ startOpen: true })).text();
    expect(text.replace(/\s/g, " ")).toContain(
      "i jeszcze 3 jednostki — 200 tys. zł (2 umowy)",
    );
  });

  it("folds from a second „Zwiń” under the contracts", async () => {
    const wrapper = await mountCard({ startOpen: true });
    await button(wrapper, "powiazanie-zwin").trigger("click");
    await flushPromises();
    expect(wrapper.find(".link-row__detail").exists()).toBe(false);
  });
});

describe("ContractLinkCard actions", () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("copies the finding's permalink", async () => {
    const wrapper = await mountCard();
    await button(wrapper, "powiazanie-link").trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/eksploruj/umowy?powiazanie=cru_9990000011`,
    );
    expect(wrapper.text()).toContain("Skopiowano");
  });

  it("copies a gated finding by its rank, never by the NIP", async () => {
    const wrapper = await mountCard({}, { visibility: "gated", rank: 84 });
    await button(wrapper, "powiazanie-link").trigger("click");
    await flushPromises();
    const url = writeText.mock.calls[0]![0] as string;
    expect(url).toMatch(/\?powiazanie=ukryte_84$/);
    expect(url).not.toContain("9990000011");
  });

  it("puts the address in front of the reader when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const wrapper = await mountCard();
    await button(wrapper, "powiazanie-link").trigger("click");
    await flushPromises();
    expect(wrapper.find(".link-row__fallback").text()).toContain(
      "/eksploruj/umowy?powiazanie=cru_9990000011",
    );
  });

  it("opens the site's report dialog about this finding", async () => {
    const wrapper = await mountCard();
    await button(wrapper, "powiazanie-zglos").trigger("click");
    expect(useFeedbackDialog().value).toBe(true);
    expect(useFeedbackSubject().value).toEqual({
      route: "/eksploruj/umowy?powiazanie=cru_9990000011",
      title: "Powiązanie: BUDTEST sp. z o.o.",
    });

    // What the dialog attaches when it opens: the finding, once. The next
    // report from the floating „Zgłoś" is about the page again.
    const page = {
      fullPath: "/eksploruj/umowy?woj=mazowieckie",
      params: {},
    } as unknown as Parameters<typeof captureFeedbackContext>[0];
    expect(captureFeedbackContext(page)).toMatchObject({
      route: "/eksploruj/umowy?powiazanie=cru_9990000011",
      pageTitle: "Powiązanie: BUDTEST sp. z o.o.",
    });
    expect(useFeedbackSubject().value).toBeNull();
    expect(captureFeedbackContext(page).route).toBe(
      "/eksploruj/umowy?woj=mazowieckie",
    );
    useFeedbackDialog().value = false;
  });
});

describe("ContractLinkContracts", () => {
  it("shows a shared contract as the firm's part of it, as the totals count it", async () => {
    fetchContractLink.mockResolvedValue({
      link: link(),
      contracts: [
        contract(5, {
          value: 2_400_000,
          suppliers: [supplier("BUDTEST"), supplier("INNA")],
        }),
      ],
    });
    const wrapper = await mountCard({ startOpen: true });
    await flushPromises();
    const list = button(wrapper, "powiazanie-umowy").text().replace(/\s/g, " ");
    expect(list).toContain("1 200 000 zł");
    expect(list).toContain("z 2 400 000 zł");
    expect(list).toContain("umowa z 2 wykonawcami");
    expect(list).toContain("nr ZP.272.5.2026");
  });

  it("shows the contracts a permalink brought with it, without asking again", async () => {
    // What `?powiazanie=` renders on the server: the list, not a progress bar
    // waiting for a request the page has already made.
    const wrapper = await mountCard({
      startOpen: true,
      contracts: [contract(1), contract(2)],
    });
    expect(wrapper.find(".v-progress-linear").exists()).toBe(false);
    expect(wrapper.findAll(".link-contracts__list li")).toHaveLength(2);
    await flushPromises();
    expect(fetchContractLink).not.toHaveBeenCalled();

    // An empty answer is an answer too.
    const empty = await mountCard({ startOpen: true, contracts: [] });
    await flushPromises();
    expect(empty.text()).toContain("Umów tego powiązania nie ma jeszcze");
    expect(fetchContractLink).not.toHaveBeenCalled();
  });

  it("asks for the contracts when the page has none, and says so when that fails", async () => {
    fetchContractLink.mockRejectedValue(new Error("offline"));
    const wrapper = await mountCard({ startOpen: true });
    await flushPromises();
    expect(fetchContractLink).toHaveBeenCalledWith("cru_9990000011");
    expect(wrapper.text()).toContain("Nie udało się wczytać umów.");
  });

  it("shows the first ten and the rest on request", async () => {
    fetchContractLink.mockResolvedValue({
      link: link(),
      contracts: Array.from({ length: 12 }, (_, index) => contract(index)),
    });
    const wrapper = await mountCard({ startOpen: true });
    await flushPromises();
    expect(wrapper.findAll(".link-contracts__list li")).toHaveLength(10);
    const more = button(wrapper, "powiazanie-umowy-wszystkie");
    expect(more.text()).toContain("Pokaż wszystkie (12)");
    await more.trigger("click");
    expect(wrapper.findAll(".link-contracts__list li")).toHaveLength(12);
  });
});

describe("ContractLinkTeaser", () => {
  const teaser: ContractLinkTeaser = {
    id: "ukryte_84",
    locked: true,
    rank: 84,
    status: "plausible",
    strength: "C",
    totalRange: [2_000, 5_000],
    dealsRange: [2, 4],
    inOfficeNow: true,
    hook: "wójt",
    place: { wojewodztwo: "mazowieckie" },
  };

  it("prints bands, carries its rank and hands itself to the gate", async () => {
    const wrapper = await mountSuspended(Teaser, {
      props: { teaser, loginLink: "/login?konto=nowe" },
    });
    const text = wrapper.text().replace(/\s/g, " ");
    expect(text).toContain("2–5 tys. zł");
    expect(text).toContain("2–4 umowy");
    expect(wrapper.find("article").attributes("data-rank")).toBe("84");
    await wrapper.find('[data-testid="powiazanie-odblokuj"]').trigger("click");
    expect(wrapper.emitted("gate")).toEqual([[teaser]]);
  });

  it("leads with the office in words that fit anyone", async () => {
    const wrapper = await mountSuspended(Teaser, {
      props: {
        teaser: { ...teaser, hook: "mandat w radzie powiatu" },
        loginLink: "/login?konto=nowe",
      },
    });
    expect(wrapper.find(".link-teaser__hook").text()).toBe(
      "Mandat w radzie powiatu",
    );
    expect(wrapper.text()).toContain("dziś w urzędzie");
  });

  it("claims no office for a possible namesake", async () => {
    const wrapper = await mountSuspended(Teaser, {
      props: {
        teaser: { ...teaser, hook: CONTRACT_LINK_UNCONFIRMED_HOOK },
        loginLink: "/login?konto=nowe",
      },
    });
    expect(wrapper.find(".link-teaser__hook").text()).toBe(
      "Możliwa zbieżność nazwisk",
    );
    expect(wrapper.text()).not.toContain("dziś w urzędzie");
  });
});
