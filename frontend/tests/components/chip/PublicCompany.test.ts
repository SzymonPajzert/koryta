import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import PublicCompany from "../../../app/components/chip/PublicCompany.vue";
import type { Company } from "../../../shared/model";

function company(fields: Partial<Company>): Company {
  return { type: "place", name: "Podmiot", ...fields } as Company;
}

async function labelOf(props: {
  company: Company | undefined;
  showUnknown?: boolean;
}) {
  return (await mountSuspended(PublicCompany, { props })).text();
}

describe("ChipPublicCompany", () => {
  it("calls a confirmed public owner what it is", async () => {
    expect(await labelOf({ company: company({ isPublic: true }) })).toContain(
      "Instytucja publiczna",
    );
  });

  it("calls an urząd an urząd, not a public company", async () => {
    const label = await labelOf({
      company: company({ name: "URZĄD MIASTA OPOLA", isPublic: true }),
    });
    expect(label).toContain("Urząd");
    expect(label).not.toContain("Instytucja publiczna");
  });

  it("says so for an urząd nobody flagged public as well", async () => {
    // One added by hand before the urząd choice existed, with no flag at all.
    expect(
      await labelOf({
        company: company({ name: "Starostwo Powiatowe w Wejherowie" }),
        showUnknown: true,
      }),
    ).toContain("Urząd");
  });

  it("never reads the scrapers' false as private", async () => {
    // KRS does not list the shareholders of a spółka akcyjna, so `false` is
    // what a company nobody could place looks like - Małopolska Agencja
    // Rozwoju Regionalnego among them.
    expect(
      await labelOf({
        company: company({ isPublic: false }),
        showUnknown: true,
      }),
    ).toContain("Właściciel nieustalony");
  });

  it("says the same when there is no flag at all", async () => {
    // Ministries and urzędy, which have no KRS entry to have been read.
    expect(
      await labelOf({ company: company({}), showUnknown: true }),
    ).toContain("Właściciel nieustalony");
  });

  it("keeps quiet about the unknown where it cannot be acted on", async () => {
    // Most rows of an employment list would carry it, which is noise.
    expect(await labelOf({ company: company({ isPublic: false }) })).toBe("");
  });

  it("states private once somebody has answered", async () => {
    expect(
      await labelOf({
        company: company({ isPublic: false, isPublicSource: "manual" }),
      }),
    ).toContain("Podmiot prywatny");
  });

  it("renders nothing when the edge does not lead to a company", async () => {
    expect(await labelOf({ company: undefined, showUnknown: true })).toBe("");
  });
});
