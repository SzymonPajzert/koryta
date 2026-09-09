import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ServiceMilestoneCard from "../../../app/components/card/ServiceMilestone.vue";
import type { ServiceMilestone } from "../../../server/api/edges/serviceMilestones.get";

function milestone(fields: Partial<ServiceMilestone> = {}): ServiceMilestone {
  return {
    id: "anna:10",
    personId: "abc123",
    personName: "Anna Nowak",
    parties: [],
    years: 10,
    date: "2026-09-09",
    daysFromToday: 0,
    companyId: "orlen",
    companyName: "Orlen",
    role: "Prezes zarządu",
    alsoHeld: 0,
    institutions: 1,
    spells: 1,
    projected: true,
    ...fields,
  };
}

const mount = (fields: Partial<ServiceMilestone> = {}) =>
  mountSuspended(ServiceMilestoneCard, {
    props: { milestone: milestone(fields) },
  });

describe("CardServiceMilestone", () => {
  it("leads to the person's page, not the company's", async () => {
    const card = (await mount()).findComponent({ name: "VCard" });

    expect(card.props("to")).toBe("/osoba/anna-nowak-abc123");
  });

  it("names the person, the post held that day and the institution", async () => {
    const text = (await mount()).text();

    expect(text).toContain("Anna Nowak");
    expect(text).toContain("Prezes zarządu");
    expect(text).toContain("Orlen");
  });

  it("falls back to the relation's own name when no role was recorded", async () => {
    expect((await mount({ role: null })).text()).toContain("Zatrudniony/a w");
  });

  it("says the total in whole years and when it is reached", async () => {
    const text = (await mount()).text();

    expect(text).toContain("10 lat pracy");
    expect(text).toContain("9 września 2026");
    // The figure is a whole number of years by construction, so it can never
    // carry the decimal point /eksploruj/tabela had to be corrected for.
    expect(text).not.toContain(",");
  });

  it("declines the years the way Polish does", async () => {
    expect((await mount({ years: 1 })).text()).toContain("1 rok pracy");
    expect((await mount({ years: 2 })).text()).toContain("2 lata pracy");
    expect((await mount({ years: 21 })).text()).toContain("21 lat pracy");
  });

  it("says how many institutions the total is spread across", async () => {
    // The point of a total rather than a post anniversary, on a site about
    // people who collect posts.
    expect((await mount({ institutions: 4 })).text()).toContain(
      "w 4 instytucjach",
    );
    expect((await mount({ institutions: 1 })).text()).toContain(
      "w jednej instytucji",
    );
  });

  it("marks a career with a gap in it", async () => {
    // Only then is the date something other than the anniversary of the first
    // day worked, which is the one thing a reader might otherwise assume.
    expect((await mount({ spells: 3 })).text()).toContain("z 3 okresów");
    expect((await mount({ spells: 1 })).text()).not.toContain("okres");
  });

  it("counts the other posts held on the same day", async () => {
    expect((await mount({ alsoHeld: 2 })).text()).toContain(
      "i jeszcze 2 stanowiska",
    );
    expect((await mount({ alsoHeld: 1 })).text()).toContain(
      "i jeszcze 1 stanowisko",
    );
    expect((await mount({ alsoHeld: 0 })).text()).not.toContain("jeszcze");
  });

  it("keeps the institution name and that count in separate elements", async () => {
    // Inside one span the template collapsed the newline between them and the
    // card read „…(Kamienna Góra)i jeszcze 1 stanowisko”. Asserted on the DOM
    // rather than on `.text()`, which joins elements with no separator and so
    // reads „Orleni jeszcze…” either way.
    const wrapper = await mount({ companyName: "Orlen", alsoHeld: 1 });
    const spans = wrapper.find(".milestone-card__company").findAll("span");

    expect(spans.map((span) => span.text())).toEqual([
      "Orlen",
      "i jeszcze 1 stanowisko",
    ]);
  });

  it("writes the days either side of today as words", async () => {
    expect((await mount({ daysFromToday: 0 })).text()).toContain("dzisiaj");
    expect((await mount({ daysFromToday: 1 })).text()).toContain("jutro");
    expect((await mount({ daysFromToday: -1 })).text()).toContain("wczoraj");
  });

  it("counts the rest of them in the right direction", async () => {
    expect((await mount({ daysFromToday: 22 })).text()).toContain("za 22 dni");
    expect((await mount({ daysFromToday: -12 })).text()).toContain(
      "12 dni temu",
    );
  });

  it("dims the half of the feed that has already happened", async () => {
    expect(
      (await mount({ daysFromToday: -12 }))
        .find(".milestone-card--past")
        .exists(),
    ).toBe(true);
    // Today is not past: it is the one card on the page happening now.
    expect(
      (await mount({ daysFromToday: 0 }))
        .find(".milestone-card--past")
        .exists(),
    ).toBe(false);
  });

  it("shows the parties the person is filed under", async () => {
    expect((await mount({ parties: ["PiS"] })).text()).toContain("PiS");
  });
});
