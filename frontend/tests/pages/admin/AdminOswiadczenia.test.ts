import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import OswiadczeniaPage from "../../../app/pages/admin/oswiadczenia.vue";
import type {
  DeclarationOverview,
  DeclarationPublicationRow,
  DeclarationReviewRow,
  DrainResult,
} from "../../../shared/declarations";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({
    user: ref({ uid: "admin" }),
    isAdmin: ref(true),
    isOwner: ref(false),
    isDatascience: ref(false),
  }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

/** Stands in for apexcharts, which measures a real element on mount. */
const Apexchart = defineComponent({
  name: "apexchart",
  props: { options: Object, series: Array, type: String, height: String },
  setup: () => () => h("div", { class: "apexchart-stub" }),
});

/** Renders what the page tells the snackbar, in place, and in which colour.
 * The real one is an overlay teleported out of the wrapper and closed on a
 * timer; what matters here is only whether the page raised it, with which
 * words, and whether as an error. */
const SnackbarStub = defineComponent({
  props: { modelValue: Boolean, color: String },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h(
            "div",
            { "data-snackbar": "", "data-color": props.color },
            slots.default?.(),
          )
        : null;
  },
});

/** A crop readers could not agree on: two read it one way, two with the day
 * and the month swapped, one a decade off, one gave up. */
const DISPUTED: DeclarationReviewRow = {
  id: `${"a".repeat(64)}-p0`,
  unit: "Złota (gmina wiejska)",
  office: "Rada gminy",
  declarationYear: 2024,
  documentUrl: "https://bip.example.pl/oswiadczenia/2024/101.pdf",
  status: "disputed",
  readings: [
    { value: "1965-03-12", readers: 2 },
    { value: "1965-12-03", readers: 2 },
    { value: "1955-03-12", readers: 1 },
  ],
  unreadable: 1,
  agreed: null,
  agreedBy: null,
  machine: { birthDate: "1965-03-12", confidence: "low" },
  people: [
    {
      id: "fx0001",
      name: "Zbigniew Atrapa",
      published: false,
      birthDate: "1965-03-12",
    },
  ],
  updatedAt: "2026-10-29T11:00:00.000Z",
};

/** An agreed reading whose page says another day. */
const DIFFERENT: DeclarationReviewRow = {
  ...DISPUTED,
  id: `${"b".repeat(64)}-p1`,
  status: "agreed",
  readings: [{ value: "1971-09-03", readers: 3 }],
  unreadable: 0,
  agreed: "1971-09-03",
  agreedBy: "readers",
  machine: null,
  people: [
    {
      id: "fx0002",
      name: "Halina Szablonowa",
      published: false,
      birthDate: "1971-03-09",
    },
  ],
};

const published = (
  over: Partial<DeclarationPublicationRow>,
): DeclarationPublicationRow => ({
  personId: "fx0003",
  name: "Tomasz Fikcyjny",
  status: "published",
  reason: null,
  pagePublic: over.status === undefined || over.status === "published",
  at: "2026-10-29T08:15:00.000Z",
  unit: "Koszalin (gmina miejska)",
  documentUrl: "https://bip.example.pl/oswiadczenia/2023/7.pdf",
  edges: { published: 2, held: 0 },
  pressed: false,
  ...over,
});

/** The run twelve days in, as the design round drew it (2026-10-29). */
const overview = (over: Partial<DeclarationOverview> = {}) =>
  ({
    at: "2026-10-29T12:55:00.000Z",
    dailyLimit: 10,
    candidacies: {
      total: 3368,
      people: 2159,
      byStatus: {
        pending: 412,
        found: 1212,
        unconfirmed: 187,
        not_found: 1557,
      },
      notFound: [
        { reason: "no_declarations", count: 611 },
        { reason: "no_seed", count: 127 },
      ],
    },
    extracts: {
      total: 1070,
      byStatus: {
        open: 572,
        agreed: 320,
        unreadable: 11,
        disputed: 14,
        failed: 151,
        withdrawn: 2,
      },
      failed: [{ reason: "blank_form", count: 64 }],
    },
    readers: {
      answers: 1012,
      readers: 37,
      days: [{ day: "2026-10-29", answers: 49, settled: 15 }],
    },
    pages: { same: 94, different: 20, noDate: 178, confirmed: 22 },
    publications: {
      queued: 9,
      published: 74,
      held: 11,
      today: 7,
      heldBy: [{ reason: "pending_proposal", count: 11 }],
    },
    lists: {
      disputed: [DISPUTED],
      different: [DIFFERENT],
      held: [
        published({
          personId: "fx0004",
          name: "Ewa Pozorna",
          status: "held",
          reason: "pending_proposal",
        }),
      ],
      recent: [published({})],
    },
    runs: [
      {
        tag: "bip-cut-v1",
        runId: "20261029T040000Z",
        extracts: 42,
        at: "2026-10-29T04:31:00.000Z",
      },
    ],
    ...over,
  }) satisfies DeclarationOverview;

