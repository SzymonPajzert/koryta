import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ContributorTable from "../../../app/components/stats/ContributorTable.vue";
import type {
  ActivityContributor,
  ActivityRanking,
} from "../../../server/api/stats/activity.get";
import {
  emptyActivityCounts,
  type RankingName,
} from "../../../shared/activity";

const row = (
  overrides: Partial<ActivityContributor> = {},
): ActivityContributor => ({
  key: "rank-1",
  uid: null,
  name: "A•••••",
  named: false,
  isSelf: false,
  email: null,
  photoURL: null,
  counts: { ...emptyActivityCounts(), vote: 3 },
  total: 3,
  lastActiveAt: "2026-08-20T10:00:00.000Z",
  ...overrides,
});

/** Somebody on the scans' tab, which opens first. */
const reader = (overrides: Partial<ActivityContributor> = {}) =>
  row({
    name: "C•••••",
    counts: { ...emptyActivityCounts(), reading: 40 },
    total: 40,
    ...overrides,
  });

const ranking = (
  rows: ActivityContributor[],
  extra: Partial<ActivityRanking> = {},
): ActivityRanking => ({ count: rows.length, rows, self: null, ...extra });

/** Where the invitation's button goes.
 *
 * Read off the `to` prop rather than off an `href`: a `v-btn` resolves its
 * link through the router, and the one this suite mounts under has no routes
 * to resolve against, so it renders the anchor without an address. The prop is
 * what the app hands Vuetify either way. */
const callToActionTarget = (wrapper: {
  findAllComponents: (selector: { name: string }) => {
    props: (name: string) => unknown;
  }[];
}) =>
  wrapper
    .findAllComponents({ name: "VBtn" })
    .map((button) => button.props("to"))
    .find(Boolean);

const mountTable = (
  props: Record<string, unknown> = {},
  rankings: Partial<Record<RankingName, ActivityRanking>> = {},
) =>
  mountSuspended(ContributorTable, {
    props: {
      rankings: {
        changes: ranking([row()]),
        readings: ranking([reader()]),
        ...rankings,
      },
      identified: false,
      windowDays: 30,
      loading: false,
      ...props,
    },
  });

/** The other tab, the changes. */
const showChanges = async (wrapper: {
  get: (selector: string) => { trigger: (event: string) => Promise<void> };
}) => {
  await wrapper
    .get('[data-testid="contributors-tab-changes"]')
    .trigger("click");
};

