import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import PostepPage from "../../app/pages/oswiadczenia/postep.vue";
import type { DeclarationPeople } from "../../shared/declarations";
import { SEEDED_DECLARATION_PEOPLE as seeded } from "../../scripts/declarationPeople";

// Vuetify's tooltips behind the (i) and on the bar observe their activators.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

let answer: { people: DeclarationPeople | null };
registerEndpoint("/api/declarations/people", () => answer);

beforeEach(() => {
  answer = { people: seeded as DeclarationPeople };
  // useFetch keeps the answer under its key between mounts.
  clearNuxtData("declarations-people");
});

const mount = () =>
  mountSuspended(PostepPage, {
    global: { stubs: { StatsDailyColumns: true } },
  });

describe("/oswiadczenia/postep", () => {
  it("leads with the people published out of everybody but the namesakes", async () => {
    const page = await mount();
    expect(page.get(".op-figure").text()).toBe("300");
    expect(page.text()).toContain("opublikowanych z 1150 samorządowców");
    expect(page.text()).toContain("Stan na 14 listopada 2026.");
  });

  it("lists what is under way, the reading with a way to help", async () => {
    const page = await mount();
    const section = page.get('[aria-labelledby="op-underway"]');
    expect(section.text()).toContain("740");
    expect(section.text()).toContain("czeka na czytelników");
    expect(section.find('a[href="/oswiadczenia"]').exists()).toBe(true);
  });

  it("sorts the people without a declaration into three plain groups", async () => {
    const page = await mount();
    const rows = page
      .get('[aria-labelledby="op-searching"]')
      .findAll(".op-row")
      .map((row) => row.find(".op-row__count").text());
    // Unreachable 40 + refused 10; not listed 35; no date line 20 + other page 5.
    expect(rows).toEqual(["50", "35", "25"]);
  });

  it("estimates the namesakes among the people nobody has read yet", async () => {
    const page = await mount();
    const expect_ = page.get(".op-expect").text();
    // Reading 90 + cropped 450 + downloaded 130 + searching 110.
    expect(expect_).toContain("780");
    expect(expect_).toContain("120");
    expect(expect_).toContain("od 100 do 140");
  });

  it("says when there is nothing to show yet", async () => {
    answer = { people: null };
    const page = await mount();
    expect(
      page.find('[data-testid="declarations-people-empty"]').exists(),
    ).toBe(true);
    expect(page.find(".op-hero").exists()).toBe(false);
  });

  it("leaves out a section with nobody in it", async () => {
    answer = {
      people: {
        ...(seeded as DeclarationPeople),
        bySurname: [],
        expectedNamesakes: null,
      },
    };
    const page = await mount();
    expect(page.find('[aria-labelledby="op-namesakes"]').exists()).toBe(false);
  });
});