/** Right after the deploy: nothing sent yet, and the automatic publication
 * still switched off, as it ships. */
const empty = (): DeclarationOverview => ({
  ...overview(),
  dailyLimit: 0,
  candidacies: {
    total: 0,
    people: 0,
    byStatus: { pending: 0, found: 0, unconfirmed: 0, not_found: 0 },
    notFound: [],
  },
  extracts: {
    total: 0,
    byStatus: {
      open: 0,
      agreed: 0,
      unreadable: 0,
      disputed: 0,
      failed: 0,
      withdrawn: 0,
    },
    failed: [],
  },
  readers: { answers: 0, readers: 0, days: [] },
  pages: { same: 0, different: 0, noDate: 0, confirmed: 0 },
  publications: { queued: 0, published: 0, held: 0, today: 0, heldBy: [] },
  lists: { disputed: [], different: [], held: [], recent: [] },
  runs: [],
});

const CROP = "data:image/png;base64,iVBORw0KGgo=";

/** What a press reports (`POST /api/declarations/publish-queued`). */
const drained = (over: Partial<DrainResult> = {}): DrainResult => ({
  day: "2026-10-29",
  limit: 10,
  skipped: null,
  published: [],
  held: [],
  confirmed: [],
  failed: [],
  capReached: false,
  waiting: 0,
  ...over,
});

/** Three of the nine went up, six still wait. */
const pressed = () =>
  drained({ published: ["fx0005", "fx0006", "fx0007"], waiting: 6 });

/** What the endpoints answer the next time the page asks. */
let current: () => DeclarationOverview = overview;
let drain: () => DrainResult = pressed;

type Wrapper = Awaited<ReturnType<typeof mountSuspended>>;
let wrapper: Wrapper | null = null;

async function mountPage() {
  wrapper = await mountSuspended(OswiadczeniaPage, {
    global: { stubs: { apexchart: Apexchart, VSnackbar: SnackbarStub } },
  });
  await flushPromises();
  return wrapper;
}

const overviewLoads = () =>
  mockAuthRequest.mock.calls.filter(
    ([url]) => url === "/api/declarations/overview",
  ).length;

/** The calls that change something, in order. */
const writes = () =>
  mockAuthRequest.mock.calls.filter(
    ([, options]) =>
      (options as { method?: string } | undefined)?.method === "POST",
  );

const base = (row: DeclarationReviewRow) =>
  `/api/declarations/${encodeURIComponent(row.id)}`;

/** The snackbar the page raised, as its words and its colour. */
const snackbar = (page: Wrapper) => {
  const bar = page.get("[data-snackbar]");
  return { text: bar.text(), color: bar.attributes("data-color") ?? null };
};

/** Opens a row of the list, as a click on its line does. */
async function open(page: Wrapper, row: DeclarationReviewRow, list: string) {
  const line = page.get(
    `[data-testid="${list}"] [data-declaration-id="${row.id}"]`,
  );
  await line.get("[data-row-toggle]").trigger("click");
  await flushPromises();
  return page.get(`[data-testid="${list}"] [data-declaration-id="${row.id}"]`);
}

