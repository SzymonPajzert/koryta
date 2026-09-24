import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { clearNuxtData, useRouter } from "#app";
import AktywnoscPage from "../../app/pages/aktywnosc.vue";
import ContributorName from "../../app/components/stats/ContributorName.vue";
import type {
  ActivityFeed,
  FeedActor,
  FeedBatch,
  FeedRange,
} from "../../shared/activityFeed";
import type { ActivityStats } from "../../server/api/stats/activity.get";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({
    user: { value: { uid: "me" } },
    isAdmin: { value: false },
  }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const actor = (key: string, overrides: Partial<FeedActor> = {}): FeedActor => ({
  key,
  uid: null,
  name: key,
  named: true,
  isSelf: false,
  photoURL: null,
  newAdmin: false,
  ...overrides,
});

let serial = 0;

const batch = (
  actorKey: string,
  lastAt: string,
  overrides: Partial<FeedBatch> = {},
): FeedBatch => ({
  id: `${actorKey}:${serial++}`,
  kind: "vote",
  actorKey,
  firstAt: lastAt,
  lastAt,
  count: 1,
  objects: { person: 1 },
  alongEdges: 0,
  targets: [
    {
      key: `t${serial}`,
      type: "person",
      name: `Osoba ${serial}`,
      href: `/osoba/osoba-t${serial}`,
    },
  ],
  moreTargets: 0,
  ...overrides,
});

const feed = (overrides: Partial<ActivityFeed> = {}): ActivityFeed => ({
  window: {
    since: "2026-09-15T10:00:00.000Z",
    until: "2026-09-22T10:00:00.000Z",
    days: 7,
  },
  identified: false,
  actors: [],
  batches: [],
  newAdmins: [],
  truncated: [],
  ...overrides,
});

// "Now" is Tuesday 22 September 2026, midday in Warsaw.
const NOW = new Date("2026-09-22T10:00:00Z");

/** A contributor feed as a reader who is not an administrator gets it: their
 * own lines, a named person, and a masked one. */
const contributorFeed = () =>
  feed({
    actors: [
      actor("self", { name: "Ja Sam", isSelf: true }),
      actor("named-1", { name: "Anna Nowak" }),
      actor("anon-1", { name: "Anonim 1", named: false }),
    ],
    batches: [
      batch("self", "2026-09-22T09:00:00.000Z"),
      batch("named-1", "2026-09-22T07:00:00.000Z", {
        kind: "note",
        count: 2,
      }),
      batch("anon-1", "2026-09-21T15:00:00.000Z"),
      batch("named-1", "2026-09-20T15:00:00.000Z", {
        kind: "publish",
        count: 3,
        objects: { person: 3 },
      }),
    ],
  });

/** The same week as an established administrator sees it: uids, and two
 * administrators on trial, one of whom did nothing. */
const adminFeed = () =>
  feed({
    identified: true,
    actors: [
      actor("uid-me", { uid: "uid-me", name: "Szymon", isSelf: true }),
      actor("uid-miki", { uid: "uid-miki", name: "Mikołaj", newAdmin: true }),
      actor("uid-anna", { uid: "uid-anna", name: "Anna Nowak" }),
    ],
    batches: [
      batch("uid-miki", "2026-09-22T09:00:00.000Z", {
        kind: "publish",
        count: 3,
        objects: { person: 3 },
      }),
      batch("uid-anna", "2026-09-22T08:00:00.000Z"),
      batch("uid-me", "2026-09-21T08:00:00.000Z"),
    ],
    newAdmins: [
      actor("uid-miki", { uid: "uid-miki", name: "Mikołaj", newAdmin: true }),
      actor("uid-kasia", { uid: "uid-kasia", name: "Kasia", newAdmin: true }),
    ],
  });

const FEED_URL = "/api/activity/feed";
const STATS_URL = "/api/stats/activity";

/** The month the chart over the feed draws: two busy days, the rest quiet. */
const monthStats = (): ActivityStats => {
  const daily = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 7, 24 + index));
    const vote = index === 27 ? 12 : index === 29 ? 5 : 0;
    return {
      date: date.toISOString().slice(0, 10),
      counts: { vote, revision: 0, noteSource: 0, publication: 0 },
      total: vote,
    };
  });
  return {
    window: { since: daily[0]!.date, until: daily[29]!.date, days: 30 },
    identified: false,
    totals: { vote: 17, revision: 0, noteSource: 0, publication: 0 },
    total: 17,
    daily,
    contributorCount: 2,
    contributors: [],
    namedCount: 0,
    self: null,
    truncated: [],
  };
};

