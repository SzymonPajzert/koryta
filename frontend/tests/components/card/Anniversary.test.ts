import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Anniversary from "../../../app/components/card/Anniversary.vue";
import type { WorkAnniversary } from "../../../server/api/edges/anniversaries.get";

function anniversary(fields: Partial<WorkAnniversary> = {}): WorkAnniversary {
  return {
    id: "e1",
    personId: "abc123",
    personName: "Anna Nowak",
    parties: [],
    companyId: "orlen",
    companyName: "Orlen",
    role: "Prezes zarządu",
    start_date: "2016-09-09",
    ongoing: true,
    date: "2026-09-09",
    years: 10,
    daysFromToday: 0,
    experienceYears: 12.4,
    ...fields,
  };
}

const mount = (fields: Partial<WorkAnniversary> = {}) =>
  mountSuspended(Anniversary, { props: { anniversary: anniversary(fields) } });

describe("CardAnniversary", () => {
  it("leads to the person's page, not the company's", async () => {
    const card = (await mount()).findComponent({ name: "VCard" });

    expect(card.props("to")).toBe("/osoba/anna-nowak-abc123");
  });

  it("names the person, the role and the institution", async () => {
    const text = (await mount()).text();

    expect(text).toContain("Anna Nowak");
    expect(text).toContain("Prezes zarządu");
    expect(text).toContain("Orlen");
  });

  it("falls back to the relation's own name when no role was recorded", async () => {
    expect((await mount({ role: null })).text()).toContain("Zatrudniony/a w");
  });

  it("says which anniversary it is and when it falls", async () => {
    const text = (await mount()).text();

    expect(text).toContain("10. rocznica");
    expect(text).toContain("9 września 2026");
  });

  it("keeps the two numbers apart", async () => {
    // „10. rocznica” is this one post; „łącznie 12 lat pracy” is every public
    // post the person has held. A card that printed one of them twice would be
    // making a claim about the wrong thing.
    const text = (await mount()).text();

    expect(text).toContain("10. rocznica");
    expect(text).toContain("łącznie 12 lat pracy");
  });

  it("rounds the career total to whole years", async () => {
    // „12.4 lat pracy” is a decimal point where Polish writes a comma and the
    // wrong noun form after a fraction - the same correction /eksploruj/tabela
    // already made.
    const text = (await mount({ experienceYears: 12.4 })).text();

    expect(text).not.toContain("12.4");
    expect(text).not.toContain("12,4");
  });

  it("says „poniżej roku” rather than „0 lat pracy”", async () => {
    expect((await mount({ experienceYears: 0.4 })).text()).toContain(
      "poniżej roku",
    );
  });

  it("leaves the total off entirely when the stats say nothing", async () => {
    expect((await mount({ experienceYears: 0 })).text()).not.toContain(
      "łącznie",
    );
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
    expect((await mount({ daysFromToday: 2 })).text()).toContain("za 2 dni");
  });

  it("dims the half of the feed that has already happened", async () => {
    const past = await mount({ daysFromToday: -12 });
    const soon = await mount({ daysFromToday: 12 });

    expect(past.find(".anniversary-card--past").exists()).toBe(true);
    // Today is not past: it is the one card on the page happening now, and it
    // keeps the accent.
    expect(soon.find(".anniversary-card--past").exists()).toBe(false);
    expect(
      (await mount({ daysFromToday: 0 }))
        .find(".anniversary-card--past")
        .exists(),
    ).toBe(false);
  });

  it("shows the parties the person is filed under", async () => {
    const text = (await mount({ parties: ["PiS"] })).text();

    expect(text).toContain("PiS");
  });
});
