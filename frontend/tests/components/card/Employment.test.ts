import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Employment from "../../../app/components/card/Employment.vue";
import type { RecentEmployment } from "../../../server/api/edges/recentEmployments.get";

function employment(fields: Partial<RecentEmployment> = {}): RecentEmployment {
  return {
    id: "e1",
    personId: "abc123",
    personName: "Anna Nowak",
    parties: [],
    companyId: "orlen",
    companyName: "Orlen",
    role: "Prezes zarządu",
    start_date: "2024-01-01",
    end_date: null,
    ...fields,
  };
}

const mount = (fields: Partial<RecentEmployment> = {}) =>
  mountSuspended(Employment, { props: { employment: employment(fields) } });

describe("CardEmployment", () => {
  it("leads to the person's page, not the company's", async () => {
    // The card is about a job, but a reader clicking it wants to know who this
    // is - the company is one hop on from there.
    const card = (await mount()).findComponent({ name: "VCard" });

    expect(card.props("to")).toBe("/osoba/anna-nowak-abc123");
  });

  it("keeps the diacritics out of the url and the id on the end", async () => {
    const card = (
      await mount({ personName: "Łukasz Wiśniewski", personId: "xyz789" })
    ).findComponent({ name: "VCard" });

    expect(card.props("to")).toBe("/osoba/lukasz-wisniewski-xyz789");
  });

  it("names the person, the role and the company", async () => {
    const text = (await mount()).text();

    expect(text).toContain("Anna Nowak");
    expect(text).toContain("Prezes zarządu");
    expect(text).toContain("Orlen");
  });

  it("falls back to the relation's own name when no role was recorded", async () => {
    expect((await mount({ role: null })).text()).toContain("Zatrudniony/a w");
  });

  it("reads a spell with no end as still running", async () => {
    expect((await mount()).text()).toContain("2024-01-01 - obecnie");
  });

  it("prints both ends of a spell that finished", async () => {
    expect((await mount({ end_date: "2025-06-30" })).text()).toContain(
      "2024-01-01 - 2025-06-30",
    );
  });

  it("prints one date for a spell that began and ended the same day", async () => {
    const text = (await mount({ end_date: "2024-01-01" })).text();

    expect(text).toContain("2024-01-01");
    expect(text).not.toContain("2024-01-01 - ");
  });

  it("says so when the institution is publicly owned", async () => {
    expect((await mount({ companyIsPublic: true })).text()).toContain(
      "Instytucja publiczna",
    );
  });

  it("stays quiet about an owner nobody has established", async () => {
    // Most rows of a feed would carry the chip, which is noise rather than
    // something the reader can act on.
    expect((await mount()).text()).not.toContain("Właściciel nieustalony");
  });

  it("carries the parties the person is filed under", async () => {
    const text = (await mount({ parties: ["PO", "PiS"] })).text();

    expect(text).toContain("PO");
    expect(text).toContain("PiS");
  });
});
