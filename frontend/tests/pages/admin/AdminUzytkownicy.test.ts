import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { useRouter } from "#app";
import UzytkownicyPage from "../../../app/pages/admin/uzytkownicy.vue";
import type {
  AdminUserRow,
  AdminUsersResponse,
  UserListScope,
} from "../../../shared/userAdmin";
import {
  NOW,
  daysBefore,
  userDetail,
  userRow,
  usersResponse,
} from "../../components/admin/users/rows";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: { uid: "me" } } }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

/** Renders what the page tells the snackbar, in place - see the same stub in
 * FeedbackQueue.test.ts. */
const SnackbarStub = defineComponent({
  props: { modelValue: Boolean },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h("div", { "data-snackbar": "" }, slots.default?.())
        : null;
  },
});

const trialAdmin = { level: "admin", trial: true, owner: false } as const;

/** Somebody in every section, each out of the order the page puts them in. */
const board = (): AdminUserRow[] => [
  userRow("plain", {
    displayName: "Jan Wójcik",
    lastRefreshAt: daysBefore(4),
  }),
  userRow("trial-new", {
    displayName: "Tomasz Lewandowski",
    current: trialAdmin,
    trialStartedAt: daysBefore(12),
  }),
  userRow("me", {
    displayName: "Ja Sam",
    current: { level: "admin", trial: false, owner: true },
  }),
  userRow("asker", {
    displayName: "Marta Nowicka",
    email: "marta@example.com",
    accessRequest: {
      reason: "Chcę dodawać artykuły z rozszerzenia.",
      source: "pomoc",
      createdAt: daysBefore(1),
      status: "open",
    },
  }),
  userRow("trial-old", {
    displayName: "Katarzyna Wiśniewska",
    current: trialAdmin,
    trialStartedAt: daysBefore(41),
  }),
  userRow("nominee", {
    displayName: "Piotr Zieliński",
    current: { level: "trusted", trial: false, owner: false },
    nomination: {
      desired: {
        level: "datascience",
        trial: false,
        reason: "Dużo dobrych propozycji.",
        by: "me",
        byName: "Ja Sam",
        at: daysBefore(2),
      },
      pending: true,
      applyError: null,
    },
  }),
  userRow("ds", {
    displayName: "Anna Kowalczyk",
    current: { level: "datascience", trial: false, owner: false },
  }),
  userRow("pipeline-krs", {
    displayName: null,
    email: null,
    robot: true,
    lastRefreshAt: daysBefore(0),
  }),
];

/** Answers every GET of the list with a fresh copy of `rows` for the scope
 * asked, and every detail with its row as the list has it. A POST answers with
 * what `posted` makes of it, and a row it answers with is what the server
 * holds from then on - so the detail fetched after a write agrees with it. */
function serve(
  rows: (scope: UserListScope) => AdminUserRow[] = () => board(),
  posted: (body: Record<string, unknown>) => unknown = () => ({ ok: true }),
) {
  const written = new Map<string, AdminUserRow>();
  const held = (scope: UserListScope) =>
    rows(scope).map((row) => written.get(row.uid) ?? row);
  mockAuthRequest.mockImplementation(
    async (
      url: string,
      opts: {
        method: string;
        query?: { zakres?: UserListScope };
        body?: Record<string, unknown>;
      },
    ) => {
      if (opts.method === "POST") {
        const answer = posted(opts.body ?? {});
        const row = answer as AdminUserRow | null;
        if (row && typeof row === "object" && "uid" in row) {
          written.set(row.uid, row);
        }
        return structuredClone(answer);
      }
      if (url === "/api/admin/users") {
        const scope = opts.query?.zakres ?? "aktywni";
        return structuredClone(
          usersResponse(held(scope), { scope }),
        ) satisfies AdminUsersResponse;
      }
      const uid = decodeURIComponent(url.split("/").pop()!);
      const row = held("wszyscy").find((entry) => entry.uid === uid);
      if (!row) throw { data: { message: "Nie ma takiego konta." } };
      return structuredClone(userDetail(row));
    },
  );
}

const listCalls = () =>
  mockAuthRequest.mock.calls.filter(([url]) => url === "/api/admin/users");
