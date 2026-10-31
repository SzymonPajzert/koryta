import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import FoundPage from "../../app/pages/oswiadczenia/znalezione.vue";
import type {
  DeclarationFind,
  DeclarationFinds,
} from "../../shared/declarations";

/** The list goes out with the reader's token, through `authRequest`; before
 * it, the readings this browser made without an account are claimed. */
const { mockAuthRequest, mockClaim } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  mockClaim: vi.fn(),
}));
vi.mock("~/composables/auth", () => ({ authRequest: mockAuthRequest }));
vi.mock("~/composables/declarationQueue", () => ({
  claimStoredReadings: mockClaim,
}));

// Vuetify's tooltip behind the (i) observes its activator, and happy-dom
// ships no ResizeObserver.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const person = (n: number, fields: Partial<DeclarationFind> = {}) => ({
  id: `osoba${n}`,
  name: `Jan Szablonowy ${n}`,
  published: true,
  unit: "Testowice (gmina miejsko-wiejska)",
  office: "Rada gminy" as const,
  declarationYear: 2024,
  ...fields,
});

/** What happened, in order: the claim, then each request for the list. */
let calls: string[];
let finds: DeclarationFinds | Error;

beforeEach(() => {
  calls = [];
  finds = { people: [], total: 0 };
  mockClaim.mockReset();
  mockClaim.mockImplementation(async () => {
    calls.push("claim");
    return 0;
  });
  mockAuthRequest.mockReset();
  mockAuthRequest.mockImplementation(
    async (url: string, options: { method: string }) => {
      calls.push(`${options.method} ${url}`);
      if (finds instanceof Error) throw finds;
      return finds;
    },
  );
});

const mounted: { unmount: () => void }[] = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
});

async function mountPage() {
  const wrapper = await mountSuspended(FoundPage);
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const text = (wrapper: Awaited<ReturnType<typeof mountPage>>, at: string) =>
  wrapper.get(at).text().replace(/\s+/g, " ").trim();

describe("/oswiadczenia/znalezione", () => {
  it("claims this browser's readings for the account before asking whom it found", async () => {
    await mountPage();
    await vi.waitFor(() =>
      expect(calls).toEqual(["claim", "GET /api/declarations/found"]),
    );
  });

  it("asks all the same when the claim is turned down", async () => {
    mockClaim.mockRejectedValue(new Error("403"));
    await mountPage();
    await vi.waitFor(() =>
      expect(calls).toEqual(["GET /api/declarations/found"]),
    );
  });

  it("lists the people, each linked to their page, with the declaration that found them and whether the page is live", async () => {
    finds = {
      total: 2,
      people: [
        person(1),
        person(2, {
          published: false,
          unit: "Przykładowo (gmina miejska)",
          office: "Burmistrz",
          declarationYear: null,
        }),
      ],
    };
    const wrapper = await mountPage();

    await vi.waitFor(() =>
      expect(wrapper.findAll('[data-testid="declaration-find"]')).toHaveLength(
        2,
      ),
    );
    const rows = wrapper.findAll('[data-testid="declaration-find"]');
    expect(rows[0]!.get("a").attributes("href")).toBe(
      "/osoba/jan-szablonowy-1-osoba1",
    );
    expect(rows[0]!.text().replace(/\s+/g, " ")).toContain(
      "Testowice (gmina miejsko-wiejska) · Rada gminy · oświadczenie za 2024 r.",
    );
    // Without the year, the line says what it knows.
    expect(rows[1]!.text().replace(/\s+/g, " ")).toContain(
      "Przykładowo (gmina miejska) · Burmistrz",
    );
    expect(rows[1]!.text()).not.toContain("oświadczenie za");
    expect(
      wrapper
        .findAll('[data-testid="declaration-find-state"]')
        .map((state) => state.text().trim()),
    ).toEqual(["Opublikowana", "Szkic"]);
    expect(text(wrapper, ".of-lead")).toBe(
      "Dzięki Twoim odczytom znaleziono 2 osoby.",
    );
  });

  it("says how many it found in the right form, and that it shows the newest of more", async () => {
    finds = { total: 1, people: [person(1)] };
    const one = await mountPage();
    await vi.waitFor(() =>
      expect(text(one, ".of-lead")).toBe(
        "Dzięki Twoim odczytom znaleziono 1 osobę.",
      ),
    );

    finds = {
      total: 250,
      people: Array.from({ length: 100 }, (_, i) => person(i + 1)),
    };
    const many = await mountPage();
    await vi.waitFor(() =>
      expect(text(many, ".of-lead")).toBe(
        "Dzięki Twoim odczytom znaleziono 250 osób. Pokazujemy ostatnie 100.",
      ),
    );
  });

  it("counts a page removed since without saying the list is cut short", async () => {
    finds = { total: 3, people: [person(1)] };
    const wrapper = await mountPage();
    await vi.waitFor(() =>
      expect(text(wrapper, ".of-lead")).toBe(
        "Dzięki Twoim odczytom znaleziono 3 osoby.",
      ),
    );
  });

  it("says what makes a person count while nobody is found, and leads back to the crops", async () => {
    const wrapper = await mountPage();

    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="declaration-finds-empty"]').exists(),
      ).toBe(true),
    );
    const empty = wrapper.get('[data-testid="declaration-finds-empty"]');
    expect(empty.text()).toContain("Na liście nie ma jeszcze nikogo");
    expect(empty.text()).toContain(
      "o ile na jej stronie nie ma innej daty urodzenia",
    );
    // The button is the router's link; the test's router draws no href.
    expect(
      empty
        .findAllComponents({ name: "VBtn" })
        .map((button) => button.props("to")),
    ).toEqual(["/oswiadczenia"]);
    expect(wrapper.find(".of-lead").exists()).toBe(false);
  });

  it("says so when the list does not come, and asks again", async () => {
    finds = new Error("500");
    const wrapper = await mountPage();
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="declaration-finds-error"]').exists(),
      ).toBe(true),
    );

    finds = { total: 1, people: [person(1)] };
    await wrapper.get(".of-state button").trigger("click");
    await vi.waitFor(() =>
      expect(wrapper.findAll('[data-testid="declaration-find"]')).toHaveLength(
        1,
      ),
    );
    expect(calls.filter((call) => call.startsWith("GET"))).toHaveLength(2);
  });
});
