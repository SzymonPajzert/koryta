import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ContributorTable from "../../../app/components/stats/ContributorTable.vue";
import type { ActivityContributor } from "../../../server/api/stats/activity.get";
import { emptyActivityCounts } from "../../../shared/activity";

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

const mountTable = (props: Record<string, unknown> = {}) =>
  mountSuspended(ContributorTable, {
    props: {
      contributors: [row()],
      identified: false,
      contributorCount: 1,
      windowDays: 30,
      loading: false,
      ...props,
    },
  });

describe("StatsContributorTable", () => {
  it("shows the ranking to a reader who is not an administrator", async () => {
    // It used to show them one sentence about how many people were active.
    const wrapper = await mountTable();

    expect(wrapper.text()).toContain("A•••••");
    expect(wrapper.find("table").exists()).toBe(true);
  });

  it("never links a row it has no uid for", async () => {
    const wrapper = await mountTable();

    expect(wrapper.findAll('a[href*="/admin/rewizje"]')).toHaveLength(0);
  });

  it("links an admin's rows into the review queue", async () => {
    const wrapper = await mountTable({
      identified: true,
      contributors: [row({ uid: "anna-uid", name: "Anna Nowak", named: true })],
    });

    expect(wrapper.find('a[href*="author=anna-uid"]').exists()).toBe(true);
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
    const wrapper = await mountTable({
      signedIn: true,
      contributors: [row({ name: "Bartosz Lis", named: true, isSelf: true })],
    });

    expect(wrapper.find(".contributors__row--self").exists()).toBe(true);
    expect(wrapper.text()).toContain("Ty");
  });

  it("tells a reader where they stand when their row is past the slice", async () => {
    const wrapper = await mountTable({
      signedIn: true,
      contributorCount: 40,
      self: { rank: 31, total: 12 },
    });

    expect(wrapper.text()).toContain("Twoje miejsce:");
    expect(wrapper.text()).toContain("31");
    expect(wrapper.text()).toContain("12 działań");
  });

  it("does not repeat the standing of a reader already in the table", async () => {
    const wrapper = await mountTable({
      signedIn: true,
      contributors: [row({ isSelf: true })],
      self: { rank: 1, total: 3 },
    });

    expect(wrapper.text()).not.toContain("Twoje miejsce:");
  });

  it("says so when nobody did anything", async () => {
    const wrapper = await mountTable({
      contributors: [],
      contributorCount: 0,
    });

    expect(wrapper.text()).toContain("nikt nie zmieniał danych");
  });
});