const detailCalls = (uid: string) =>
  mockAuthRequest.mock.calls.filter(
    ([url]) => url === `/api/admin/users/${uid}`,
  );

const mounted: { unmount: () => void }[] = [];

async function mount(hash = "", query: Record<string, string> = {}) {
  const wrapper = await mountSuspended(UzytkownicyPage, {
    route: { path: "/", hash, query },
    global: { stubs: { UserChip: true, VSnackbar: SnackbarStub } },
  });
  mounted.push(wrapper);
  await vi.waitUntil(() => listCalls().length > 0, { timeout: 2000 });
  await flushPromises();
  return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mount>>;

/** Section keys in the order they are on the page. */
const sectionKeys = (wrapper: Wrapper) =>
  wrapper
    .findAll("section[data-section]")
    .map((node) => node.attributes("data-section"));

const uidsIn = (wrapper: Wrapper, key: string) =>
  wrapper
    .findAll(`section[data-section="${key}"] [data-user-row]`)
    .map((node) => node.attributes("data-uid"));

const isOpen = (wrapper: Wrapper, uid: string) =>
  wrapper.get(`#u-${uid}`).find("[data-row-panel]").exists();

const currentRoute = () => useRouter().currentRoute.value;

describe("/admin/uzytkownicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    serve();
  });

  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
    vi.useRealTimers();
  });

  it("asks for the active accounts and lays them out in sections, queues oldest first", async () => {
    const wrapper = await mount();

    expect(listCalls()[0]).toEqual([
      "/api/admin/users",
      { method: "GET", query: { zakres: "aktywni" } },
    ]);
    expect(sectionKeys(wrapper)).toEqual([
      "requests",
      "pending",
      "trials",
      "team",
      "others",
    ]);
    expect(uidsIn(wrapper, "requests")).toEqual(["asker"]);
    expect(uidsIn(wrapper, "pending")).toEqual(["nominee"]);
    // The longest trial first: it is the one past its review date.
    expect(uidsIn(wrapper, "trials")).toEqual(["trial-old", "trial-new"]);
    expect(uidsIn(wrapper, "team")).toEqual(["me", "ds"]);
    // The robot last, greyed.
    expect(uidsIn(wrapper, "others")).toEqual(["plain", "pipeline-krs"]);
    expect(wrapper.get("#u-pipeline-krs").classes()).toContain("arow--dimmed");

    const head = wrapper.get('section[data-section="trials"]');
    expect(head.get("[data-section-count]").text()).toBe("2");
    expect(head.text()).toContain("Okresy próbne");
    expect(
      wrapper
        .get("#u-trial-old [data-trial-days]")
        .attributes("data-trial-due"),
    ).toBe("true");
    expect(
      wrapper
        .get("#u-trial-new [data-trial-days]")
        .attributes("data-trial-due"),
    ).toBe("false");
    expect(wrapper.find("#u-nominee [data-pending-chip]").exists()).toBe(true);
  });

  it("leaves a section with nobody in it off the page", async () => {
    serve(() => [userRow("plain")]);
    const wrapper = await mount();
    expect(sectionKeys(wrapper)).toEqual(["others"]);
  });

  it("asks for every account when the switch is on, and keeps it in the url", async () => {
    serve((scope) =>
      scope === "wszyscy" ? [...board(), userRow("dormant")] : board(),
    );
    const wrapper = await mount();
    expect(wrapper.find("#u-dormant").exists()).toBe(false);

    const input = wrapper.get("[data-scope-switch] input");
    (input.element as HTMLInputElement).checked = true;
    await input.trigger("input");
    await vi.waitUntil(() => listCalls().length > 1, { timeout: 2000 });
    await flushPromises();

    expect(listCalls()[1]![1]).toEqual({
      method: "GET",
      query: { zakres: "wszyscy" },
    });
    expect(currentRoute().query.zakres).toBe("wszyscy");
    expect(wrapper.find("#u-dormant").exists()).toBe(true);
  });

  it("starts from the scope the url names", async () => {
    await mount("", { zakres: "wszyscy" });
    expect(listCalls()[0]![1]).toEqual({
      method: "GET",
      query: { zakres: "wszyscy" },
    });
  });

  it("finds people by name, address or uid without asking the server", async () => {
    const wrapper = await mount();
    const field = wrapper.get("[data-user-search] input");

    await field.setValue("wisniewska");
    expect(
      wrapper.findAll("[data-user-row]").map((r) => r.attributes("data-uid")),
    ).toEqual(["trial-old"]);

    await field.setValue("marta@");
    expect(uidsIn(wrapper, "requests")).toEqual(["asker"]);
    expect(wrapper.findAll("[data-user-row]")).toHaveLength(1);

    await field.setValue("pipeline");
    expect(uidsIn(wrapper, "others")).toEqual(["pipeline-krs"]);

    await field.setValue("nikogo-takiego");
    expect(wrapper.findAll("[data-user-row]")).toHaveLength(0);
    expect(wrapper.find("[data-nothing-matches]").exists()).toBe(true);

    expect(listCalls()).toHaveLength(1);
    // A copy goes to the url once typing stops, so the link can be shared.
    await vi.waitUntil(() => currentRoute().query.szukaj === "nikogo-takiego", {
      timeout: 2000,
    });
  });

  it("starts from the search the url names", async () => {
    const wrapper = await mount("", { szukaj: "kowalczyk" });
    expect(
      wrapper.findAll("[data-user-row]").map((r) => r.attributes("data-uid")),
    ).toEqual(["ds"]);
  });

  it("narrows to one level from the chips, counting each", async () => {
    const wrapper = await mount();
    const chip = (value: string) => wrapper.get(`[data-filter="${value}"]`);
    expect(chip("administrator").text()).toContain("3");
    expect(chip("zespol").text()).toContain("1");

    await chip("administrator").trigger("click");
    // The router navigates asynchronously, and the page reads the level back
    // from the url.
    await vi.waitUntil(() => currentRoute().query.poziom === "administrator", {
      timeout: 2000,
    });
    await flushPromises();

    expect(sectionKeys(wrapper)).toEqual(["trials", "team"]);
    expect(uidsIn(wrapper, "team")).toEqual(["me"]);
  });

  it("fetches an account's detail when its row first opens, and only then", async () => {
    const wrapper = await mount();
    expect(detailCalls("ds")).toHaveLength(0);

    const toggle = wrapper.get("#u-ds [data-row-toggle]");
    await toggle.trigger("click");
    await flushPromises();
    expect(isOpen(wrapper, "ds")).toBe(true);
    expect(detailCalls("ds")).toEqual([
      ["/api/admin/users/ds", { method: "GET" }],
    ]);
    expect(wrapper.get("#u-ds [data-user-stats]").text()).toContain("Oceny");

    await toggle.trigger("click");
    await toggle.trigger("click");
    await flushPromises();
    expect(detailCalls("ds")).toHaveLength(1);
  });

  it("opens and loads the account a link names", async () => {
    const wrapper = await mount("#u-nominee");
    expect(isOpen(wrapper, "nominee")).toBe(true);
    expect(wrapper.get("#u-nominee").classes()).toContain("arow--target");
    expect(detailCalls("nominee")).toHaveLength(1);
  });

  it("looks in every account for a link the active list does not have", async () => {
    serve((scope) =>
      scope === "wszyscy" ? [...board(), userRow("dormant")] : board(),
    );
    const wrapper = await mount("#u-dormant");
    await vi.waitUntil(
      () => wrapper.find("#u-dormant [data-row-panel]").exists(),
      {
        timeout: 2000,
      },
    );
    expect(listCalls().map(([, opts]) => opts.query.zakres)).toEqual([
      "aktywni",
      "wszyscy",
    ]);
    expect(currentRoute().query.zakres).toBe("wszyscy");
    expect(currentRoute().hash).toBe("#u-dormant");
    expect(isOpen(wrapper, "dormant")).toBe(true);
  });

  it("says so when the account a link names is nowhere", async () => {
    const wrapper = await mount("#u-gone");
    // Not in the active list, so the page looks in all of them first.
    await vi.waitUntil(() => listCalls().length > 1, { timeout: 2000 });
    await vi.waitUntil(() => wrapper.find("[data-missing-target]").exists(), {
      timeout: 2000,
    });
    expect(currentRoute().query.zakres).toBe("wszyscy");
  });

  it("clears a search that hides the account a link names", async () => {
    const wrapper = await mount("#u-ds", { szukaj: "marta" });
    await vi.waitUntil(() => currentRoute().query.szukaj === undefined, {
      timeout: 2000,
    });
    await flushPromises();
    expect(isOpen(wrapper, "ds")).toBe(true);
    expect(currentRoute().hash).toBe("#u-ds");
    expect(
      (wrapper.get("[data-user-search] input").element as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("does not let the reader nominate themselves", async () => {
    const wrapper = await mount("#u-me");
    expect(wrapper.get("#u-me").find("[data-nomination-form]").exists()).toBe(
      false,
    );
    expect(wrapper.get("#u-me [data-no-nomination]").text()).toContain(
      "To Twoje konto",
    );
  });

  it("moves a nominated account to the script's section with the row the server sends back", async () => {
    serve(
      () => board(),
      (body) =>
        userRow("ds", {
          displayName: "Anna Kowalczyk",
          current: { level: "datascience", trial: false, owner: false },
          nomination: {
            desired: {
              level: "admin",
              trial: true,
              reason: String(body.reason),
              by: "me",
              byName: "Ja Sam",
              at: NOW.toISOString(),
            },
            pending: true,
            applyError: null,
          },
        }),
    );
    const wrapper = await mount("#u-ds");

    const input = wrapper.get('#u-ds [data-level="admin"] input');
    (input.element as HTMLInputElement).checked = true;
    await input.trigger("input");
    await wrapper
      .get("#u-ds [data-nomination-reason] textarea")
      .setValue("Przegląda kolejkę codziennie.");
    await wrapper.get("#u-ds [data-nomination-form]").trigger("submit");
    await flushPromises();

    const post = mockAuthRequest.mock.calls.find(
      ([, opts]) => opts.method === "POST",
    );
    expect(post).toEqual([
      "/api/admin/users/nominate",
      {
        method: "POST",
        body: {
          uid: "ds",
          level: "admin",
          trial: true,
          reason: "Przegląda kolejkę codziennie.",
        },
      },
    ]);
    // Behind the nomination that has waited longer.
    expect(uidsIn(wrapper, "pending")).toEqual(["nominee", "ds"]);
    expect(wrapper.find("#u-ds [data-pending-chip]").exists()).toBe(true);
    // Still open where it moved to.
    expect(isOpen(wrapper, "ds")).toBe(true);
    expect(wrapper.get("[data-snackbar]").text()).toContain(
      "Nominacja zapisana",
    );
  });

  it("keeps the list and says why when a refresh fails", async () => {
    const wrapper = await mount();
    mockAuthRequest.mockRejectedValueOnce({
      data: { message: "Ta strona jest dostępna tylko dla administratorów." },
    });
    const input = wrapper.get("[data-scope-switch] input");
    (input.element as HTMLInputElement).checked = true;
    await input.trigger("input");
    await vi.waitUntil(() => listCalls().length > 1, { timeout: 2000 });
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Nie udało się odświeżyć listy kont: Ta strona jest dostępna tylko dla administratorów.",
    );
    expect(wrapper.findAll("[data-user-row]").length).toBe(board().length);
  });

  it("draws the first hundred of the rest and the others on request", async () => {
    const many = Array.from({ length: 105 }, (_, index) =>
      userRow(`u${String(index).padStart(3, "0")}`, {
        lastRefreshAt: daysBefore(index),
      }),
    );
    serve(() => many);
    const wrapper = await mount("#u-u104");

    // The link's account is drawn although it is the last of them.
    expect(uidsIn(wrapper, "others")).toHaveLength(101);
    expect(uidsIn(wrapper, "others").at(-1)).toBe("u104");
    expect(
      wrapper.get('section[data-section="others"] [data-section-count]').text(),
    ).toBe("105");
    const more = wrapper.get("[data-show-more]");
    expect(more.text()).toBe("Pokaż pozostałych (4)");

    await more.trigger("click");
    expect(uidsIn(wrapper, "others")).toHaveLength(105);
    expect(wrapper.find("[data-show-more]").exists()).toBe(false);
  });
});