/** Requests the page has sent and not yet had answered. */
let inFlight = 0;

/** Whether the week being served is quiet enough for the page to go on and
 * ask for the month, which a test has to wait out before it clicks anything:
 * the second answer replaces the first and resets a pick made in between. */
let widens = false;

/** A window's answer, or a function giving it for a test that has to hold the
 * request open or have it fail. A function rather than a promise, so a
 * rejection exists only once the page has asked and is there to catch it. */
type Answer = ActivityFeed | (() => Promise<ActivityFeed>);

/** Serves `byDays[days]`, so a test can tell the week from the month. The
 * chart over the feed gets the same month every time. */
function serve(byDays: Partial<Record<FeedRange, Answer>>) {
  const week = byDays[7];
  widens = typeof week !== "function" && (week?.batches.length ?? 0) < 10;
  mockAuthRequest.mockImplementation(
    async (url: string, options: { query: { days: FeedRange } }) => {
      if (url === STATS_URL) return monthStats();
      inFlight++;
      try {
        await Promise.resolve();
        const answer = byDays[options.query.days] ?? byDays[7];
        if (!answer) throw new Error(`no feed for ${options.query.days}`);
        return typeof answer === "function" ? await answer() : answer;
      } finally {
        inFlight--;
      }
    },
  );
}

/** The windows the feed was asked for, in order - not the chart's month. */
const askedDays = () =>
  mockAuthRequest.mock.calls
    .filter(([url]) => url === FEED_URL)
    .map(
      ([, options]) => (options as { query: { days: FeedRange } }).query.days,
    );

const mounted: { unmount: () => void }[] = [];

