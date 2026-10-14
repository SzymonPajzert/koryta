import { describe, it, expect } from "vitest";
import {
  buildPersonTeaser,
  mostRecentPost,
  type TeaserCompany,
  type TeaserEdge,
} from "../../shared/personTeaser";

const TODAY = Date.parse("2026-10-14T00:00:00Z");

const post = (id: string, fields: Partial<TeaserEdge> = {}): TeaserEdge => ({
  id,
  source: "p1",
  target: "c1",
  ...fields,
});

const company = (fields: Partial<TeaserCompany> = {}): TeaserCompany => ({
  type: "place",
  name: "ENERGA SPÓŁKA AKCYJNA",
  published: true,
  ...fields,
});

describe("mostRecentPost", () => {
  it("prefers a post still held over one that ended later", () => {
    // Held since 2015 says more about somebody today than a seat they left
    // last month.
    const held = post("held", { start_date: "2015-03-01" });
    const ended = post("ended", {
      start_date: "2024-01-01",
      end_date: "2026-09-30",
    });
    expect(mostRecentPost([ended, held], TODAY)).toBe(held);
  });

  it("takes the latest start among the posts still held", () => {
    const older = post("older", { start_date: "2019-05-01" });
    const newer = post("newer", { start_date: "2023-02-01" });
    expect(mostRecentPost([older, newer], TODAY)).toBe(newer);
  });

  it("puts an undated post after every dated one still held", () => {
    // Nothing says a post with no start is recent.
    const undated = post("undated", { name: "Prezes Zarządu" });
    const dated = post("dated", { start_date: "2010-01-01" });
    expect(mostRecentPost([undated, dated], TODAY)).toBe(dated);
  });

  it("takes the latest end among posts that all ended", () => {
    const left2019 = post("a", {
      start_date: "2016-01-01",
      end_date: "2019-12-31",
    });
    const left2022 = post("b", {
      start_date: "2012-01-01",
      end_date: "2022-06-30",
    });
    expect(mostRecentPost([left2019, left2022], TODAY)).toBe(left2022);
  });

  it("counts a post whose end is still ahead as held", () => {
    const ending = post("ending", {
      start_date: "2024-01-01",
      end_date: "2027-01-01",
    });
    const held = post("held", { start_date: "2020-01-01" });
    expect(mostRecentPost([held, ending], TODAY)).toBe(ending);
  });

  it("breaks a tie towards the post with a role, then by id", () => {
    const roleless = post("a", { start_date: "2023-02-01" });
    const named = post("b", { start_date: "2023-02-01", name: "Prokurent" });
    expect(mostRecentPost([roleless, named], TODAY)).toBe(named);
    expect(
      mostRecentPost(
        [
          post("z", { start_date: "2023-02-01" }),
          post("y", { start_date: "2023-02-01" }),
        ],
        TODAY,
      )?.id,
    ).toBe("y");
  });

  it("answers nothing for no posts", () => {
    expect(mostRecentPost([], TODAY)).toBeUndefined();
  });
});

describe("buildPersonTeaser", () => {
  const person = { id: "p1", name: "Jan Kowalski" };

  it("names the most recent post, its company and its dates", () => {
    const teaser = buildPersonTeaser(
      person,
      [
        post("old", {
          target: "c1",
          name: "Członek Zarządu",
          start_date: "2016-01-01",
          end_date: "2019-01-01",
        }),
        post("new", {
          target: "c2",
          name: "Prezes Zarządu",
          start_date: "2023-02-01",
        }),
      ],
      new Map([
        ["c1", company({ name: "MPWiK" })],
        ["c2", company({ name: "ENERGA", published: false })],
      ]),
      TODAY,
    );

    expect(teaser).toEqual({
      id: "p1",
      name: "Jan Kowalski",
      employment: {
        role: "Prezes Zarządu",
        companyId: "c2",
        companyName: "ENERGA",
        companyPublished: false,
        start: "2023-02-01",
      },
      employmentCount: 2,
    });
  });

  it("carries nothing an edge or a company holds beyond what it names", () => {
    // The edge documents arrive whole, and a hand-made employment can carry a
    // stray `party`. Nothing about a party may reach a logged out reader.
    const teaser = buildPersonTeaser(
      person,
      [
        {
          ...post("e", { start_date: "2023-02-01", name: "Prezes Zarządu" }),
          party: "PiS",
          committee: "KW PiS",
          references: ["a1"],
        } as TeaserEdge,
      ],
      new Map([["c1", { ...company(), parties: ["PO"] } as TeaserCompany]]),
      TODAY,
    );

    expect(JSON.stringify(teaser)).not.toMatch(/PiS|PO"|party|committee|a1/);
    expect(Object.keys(teaser).sort()).toEqual([
      "employment",
      "employmentCount",
      "id",
      "name",
    ]);
    expect(Object.keys(teaser.employment!).sort()).toEqual([
      "companyId",
      "companyName",
      "companyPublished",
      "role",
      "start",
    ]);
  });

  it("leaves out a removed post and one whose company is gone", () => {
    const teaser = buildPersonTeaser(
      person,
      [
        post("removed", { start_date: "2025-01-01", deleted: true }),
        post("merged", { target: "gone", start_date: "2024-01-01" }),
        post("missing", { target: "nowhere", start_date: "2024-06-01" }),
        post("region", { target: "r1", start_date: "2024-09-01" }),
        post("kept", { start_date: "2010-01-01" }),
      ],
      new Map([
        ["c1", company()],
        ["gone", company({ deleted: true })],
        ["r1", company({ type: "region", name: "Gmina" })],
      ]),
      TODAY,
    );

    expect(teaser.employment?.start).toBe("2010-01-01");
    expect(teaser.employmentCount).toBe(1);
  });

  it("counts the posts as the page lists them", () => {
    // One prokura at PZO Gliwice stored twice, once without its role: the
    // page lists it once, and the sign-in button must not promise two.
    const teaser = buildPersonTeaser(
      person,
      [
        post("roleless", { start_date: "2026-07-14" }),
        post("prokura", { start_date: "2026-07-14", name: "Prokurent" }),
      ],
      new Map([["c1", company()]]),
      TODAY,
    );

    expect(teaser.employmentCount).toBe(1);
    expect(teaser.employment?.role).toBe("Prokurent");
  });

  it("names a supervisory seat by the organ the institution has", () => {
    // A hospital's board is a rada społeczna, whatever the edge was called.
    const teaser = buildPersonTeaser(
      person,
      [post("seat", { name: "Rada Nadzorcza", start_date: "2024-01-01" })],
      new Map([["c1", company({ supervisoryBody: "rada-spoleczna" })]]),
      TODAY,
    );

    expect(teaser.employment?.role).toBe("Rada Społeczna");
  });

  it("says nothing about employment when there is none", () => {
    expect(buildPersonTeaser(person, [], new Map(), TODAY)).toEqual({
      id: "p1",
      name: "Jan Kowalski",
      employmentCount: 0,
    });
  });
});