describe("StatsContributorTable", () => {
  it("shows the ranking to a reader who is not an administrator", async () => {
    // It used to show them one sentence about how many people were active.
    const wrapper = await mountTable();

    expect(wrapper.text()).toContain("C•••••");
    expect(wrapper.find("table").exists()).toBe(true);
  });

  it("opens on the scans, ranked by their one count", async () => {
    const wrapper = await mountTable();

    const headers = wrapper.findAll("th").map((th) => th.text());
    expect(headers).toContain("Skany");
    // One kind has no mix to name and no columns to add up.
    expect(headers).not.toContain("Rozkład");
    expect(headers).not.toContain("Razem");
    expect(wrapper.text()).toContain("40");
    expect(wrapper.text()).not.toContain("A•••••");
  });

  it("shows the changes with their mix and a column per kind on the other tab", async () => {
    const wrapper = await mountTable();

    await showChanges(wrapper);

    const headers = wrapper.findAll("th").map((th) => th.text());
    expect(headers).toContain("Rozkład");
    expect(headers).toContain("Razem");
    expect(headers.some((text) => text.includes("Ocena"))).toBe(true);
    expect(headers.some((text) => text.includes("Odczyt"))).toBe(false);
    expect(wrapper.text()).toContain("A•••••");
  });

  it("counts the people of the tab it shows", async () => {
    const wrapper = await mountTable(
      {},
      {
        changes: ranking([row()], { count: 14 }),
        readings: ranking([reader()], { count: 46 }),
      },
    );

    expect(wrapper.text()).toContain("Ostatnie 30 dni · 46 osób przy pracy");
    await showChanges(wrapper);
    expect(wrapper.text()).toContain("Ostatnie 30 dni · 14 osób przy pracy");
  });

  it("never links a row it has no uid for", async () => {
    const wrapper = await mountTable();

    expect(wrapper.findAll('a[href*="/admin/rewizje"]')).toHaveLength(0);
  });

  it("links an admin's rows into the review queue", async () => {
    const wrapper = await mountTable(
      { identified: true },
      {
        changes: ranking([
          row({ uid: "anna-uid", name: "Anna Nowak", named: true }),
        ]),
      },
    );
    await showChanges(wrapper);

    // Straight to the queue's section of /admin/rewizje, with everything that
    // person ever proposed rather than only what is still waiting.
    expect(wrapper.get('a[href*="author=anna-uid"]').attributes("href")).toBe(
      "/admin/rewizje?author=anna-uid&status=all&automatic=all#kolejka",
    );
  });

  it("invites a signed-out reader to sign in", async () => {
    const wrapper = await mountTable({ signedIn: false });

    expect(wrapper.text()).toContain("Zaloguj się");
    expect(callToActionTarget(wrapper)).toBe("/login");
  });

  it("offers the setting to somebody whose name is still hidden", async () => {
    const wrapper = await mountTable({ signedIn: true, profilePublic: false });

    expect(wrapper.text()).toContain("Pokaż moją nazwę");
    expect(callToActionTarget(wrapper)).toBe("/profil");
  });

  it("offers the way back to somebody who already went public", async () => {
    const wrapper = await mountTable({ signedIn: true, profilePublic: true });

    expect(wrapper.text()).toContain("schować");
    expect(wrapper.text()).not.toContain("Pokaż moją nazwę");
  });

  it("says nothing about the setting to an administrator", async () => {
    // They see every name already, so it would be advice about a page they are
    // not on.
    const wrapper = await mountTable({ identified: true, signedIn: true });

    expect(wrapper.text()).not.toContain("Pokaż moją nazwę");
    expect(wrapper.text()).not.toContain("Zaloguj się");
  });

  it("holds the invitation back until the response has landed", async () => {
    // `identified` is false while the request is in flight, so an admin would
    // otherwise be told to sign in for a moment.
    const wrapper = await mountTable({ loading: true, signedIn: false });

    expect(wrapper.text()).not.toContain("Zaloguj się");
  });

  it("marks the reader's own row", async () => {
    const wrapper = await mountTable(
      { signedIn: true },
      {
        readings: ranking([
          reader({ name: "Bartosz Lis", named: true, isSelf: true }),
        ]),
      },
    );

    expect(wrapper.find(".contributors__row--self").exists()).toBe(true);
    expect(wrapper.text()).toContain("Ty");
  });

  it("tells a reader where they stand when their row is past the slice", async () => {
    const wrapper = await mountTable(
      { signedIn: true },
      {
        changes: ranking([row()], { count: 40, self: { rank: 31, total: 12 } }),
        readings: ranking([reader()], {
          count: 50,
          self: { rank: 33, total: 22 },
        }),
      },
    );

    expect(wrapper.text()).toContain("Twoje miejsce: 33 z 50, 22 skany");
    await showChanges(wrapper);
    expect(wrapper.text()).toContain("Twoje miejsce: 31 z 40, 12 zmian");
  });

  it("does not repeat the standing of a reader already in the table", async () => {
    const wrapper = await mountTable(
      { signedIn: true },
      {
        readings: ranking([reader({ isSelf: true })], {
          self: { rank: 1, total: 40 },
        }),
      },
    );

    expect(wrapper.text()).not.toContain("Twoje miejsce:");
  });

  it("says so when nobody did anything", async () => {
    const wrapper = await mountTable(
      {},
      { changes: ranking([]), readings: ranking([]) },
    );

    expect(wrapper.text()).toContain("nikt nic nie odczytał");
    await showChanges(wrapper);
    expect(wrapper.text()).toContain("nikt nie zmieniał danych");
  });
});