describe("/admin/oswiadczenia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current = overview;
    drain = pressed;
    mockAuthRequest.mockImplementation(async (url: string) => {
      if (url === "/api/declarations/overview") return current();
      if (url === "/api/declarations/publish-queued") return drain();
      if (url.endsWith("/images")) return { date: CROP, name: null };
      return { id: "crop", status: "agreed", compare: false };
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("reads the overview with the admin's token", async () => {
    const page = await mountPage();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/declarations/overview", {
      method: "GET",
    });
    expect(page.get('[data-testid="declarations-overview"]').text()).toContain(
      "Oświadczenia majątkowe",
    );
    // Each list holds its rows, and nothing is open until clicked.
    expect(
      page.findAll(
        '[data-testid="declarations-disputed"] [data-declaration-row]',
      ),
    ).toHaveLength(1);
    expect(
      page.findAll(
        '[data-testid="declarations-different"] [data-declaration-row]',
      ),
    ).toHaveLength(1);
    expect(
      page.findAll('[data-testid="declarations-held"] [data-publication-row]'),
    ).toHaveLength(1);
    expect(
      page.findAll(
        '[data-testid="declarations-recent"] [data-publication-row]',
      ),
    ).toHaveLength(1);
    expect(page.find("[data-row-panel]").exists()).toBe(false);
  });

  it("puts the declarations by state above the chain", async () => {
    // The bar stands above the chain since round bip-admin-r2.
    const page = await mountPage();

    const states = page.get('[data-testid="declarations-states"]');
    const chain = page.get('[data-testid="declarations-progress"]');
    expect(states.text()).toContain("Oświadczenia według stanu");
    expect(
      states.element.compareDocumentPosition(chain.element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("walks the chain stage by stage, each in its own unit", async () => {
    const page = await mountPage();

    const stages = Array.from(
      page.element.querySelectorAll("[data-stage]"),
      (stage: Element) => stage.getAttribute("data-stage"),
    );
    expect(stages).toEqual([
      "search",
      "crops",
      "readings",
      "pages",
      "publications",
      "cap",
    ]);
    const stage = (key: string) => page.get(`[data-stage="${key}"]`).text();
    expect(stage("search")).toContain("Znalezione oświadczenia");
    expect(stage("search")).toContain("z 3368 kandydatur");
    // What needs a person links down to its list.
    expect(
      page
        .get('[data-stage="readings"] [data-line="disputed"]')
        .attributes("href"),
    ).toBe("#sporne");
    expect(
      page
        .get('[data-stage="pages"] [data-line="different"]')
        .attributes("href"),
    ).toBe("#inna-data");
  });

  it("counts today's publications against the limit", async () => {
    const page = await mountPage();

    const cap = page.get('[data-testid="declarations-cap"]');
    expect(cap.attributes("data-limit")).toBe("10");
    expect(cap.text()).toContain("z 10");
    expect(cap.find(".dcap__meter").exists()).toBe(true);
    expect(cap.get("[data-cap-queued]").text()).toBe(
      "9 osób czeka na kolejny dzień.",
    );
  });

  it("says the automatic publication is switched off at a limit of 0", async () => {
    current = () =>
      overview({
        dailyLimit: 0,
        publications: { ...overview().publications, queued: 83, today: 0 },
      });
    const page = await mountPage();

    const cap = page.get('[data-testid="declarations-cap"]');
    expect(cap.attributes("data-limit")).toBe("0");
    expect(cap.text()).toContain("publikowanie automatyczne wyłączone");
    // No places to count when none are given out, and no „z 0”.
    expect(cap.find(".dcap__meter").exists()).toBe(false);
    expect(cap.text()).not.toContain("z 0");
    expect(cap.get("[data-cap-queued]").text()).toBe(
      "83 osoby czekają w kolejce.",
    );
    // An admin's press goes past the limit, at 0 too,
    // so the button is there all the same, and asks without a limit to go
    // past - for one press's batch of the 83.
    await cap.get("[data-cap-publish]").trigger("click");
    await flushPromises();
    expect(cap.get("[data-cap-question]").text()).toBe(
      "Opublikować teraz 25 osób z kolejki?",
    );
    expect(writes()).toEqual([]);
  });

  it("offers the press past the limit once today's places are taken too", async () => {
    current = () =>
      overview({ publications: { ...overview().publications, today: 10 } });
    const page = await mountPage();

    const cap = page.get('[data-testid="declarations-cap"]');
    expect(cap.text()).toContain("z 10");
    expect(cap.get("[data-cap-queued]").text()).toBe(
      "9 osób czeka na kolejny dzień.",
    );
    await cap.get("[data-cap-publish]").trigger("click");
    await flushPromises();
    expect(cap.get("[data-cap-question]").text()).toBe(
      "Opublikować teraz 9 osób z kolejki, ponad dzisiejszy limit?",
    );
  });

  it("offers no press while nobody waits", async () => {
    current = () =>
      overview({ publications: { ...overview().publications, queued: 0 } });
    const page = await mountPage();

    const cap = page.get('[data-testid="declarations-cap"]');
    expect(cap.get("[data-cap-queued]").text()).toBe(
      "Nikt nie czeka w kolejce.",
    );
    expect(cap.find("[data-cap-publish]").exists()).toBe(false);
  });

  it("says nothing has come yet before the first upload", async () => {
    current = empty;
    const page = await mountPage();

    expect(page.get("[data-overview-empty]").text()).toContain(
      "Zadanie jeszcze niczego nie przesłało",
    );
    // A bar of nothing over a chain of zeros says nothing.
    expect(page.find('[data-testid="declarations-states"]').exists()).toBe(
      false,
    );
    expect(page.find('[data-testid="declarations-progress"]').exists()).toBe(
      true,
    );
    expect(page.find('[data-testid="declarations-disputed"]').exists()).toBe(
      false,
    );
    // As it ships: switched off, nobody waiting.
    const cap = page.get('[data-testid="declarations-cap"]');
    expect(cap.text()).toContain("publikowanie automatyczne wyłączone");
    expect(cap.get("[data-cap-queued]").text()).toBe(
      "Nikt nie czeka w kolejce.",
    );
  });

  it("says so when the overview cannot be read", async () => {
    mockAuthRequest.mockRejectedValue({
      data: { message: "Brak uprawnień." },
    });
    const page = await mountPage();

    expect(page.get("[data-overview-error]").text()).toContain(
      "Brak uprawnień.",
    );
  });

  it("settles a disputed crop on a reading and reloads", async () => {
    const page = await mountPage();
    const row = await open(page, DISPUTED, "declarations-disputed");

    // The crop is fetched when the row opens, not before.
    expect(mockAuthRequest).toHaveBeenCalledWith(`${base(DISPUTED)}/images`, {
      method: "GET",
    });
    const accept = row.findAll("[data-settle-reading]");
    // One button a reading: nothing is agreed on a disputed crop.
    expect(accept).toHaveLength(3);
    await accept[1]!.trigger("click");
    await flushPromises();

    expect(writes()).toEqual([
      [
        `${base(DISPUTED)}/settle`,
        { method: "POST", body: { verdict: "date", value: "1965-12-03" } },
      ],
    ]);
    expect(overviewLoads()).toBe(2);
    expect(snackbar(page)).toEqual({
      text: "Przyjęto 03.12.1965.",
      color: null,
    });
  });

  it("settles on a date the admin types", async () => {
    const page = await mountPage();
    const row = await open(page, DISPUTED, "declarations-disputed");

    await row.get("[data-settle-field] input").setValue("12.03.1965");
    await row.get("form").trigger("submit");
    await flushPromises();

    expect(writes()).toEqual([
      [
        `${base(DISPUTED)}/settle`,
        { method: "POST", body: { verdict: "date", value: "1965-03-12" } },
      ],
    ]);
    expect(overviewLoads()).toBe(2);
    expect(snackbar(page)).toEqual({
      text: "Przyjęto 12.03.1965.",
      color: null,
    });
  });

  it("marks a crop unreadable", async () => {
    const page = await mountPage();
    const row = await open(page, DIFFERENT, "declarations-different");

    await row.get("[data-unreadable]").trigger("click");
    await flushPromises();

    expect(writes()).toEqual([
      [
        `${base(DIFFERENT)}/settle`,
        { method: "POST", body: { verdict: "unreadable" } },
      ],
    ]);
    expect(overviewLoads()).toBe(2);
    expect(snackbar(page)).toEqual({
      text: "Wycinek uznany za nieczytelny.",
      color: null,
    });
  });

  it("withdraws a crop only once asked twice", async () => {
    const page = await mountPage();
    const row = await open(page, DIFFERENT, "declarations-different");

    await row.get("[data-withdraw]").trigger("click");
    await flushPromises();
    expect(writes()).toEqual([]);
    expect(page.find("[data-snackbar]").exists()).toBe(false);

    await row.get("[data-withdraw-confirm]").trigger("click");
    await flushPromises();
    expect(writes()).toEqual([
      [`${base(DIFFERENT)}/withdraw`, { method: "POST" }],
    ]);
    expect(overviewLoads()).toBe(2);
    expect(snackbar(page)).toEqual({ text: "Wycinek wycofany.", color: null });
  });

  it("publishes from the queue past today's limit, once asked twice", async () => {
    const page = await mountPage();

    await page.get("[data-cap-publish]").trigger("click");
    await flushPromises();
    expect(writes()).toEqual([]);
    // Seven of ten published today, and the press takes all nine waiting:
    // it goes past the limit rather than into its last three places.
    expect(page.get("[data-cap-question]").text()).toBe(
      "Opublikować teraz 9 osób z kolejki, ponad dzisiejszy limit?",
    );

    await page.get("[data-cap-publish-confirm]").trigger("click");
    await flushPromises();
    expect(writes()).toEqual([
      ["/api/declarations/publish-queued", { method: "POST" }],
    ]);
    expect(overviewLoads()).toBe(2);
    // What the pass reported, not what was asked for, and what is left for
    // the next press.
    expect(snackbar(page)).toEqual({
      text: "Opublikowano z kolejki 3 osoby. W kolejce czeka jeszcze 6 osób.",
      color: null,
    });
  });

  it("says who a press held and how many still wait", async () => {
    drain = () =>
      drained({
        published: ["fx0005"],
        held: [
          { personId: "fx0006", reason: "pending_proposal" },
          { personId: "fx0007", reason: "needs_split" },
        ],
        waiting: 1,
      });
    const page = await mountPage();

    await page.get("[data-cap-publish]").trigger("click");
    await flushPromises();
    await page.get("[data-cap-publish-confirm]").trigger("click");
    await flushPromises();

    expect(snackbar(page)).toEqual({
      text:
        "Opublikowano z kolejki jedną osobę. " +
        "Wstrzymano 2 osoby; powody są na liście „Wstrzymane publikacje”. " +
        "W kolejce czeka jeszcze jedna osoba.",
      color: null,
    });
  });

  it("says why a press published nobody", async () => {
    drain = () => drained({ skipped: "night", waiting: 9 });
    const page = await mountPage();

    await page.get("[data-cap-publish]").trigger("click");
    await flushPromises();
    await page.get("[data-cap-publish-confirm]").trigger("click");
    await flushPromises();

    expect(snackbar(page)).toEqual({
      text:
        "Nikogo nie opublikowano: od 3:00 do 9:00 trwa nocny import osób, " +
        "który mógłby cofnąć publikację. W kolejce czeka jeszcze 9 osób.",
      color: null,
    });
    // The pass has answered, though the queue did not move: the question
    // closes, and the button is there for later.
    const cap = page.get('[data-testid="declarations-cap"]');
    expect(cap.find("[data-cap-publish-confirm]").exists()).toBe(false);
    expect(cap.find("[data-cap-publish]").exists()).toBe(true);
  });

  it("keeps the question up when a press fails", async () => {
    drain = () => {
      throw { data: { message: "Brak uprawnień." } };
    };
    const page = await mountPage();

    await page.get("[data-cap-publish]").trigger("click");
    await flushPromises();
    await page.get("[data-cap-publish-confirm]").trigger("click");
    await flushPromises();

    expect(snackbar(page)).toEqual({
      text: "Brak uprawnień.",
      color: "error",
    });
    // No reload after a press that did not happen, and the question stays
    // for another try.
    expect(overviewLoads()).toBe(1);
    expect(page.find("[data-cap-publish-confirm]").exists()).toBe(true);
  });

  it("keeps a failed decision's row and says why", async () => {
    const page = await mountPage();
    const row = await open(page, DISPUTED, "declarations-disputed");
    mockAuthRequest.mockImplementation(async (url: string) => {
      if (url.endsWith("/settle")) {
        throw { data: { message: "Ten wycinek ktoś już rozstrzygnął." } };
      }
      return current();
    });

    await row.get("[data-unreadable]").trigger("click");
    await flushPromises();

    // No reload after a write that did not happen.
    expect(overviewLoads()).toBe(1);
    expect(
      page
        .get('[data-testid="declarations-disputed"] [data-row-panel]')
        .exists(),
    ).toBe(true);
    // The server's own words, as an error.
    expect(snackbar(page)).toEqual({
      text: "Ten wycinek ktoś już rozstrzygnął.",
      color: "error",
    });
  });

  it("says a decision failed when the server gives no reason", async () => {
    const page = await mountPage();
    const row = await open(page, DIFFERENT, "declarations-different");
    mockAuthRequest.mockImplementation(async (url: string) => {
      if (url.endsWith("/withdraw")) throw new Error("fetch failed");
      return current();
    });

    await row.get("[data-withdraw]").trigger("click");
    await flushPromises();
    await row.get("[data-withdraw-confirm]").trigger("click");
    await flushPromises();

    expect(overviewLoads()).toBe(1);
    expect(snackbar(page)).toEqual({
      text: "Nie udało się zapisać decyzji.",
      color: "error",
    });
  });

  it("says behind its (i)s that the job and an admin settle dates too, what the press does, and that an admin's date publishes nobody", async () => {
    // The real bubble is a tooltip, drawn only once it opens.
    const InfoBubble = defineComponent({
      props: { label: { type: String, default: "" } },
      setup(props, { slots }) {
        return () => h("span", { "data-info": props.label }, slots.default?.());
      },
    });
    wrapper = await mountSuspended(OswiadczeniaPage, {
      global: {
        stubs: { apexchart: Apexchart, VSnackbar: SnackbarStub, InfoBubble },
      },
    });
    await flushPromises();
    const info = (label: string) =>
      wrapper!.get(`[data-info="${label}"]`).text().replace(/\s+/g, " ");

    expect(info("Oświadczenia majątkowe")).toBe(
      "Zadanie na predatorze szuka w BIP-ach oświadczeń majątkowych radnych, którzy mają stronę w serwisie, wycina z nich linię z datą urodzenia i przesyła wycinki tutaj. " +
        "Datę wpisaną na komputerze zadanie ustala samo, gdy odczyt jest pewny; z pozostałych wycinków datę przepisują czytelnicy, nie widząc daty ze strony osoby. " +
        "Odczyt czytelników jest rozstrzygnięty przy zgodzie co najmniej 2 osób i przewadze 2 głosów nad każdą inną datą, a wycinek, co do którego się nie zgodzą, rozstrzyga administrator. " +
        "Ustaloną datę porównuje się z datą na stronie osoby. " +
        "Szkic z tą samą datą publikuje się sam, razem z zatrudnieniami w KRS i wyborami w regionie z oświadczenia, najwyżej 10 osób dziennie. " +
        "Przycisk „Opublikuj z kolejki” publikuje od razu do 25 czekających osób, ponad dzienny limit, także przy wyłączonym publikowaniu automatycznym. " +
        "Każda strona przechodzi te same sprawdzenia co przy publikacji automatycznej, więc część może zostać wstrzymana, a „Dziś” liczy tylko publikacje automatyczne. " +
        "W czasie importu osób, w tym nocnego od 3:00 do 9:00, nie publikuje się nikogo, także przyciskiem. " +
        "Data przyjęta przez administratora nikogo nie publikuje: szkic z nią czeka w sekcji „Wstrzymane publikacje” na publikację ręczną.",
    );
    // Not every date on the list is one readers agreed on.
    expect(info("Inna data niż na stronie")).toBe(
      "Data z wycinka nie zgadza się z datą na stronie osoby. " +
        "Tę datę uzgodnili czytelnicy, odczytało zadanie albo przyjął administrator; kto, widać w otwartym wierszu. " +
        "Jedna cyfra różnicy to zwykle źle odczytany wycinek albo literówka na stronie; inny rok to częściej oświadczenie innej osoby, i wtedy wycinek się wycofuje. " +
        "Przyjęta tu data, która dalej różni się od strony, wraca na tę listę, a szkic z tą samą datą trafia do sekcji „Wstrzymane publikacje”.",
    );
    // The press holds what the automation would; a page that is public
    // already cannot be published by hand.
    expect(info("Wstrzymane publikacje")).toBe(
      "Osoby z tą samą datą, których stron nie opublikowano ani automatycznie, ani przyciskiem „Opublikuj z kolejki”, bo ktoś już o nich zdecydował albo coś budzi wątpliwość. " +
        "Niebieskie to cudza decyzja, bursztynowe czekają na wyjaśnienie. " +
        "Szkic można opublikować ręcznie z jego strony. Wiersz zostaje wtedy na liście, ze stroną oznaczoną jako publiczna.",
    );
    // Not every page on the list is one the automation published; the note
    // goes once the reading stops confirming the page's date.
    expect(info("Opublikowane ostatnio")).toBe(
      "Strony, które opublikował automat albo administrator przyciskiem „Opublikuj z kolejki”, razem z zatrudnieniami w KRS i wyborami w regionie z oświadczenia; kto, widać w otwartym wierszu. " +
        "Każda ma na sobie notkę z linkiem do oświadczenia, dopóki jego odczyt potwierdza datę urodzenia na stronie.",
    );
  });

  it("says in an open row whether the automation or an admin published the page", async () => {
    current = () =>
      overview({
        lists: {
          ...overview().lists,
          recent: [
            published({ personId: "fx0008", name: "Józef Makieta" }),
            published({
              personId: "fx0009",
              name: "Irena Próbna",
              pressed: true,
            }),
          ],
        },
      });
    const page = await mountPage();
    const recent = async (personId: string) => {
      const selector = `[data-testid="declarations-recent"] [data-person-id="${personId}"]`;
      await page.get(`${selector} [data-row-toggle]`).trigger("click");
      await flushPromises();
      return page.get(selector).text();
    };

    expect(await recent("fx0008")).toContain("opublikowana automatycznie");
    const byAdmin = await recent("fx0009");
    expect(byAdmin).toContain("opublikowana przez administratora");
    expect(byAdmin).not.toContain("automatycznie");
  });

  it("says nobody was published yet once the job has sent something", async () => {
    current = () => overview({ lists: { ...overview().lists, recent: [] } });
    const page = await mountPage();

    expect(page.get('[data-testid="declarations-recent"]').text()).toBe(
      "Jeszcze nikogo nie opublikowano.",
    );
  });

  it("asks for a check of a draft an admin's date holds, and nothing of one published by hand since", async () => {
    current = () =>
      overview({
        lists: {
          ...overview().lists,
          held: [
            published({
              personId: "fx0006",
              name: "Jerzy Wzorcowy",
              status: "held",
              reason: "admin_decision",
            }),
            published({
              personId: "fx0007",
              name: "Wanda Przykładowa",
              status: "held",
              reason: "admin_decision",
              pagePublic: true,
            }),
          ],
        },
      });
    const page = await mountPage();
    const held = async (personId: string) => {
      const selector = `[data-testid="declarations-held"] [data-person-id="${personId}"]`;
      await page.get(`${selector} [data-row-toggle]`).trigger("click");
      await flushPromises();
      return page.get(selector);
    };

    const draft = await held("fx0006");
    // Amber, as the section's legend has a hold that waits for somebody.
    expect(draft.classes()).toContain("arow--tone-warning");
    expect(draft.get("[data-page-public]").text()).toBe("szkic");
    expect(draft.get("[data-hold-note]").text()).toBe(
      "Opublikuj ręcznie ze strony osoby, jeśli się zgadza.",
    );

    const up = await held("fx0007");
    expect(up.classes()).toContain("arow--tone-info");
    expect(up.get("[data-page-public]").text()).toBe("publiczna");
    expect(up.get("[data-hold-note]").text()).toBe(
      "Strona jest już publiczna. Oświadczenia na niej nie podpięto, bo datę ustalił administrator.",
    );
  });
});
