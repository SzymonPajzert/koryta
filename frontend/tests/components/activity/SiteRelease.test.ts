import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import SiteRelease from "../../../app/components/activity/SiteRelease.vue";
import type { SiteChange } from "../../../shared/activityFeed";

// 13:45 UTC is 15:45 in Warsaw in September.
const AT = "2026-09-25T13:45:39.000Z";

const change = (
  id: string,
  overrides: Partial<SiteChange> = {},
): SiteChange => ({
  id,
  at: AT,
  title: `Tabela ${id} robi coś nowego`,
  description: `Opis zmiany ${id}.`,
  link: "/eksploruj/tabela",
  area: "public",
  ...overrides,
});

const mountRelease = (changes: SiteChange[]) =>
  mountSuspended(SiteRelease, { props: { at: AT, changes } });

type Wrapper = Awaited<ReturnType<typeof mountRelease>>;

const titles = (wrapper: Wrapper) =>
  wrapper
    .findAll('[data-testid="activity-site-change"] .asr__title')
    .map((node) => node.text());

/** Where each link goes, read off the prop: see ContributorTable.test for why
 * an `href` is not to be trusted under the test router. */
const linkTargets = (wrapper: Wrapper) =>
  wrapper
    .findAllComponents({ name: "NuxtLink" })
    .map((link) => link.props("to") as string);

describe("ActivitySiteRelease", () => {
  it("says a new version went live, with how many changes and when", async () => {
    const wrapper = await mountRelease([change("a"), change("b"), change("c")]);

    expect(wrapper.text()).toContain("Nowa wersja strony");
    expect(wrapper.text()).toContain("3 zmiany");
    expect(wrapper.get("time").text()).toBe("15:45");
    expect(wrapper.get("time").attributes("datetime")).toBe(AT);
  });

  it("names five changes and asks before the rest", async () => {
    const wrapper = await mountRelease(
      ["a", "b", "c", "d", "e", "f", "g"].map((id) => change(id)),
    );

    expect(titles(wrapper)).toHaveLength(5);
    const more = wrapper.get('[data-testid="activity-release-more"]');
    expect(more.text()).toContain("i jeszcze 2");

    await more.trigger("click");

    expect(titles(wrapper)).toHaveLength(7);
    expect(wrapper.find('[data-testid="activity-release-more"]').exists()).toBe(
      false,
    );
  });

  it("opens a change to what it is, the page it is on and its entry on /qa", async () => {
    const wrapper = await mountRelease([change("a"), change("b")]);
    const toggle = wrapper.findAll(
      '[data-testid="activity-site-change-toggle"]',
    )[0]!;

    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.text()).not.toContain("Opis zmiany a.");
    expect(linkTargets(wrapper)).toEqual([]);

    await toggle.trigger("click");

    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(wrapper.text()).toContain("Opis zmiany a.");
    expect(linkTargets(wrapper)).toEqual(["/eksploruj/tabela", "/qa#qa-a"]);

    await toggle.trigger("click");

    expect(wrapper.text()).not.toContain("Opis zmiany a.");
  });

  it("has only the /qa link for a change that lives on no one page", async () => {
    const wrapper = await mountRelease([change("a", { link: undefined })]);

    await wrapper
      .get('[data-testid="activity-site-change-toggle"]')
      .trigger("click");

    expect(linkTargets(wrapper)).toEqual(["/qa#qa-a"]);
  });

  it("says where a change is when it is not on the public site", async () => {
    const wrapper = await mountRelease([
      change("publiczna"),
      change("zalogowani", { area: "contributor" }),
      change("panel", { area: "admin" }),
    ]);

    const rows = wrapper
      .findAll('[data-testid="activity-site-change"]')
      .map((node) => node.text());
    expect(rows[0]).not.toContain("dla zalogowanych");
    expect(rows[1]).toContain("dla zalogowanych");
    expect(rows[2]).toContain("panel admina");
  });
});
