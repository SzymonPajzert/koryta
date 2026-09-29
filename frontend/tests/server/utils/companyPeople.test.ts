import { describe, it, expect } from "vitest";
import {
  countCompanyPeople,
  type EmploymentEdgeRow,
} from "../../../server/utils/companyPeople";

/** A published post, which is what the handler's query returns. */
const post = (
  source: string,
  target: string,
  extra: Partial<EmploymentEdgeRow> = {},
): EmploymentEdgeRow => ({ source, target, published: true, ...extra });

describe("countCompanyPeople", () => {
  it("counts a person once however many posts they held there", () => {
    // Two terms on the same board, and a seat on the board of another: one
    // person at each institution, not two at the first.
    const counts = countCompanyPeople(
      [
        post("anna", "pkp", {
          start_date: "2016-01-01",
          end_date: "2019-12-31",
        }),
        post("anna", "pkp", { start_date: "2021-03-01" }),
        post("anna", "plk", { start_date: "2020-05-01" }),
      ],
      new Set(["anna"]),
    );

    expect(counts).toEqual({
      pkp: { people: 1, current: 1, latestStart: "2021-03-01" },
      plk: { people: 1, current: 1, latestStart: "2020-05-01" },
    });
  });

  it("leaves out anybody whose page is not published", () => {
    // Four of the 3,586 published employments on the 2026-09-29 export hang off
    // a draft person. A count that included them would say in public that the
    // site holds somebody no editor has checked.
    const counts = countCompanyPeople(
      [post("anna", "pkp"), post("draft", "pkp")],
      new Set(["anna"]),
    );

    expect(counts.pkp?.people).toBe(1);
  });

  it("leaves out a post that is unpublished or removed", () => {
    const counts = countCompanyPeople(
      [
        post("anna", "pkp"),
        post("bartek", "pkp", { published: false }),
        // `/api/edges/delete` keeps the document and marks it.
        post("celina", "pkp", { deleted: true }),
      ],
      new Set(["anna", "bartek", "celina"]),
    );

    expect(counts.pkp).toEqual({ people: 1, current: 1 });
  });

  it("counts somebody as there now only while a post of theirs is open", () => {
    const counts = countCompanyPeople(
      [
        post("anna", "pkp", { end_date: "2001-01-01" }),
        post("bartek", "pkp"),
        // An end still ahead is a post held today - the rule the people
        // table's „Teraz w publicznej spółce” filter is computed by.
        post("celina", "pkp", { end_date: "2999-12-31" }),
        post("dawid", "pkp", { end_date: null }),
      ],
      new Set(["anna", "bartek", "celina", "dawid"]),
    );

    expect(counts.pkp).toMatchObject({ people: 4, current: 3 });
  });

  it("dates the newest post by its start, as a day", () => {
    const counts = countCompanyPeople(
      [
        post("anna", "pkp", { start_date: "2019-03-01" }),
        post("bartek", "pkp", { start_date: "2024-04-12T00:00:00.000Z" }),
        // Not a day, so not a date the column could print or compare.
        post("celina", "pkp", { start_date: "2025" }),
      ],
      new Set(["anna", "bartek", "celina"]),
    );

    expect(counts.pkp?.latestStart).toBe("2024-04-12");
  });

  it("says nothing about the date where no post carries one", () => {
    // 156 published employments have no start date. They are people who
    // worked there all the same, so they count; they just date nothing.
    const counts = countCompanyPeople([post("anna", "pkp")], new Set(["anna"]));

    expect(counts.pkp).toEqual({ people: 1, current: 1 });
    expect("latestStart" in counts.pkp!).toBe(false);
  });

  it("lists only the institutions somebody is counted at", () => {
    // Zero is what the page reads for an absent entry, and most of the ~5,100
    // institutions would be one - so they are not sent.
    const counts = countCompanyPeople(
      [post("draft", "pkp"), post("anna", "")],
      new Set(["anna"]),
    );

    expect(counts).toEqual({});
  });
});