async function mountPage(query: Record<string, string> = {}) {
  // Through `route`, not a `replace` beforehand: mountSuspended navigates to
  // its own `route` - "/" unless told otherwise - before it mounts.
  // apexcharts measures a real element on mount, which jsdom does not have.
  const wrapper = await mountSuspended(AktywnoscPage, {
    route: { path: "/", query },
    global: { stubs: { apexchart: true } },
  });
  mounted.push(wrapper);
  await vi.waitUntil(
    () =>
      askedDays().length > 0 &&
      inFlight === 0 &&
      (!widens || askedDays().includes(30)),
    { timeout: 2000 },
  );
  await flushPromises();
  return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mountPage>>;

const itemTexts = (wrapper: Wrapper) =>
  wrapper.findAll('[data-testid="feed-item"]').map((item) => item.text());

const button = (wrapper: Wrapper, label: string) =>
  wrapper.findAll("button").find((node) => node.text() === label)!;

/** The kind filters are chips in a group, which Vuetify draws as spans. */
const chip = (wrapper: Wrapper, label: string) =>
  wrapper.findAll(".v-chip").find((node) => node.text() === label)!;

beforeEach(() => {
  vi.clearAllMocks();
  inFlight = 0;
  widens = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  while (mounted.length) mounted.pop()!.unmount();
  // One Nuxt app serves the whole file: the previous test's feed would
  // otherwise be the next mount's first answer.
  clearNuxtData(["activity-feed", "activity-month-chart"]);
  vi.useRealTimers();
  await useRouter().replace({ query: {} });
});

describe("/aktywnosc", () => {
  it("lists the lines under their Warsaw day", async () => {
    serve({ 7: contributorFeed() });
    const wrapper = await mountPage();

    const headings = wrapper
      .findAll('[data-testid="activity-day"] h2')
      .map((heading) => heading.text());
    expect(headings).toEqual(["Dzisiaj", "Wczoraj", "Niedziela, 20 września"]);
    expect(itemTexts(wrapper)[0]).toContain("ocenił/a 1 osobę");
  });

  it("opens with the month's chart, linked to the full statistics", async () => {
    serve({ 7: contributorFeed() });
    const wrapper = await mountPage();

    const card = wrapper.find('[data-testid="activity-month-chart"]');
    await vi.waitUntil(() => card.text().includes("17"), { timeout: 2000 });
    expect(card.text()).toContain("od 2 osób");
    expect(card.find('a[href="/eksploruj/statystyki"]').exists()).toBe(true);
  });

  it("widens a quiet week to a month on its own", async () => {
    serve({ 7: contributorFeed() });
    await mountPage();

    expect(askedDays()).toEqual([7, 30]);
  });

  it("hides the lines of the other kinds", async () => {
    serve({ 7: contributorFeed() });
    const wrapper = await mountPage();

    await chip(wrapper, "Notatki").trigger("click");
    await vi.waitUntil(() => itemTexts(wrapper).length === 1, {
      timeout: 2000,
    });

    expect(itemTexts(wrapper)[0]).toContain("dodał/a 2 notatki");
    expect(useRouter().currentRoute.value.query.rodzaj).toBe("notatki");
  });

  it("shows only the reader's own lines on ?kto=ja", async () => {
    serve({ 7: contributorFeed() });
    const wrapper = await mountPage({ kto: "ja" });

    expect(itemTexts(wrapper)).toHaveLength(1);
    expect(itemTexts(wrapper)[0]).toContain("Ja Sam");
    expect(
      wrapper.get('[data-testid="activity-person-filter"]').text(),
    ).toContain("Tylko Twoje");
  });

  it("filters on a named person in the page, never in the url", async () => {
    serve({ 7: contributorFeed() });
    const wrapper = await mountPage();

    // The masked person has no button to press.
    const pickable = wrapper
      .findAll('[data-testid="feed-item-actor"]')
      .map((node) => node.text());
    expect(pickable.some((name) => name.includes("Anonim 1"))).toBe(false);

    const anna = wrapper
      .findAll('[data-testid="feed-item-actor"]')
      .find((node) => node.text().includes("Anna Nowak"))!;
    await anna.trigger("click");

    expect(itemTexts(wrapper)).toHaveLength(2);
    expect(
      itemTexts(wrapper).every((text) => text.includes("Anna Nowak")),
    ).toBe(true);
    expect(useRouter().currentRoute.value.query.kto).toBeUndefined();
  });

  it("lets a filter in the url win over a person picked in the page", async () => {
    // Back or Forward onto ?kto=ja after picking somebody: the pick used to
    // outrank the url, so the address said "mine" and the list said "Anna's".
    serve({ 7: contributorFeed() });
    const wrapper = await mountPage();

    const anna = wrapper
      .findAll('[data-testid="feed-item-actor"]')
      .find((node) => node.text().includes("Anna Nowak"))!;
    await anna.trigger("click");
    expect(
      wrapper.get('[data-testid="activity-person-filter"]').text(),
    ).toContain("Anna Nowak");

    await useRouter().push({ query: { kto: "ja" } });
    await vi.waitUntil(() => itemTexts(wrapper).length === 1, {
      timeout: 2000,
    });

    expect(itemTexts(wrapper)[0]).toContain("Ja Sam");
    expect(
      wrapper.get('[data-testid="activity-person-filter"]').text(),
    ).toContain("Tylko Twoje");
  });

  it("keeps a long name inside the chip that clears it", async () => {
    // An administrator's label can be a whole email address; untruncated it
    // pushed the close button off a 375px screen.
    const long = "katarzyna.brzeczyszczykiewicz@gmail.com";
    serve({
      7: {
        ...adminFeed(),
        actors: [
          ...adminFeed().actors,
          actor("uid-kat", { uid: "uid-kat", name: long }),
        ],
      },
    });
    const wrapper = await mountPage({ kto: "uid-kat" });

    const chip = wrapper.get('[data-testid="activity-person-filter"]');
    const label = chip.get(".text-truncate");
    expect(label.text()).toBe(`Tylko: ${long}`);
    expect(label.attributes("title")).toBe(`Tylko: ${long}`);
    expect(chip.classes()).toContain("activity__person");
  });

  it("does not tell a contributor who is on trial", async () => {
    serve({ 7: contributorFeed() });
    const wrapper = await mountPage({ kto: "nowi-admini" });

    expect(wrapper.find('[data-testid="activity-new-admins"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="activity-new-admin-list"]').exists(),
    ).toBe(false);
    // Not honoured, so nothing is filtered away either.
    expect(itemTexts(wrapper)).toHaveLength(4);
  });

  it("takes a filter it does not honour out of the url", async () => {
    // An administrator on trial following the link on /admin, or anybody
    // handed one: the list is unfiltered, so the url must not say otherwise.
    serve({ 7: contributorFeed() });
    await mountPage({ kto: "nowi-admini" });
    await vi.waitUntil(
      () => useRouter().currentRoute.value.query.kto === undefined,
      { timeout: 2000 },
    );

    await useRouter().push({ query: { kto: "uid-anna" } });
    await vi.waitUntil(
      () => useRouter().currentRoute.value.query.kto === undefined,
      { timeout: 2000 },
    );
  });

  it("keeps ?kto=ja, which it honours for everybody", async () => {
    serve({ 7: contributorFeed() });
    await mountPage({ kto: "ja" });

    expect(useRouter().currentRoute.value.query.kto).toBe("ja");
  });

  it("shows an administrator everybody on trial, idle ones included", async () => {
    serve({ 7: adminFeed() });
    const wrapper = await mountPage({ kto: "nowi-admini" });

    expect(wrapper.find('[data-testid="activity-new-admins"]').exists()).toBe(
      true,
    );
    const list = wrapper.get('[data-testid="activity-new-admin-list"]');
    expect(list.text()).toContain("Mikołaj");
    expect(list.text()).toContain("1 wpis");
    expect(list.text()).toContain("Kasia");
    expect(list.text()).toContain("brak aktywności w tym okresie");

    expect(itemTexts(wrapper)).toHaveLength(1);
    expect(itemTexts(wrapper)[0]).toContain("Mikołaj");
    expect(itemTexts(wrapper)[0]).toContain("okres próbny");
    // Still the administrator's filter: it is honoured, so it stays.
    expect(useRouter().currentRoute.value.query.kto).toBe("nowi-admini");
  });

  it("does not tell an administrator that somebody on trial agreed to be named", async () => {
    // Every name on the list is shown to an administrator whatever its owner
    // chose, so the chip has to explain it the way a feed line does.
    serve({ 7: adminFeed() });
    const wrapper = await mountPage({ kto: "nowi-admini" });

    const names = wrapper
      .get('[data-testid="activity-new-admin-list"]')
      .findAllComponents(ContributorName);
    expect(names).toHaveLength(2);
    expect(names.every((name) => name.props("identified") === true)).toBe(true);
  });

  it("toggles the trial filter from its chip", async () => {
    serve({ 7: adminFeed() });
    const wrapper = await mountPage();

    expect(itemTexts(wrapper)).toHaveLength(3);
    await wrapper.get('[data-testid="activity-new-admins"]').trigger("click");
    await vi.waitUntil(() => itemTexts(wrapper).length === 1, {
      timeout: 2000,
    });
    expect(useRouter().currentRoute.value.query.kto).toBe("nowi-admini");
  });

  it("says so when nobody is on trial", async () => {
    serve({ 7: adminFeed(), 30: { ...adminFeed(), newAdmins: [] } });
    const wrapper = await mountPage({ kto: "nowi-admini" });

    expect(wrapper.get('[data-testid="activity-new-admin-list"]').text()).toBe(
      "Nikt nie ma teraz statusu nowego administratora.",
    );
  });

  it("puts an administrator's pick of a person in the url, by uid", async () => {
    serve({ 7: adminFeed() });
    const wrapper = await mountPage();

    const anna = wrapper
      .findAll('[data-testid="feed-item-actor"]')
      .find((node) => node.text().includes("Anna Nowak"))!;
    await anna.trigger("click");

    await vi.waitUntil(
      () => useRouter().currentRoute.value.query.kto === "uid-anna",
      { timeout: 2000 },
    );
    expect(itemTexts(wrapper)).toHaveLength(1);
  });

  it("pages through a long week, then asks for the month", async () => {
    const long = contributorFeed();
    long.batches = Array.from({ length: 35 }, (_, index) =>
      batch("named-1", new Date(NOW.getTime() - index * 60_000).toISOString()),
    );
    serve({ 7: long });
    const wrapper = await mountPage();

    expect(itemTexts(wrapper)).toHaveLength(30);
    await button(wrapper, "Pokaż więcej").trigger("click");
    expect(itemTexts(wrapper)).toHaveLength(35);

    expect(askedDays()).toEqual([7]);
    await button(wrapper, "Pokaż starsze").trigger("click");
    await vi.waitUntil(() => askedDays().includes(30), { timeout: 2000 });
  });

  it("keeps the button, spinning, while the month it asked for loads", async () => {
    // It used to vanish on the click, and with the week still on screen
    // nothing said the click had done anything.
    const week = contributorFeed();
    week.batches = Array.from({ length: 35 }, (_, index) =>
      batch("named-1", new Date(NOW.getTime() - index * 60_000).toISOString()),
    );
    const month = {
      ...week,
      window: { ...week.window, days: 30 as const },
      batches: [
        ...week.batches,
        ...Array.from({ length: 5 }, (_, index) =>
          batch("named-1", `2026-09-0${index + 1}T10:00:00.000Z`),
        ),
      ],
    };
    let answerMonth: (value: ActivityFeed) => void = () => {};
    serve({
      7: week,
      30: () =>
        new Promise<ActivityFeed>((resolve) => {
          answerMonth = resolve;
        }),
    });
    const wrapper = await mountPage();
    await button(wrapper, "Pokaż więcej").trigger("click");

    await button(wrapper, "Pokaż starsze").trigger("click");
    await vi.waitUntil(() => askedDays().includes(30), { timeout: 2000 });
    await flushPromises();

    const more = wrapper.get('[data-testid="activity-more"]');
    expect(more.text()).toContain("Pokaż starsze");
    expect(more.classes()).toContain("v-btn--loading");

    answerMonth(month);
    await vi.waitUntil(() => itemTexts(wrapper).length === 40, {
      timeout: 2000,
    });
    // The month is the widest window, so there is nothing older to ask for.
    expect(wrapper.find('[data-testid="activity-more"]').exists()).toBe(false);
  });

  it("keeps the week when the month cannot be fetched, and asks again", async () => {
    // The month is its own, heavier scan: the week answering says nothing
    // about whether it will. A failure used to replace three lines that had
    // loaded fine with an error and no way to try again.
    const week = contributorFeed();
    week.batches = week.batches.slice(0, 3);
    let monthFails = true;
    serve({
      7: week,
      30: async () => {
        if (monthFails) throw new Error("504");
        return { ...contributorFeed(), window: { ...week.window, days: 30 } };
      },
    });
    const wrapper = await mountPage();

    expect(askedDays()).toEqual([7, 30]);
    expect(itemTexts(wrapper)).toHaveLength(3);
    expect(wrapper.text()).not.toContain("Nie udało się pobrać aktywności.");
    expect(
      wrapper.get('[data-testid="activity-widen-failed"]').text(),
    ).toContain("Nie udało się pobrać starszych wpisów.");

    monthFails = false;
    await button(wrapper, "Pokaż starsze").trigger("click");
    await vi.waitUntil(() => itemTexts(wrapper).length === 4, {
      timeout: 2000,
    });
    expect(askedDays()).toEqual([7, 30, 30]);
    expect(wrapper.find('[data-testid="activity-widen-failed"]').exists()).toBe(
      false,
    );
  });

  it("says when nothing happened, and when nothing matches", async () => {
    serve({ 7: feed() });
    const empty = await mountPage();
    await vi.waitUntil(
      () => empty.text().includes("W tym okresie nikt nic nie zrobił."),
      { timeout: 2000 },
    );
    empty.unmount();
    mounted.pop();
    clearNuxtData("activity-feed");

    serve({ 7: contributorFeed() });
    const filtered = await mountPage({ rodzaj: "decyzje", kto: "ja" });
    await vi.waitUntil(
      () => filtered.text().includes("Nic nie pasuje do wybranych filtrów."),
      { timeout: 2000 },
    );
  });

  it("says so when the feed cannot be fetched", async () => {
    mockAuthRequest.mockRejectedValue(new Error("boom"));
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("Nie udało się pobrać aktywności.");
  });
});
