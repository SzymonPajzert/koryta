import { describe, it, expect } from "vitest";
import {
  checkEdge,
  checkPage,
  entryOf,
  movedCopy,
  newPerson,
  planSchema,
  type PageStep,
} from "../../scripts/migrate/remove-namesake-jobs";

const link = (entry: string) => `https://rejestr.io/osoby/${entry}`;

function step(overrides: Partial<PageStep> = {}): PageStep {
  return {
    page: "page1",
    expect_link: link("88058"),
    remove: [],
    move: [],
    new_pages: [],
    ...overrides,
  };
}

const person = (rejestrIo?: string) => ({
  type: "person",
  name: "Andrzej Kleszcz",
  ...(rejestrIo ? { rejestrIo } : {}),
});

describe("planSchema", () => {
  it("reads a page with nothing to move", () => {
    const plan = planSchema.parse({
      pages: [
        {
          page: "p",
          expect_link: null,
          remove: [
            { edge: "e", target: "c", entry: "264574", reason: "Inna osoba" },
          ],
        },
      ],
    });
    expect(plan.pages[0]!.move).toEqual([]);
  });

  it("refuses a removal without its reason", () => {
    // The reason is the only record of why a job left the page; a blank one
    // would be a removal nobody can explain later.
    expect(() =>
      planSchema.parse({
        pages: [
          {
            page: "p",
            expect_link: null,
            remove: [{ edge: "e", target: "c", entry: "1", reason: "  " }],
          },
        ],
      }),
    ).toThrow();
  });
});

describe("planSchema's moves", () => {
  const job = {
    edge: "e",
    target: "c",
    entry: "206303",
    reason: "Przeniesione",
  };

  it("takes a move to the entry's page", () => {
    expect(() =>
      planSchema.parse({
        pages: [{ page: "p", expect_link: null, move: [{ ...job, to: "p2" }] }],
      }),
    ).not.toThrow();
  });

  it("takes a move to a page it makes for the entry", () => {
    expect(() =>
      planSchema.parse({
        pages: [
          {
            page: "p",
            expect_link: null,
            move: [job],
            new_pages: [{ entry: "206303", name: "Małgorzata Zielińska" }],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("refuses a move with nowhere to go", () => {
    expect(() =>
      planSchema.parse({
        pages: [{ page: "p", expect_link: null, move: [job] }],
      }),
    ).toThrow();
  });
});

describe("newPerson", () => {
  it("is the person a split makes: name, link and date, no parties", () => {
    // The night fills in the rest from the entry's own row once the export
    // shows a page linking it.
    expect(
      newPerson({
        entry: "206303",
        name: "Małgorzata Zielińska",
        birthDate: "1959-08-04",
      }),
    ).toEqual({
      type: "person",
      name: "Małgorzata Zielińska",
      parties: [],
      rejestrIo: "https://rejestr.io/osoby/206303",
      birthDate: "1959-08-04",
    });
  });

  it("leaves out a birth date it does not know", () => {
    expect(newPerson({ entry: "1", name: "X Y" })).not.toHaveProperty(
      "birthDate",
    );
  });
});

describe("entryOf", () => {
  it("compares links by their number, as the ingest does", () => {
    expect(entryOf(link("88058"))).toBe("88058");
    expect(entryOf("https://rejestr.io/osoby/88058/andrzej-kleszcz")).toBe(
      "88058",
    );
  });

  it("says nothing for no link", () => {
    expect(entryOf(undefined)).toBeUndefined();
    expect(entryOf("")).toBeUndefined();
  });
});

describe("checkPage", () => {
  it("goes ahead on the page the review saw", () => {
    expect(checkPage(person(link("88058")), step())).toEqual({
      ok: true,
      linkToWrite: undefined,
    });
  });

  it("writes the reviewed link", () => {
    expect(
      checkPage(person(link("88058")), step({ set_link: link("416593") })),
    ).toEqual({ ok: true, linkToWrite: link("416593") });
  });

  it("does not write a link the page already carries", () => {
    // A second run, or the same fix made by hand in between.
    expect(
      checkPage(person(link("416593")), step({ set_link: link("416593") })),
    ).toEqual({ ok: true, linkToWrite: undefined });
  });

  it("gives a page with no link the one it was reviewed for", () => {
    expect(
      checkPage(
        person(),
        step({ expect_link: null, set_link: link("2150198") }),
      ),
    ).toEqual({ ok: true, linkToWrite: link("2150198") });
  });

  it("refuses a page whose link changed since the review", () => {
    // Somebody - a night, an admin - has decided whose page it is since, so
    // the list of whose jobs to take off is not about this page any more.
    const verdict = checkPage(person(link("1")), step());
    expect(verdict.ok).toBe(false);
  });

  it("refuses a page an unlinked review now finds linked", () => {
    expect(
      checkPage(person(link("264574")), step({ expect_link: null })).ok,
    ).toBe(false);
  });

  it("refuses a page merged or removed since", () => {
    expect(
      checkPage({ ...person(link("88058")), merged_into: "other" }, step()).ok,
    ).toBe(false);
    expect(
      checkPage({ ...person(link("88058")), deleted: true }, step()).ok,
    ).toBe(false);
    expect(checkPage(undefined, step()).ok).toBe(false);
  });
});

describe("checkEdge", () => {
  const job = {
    type: "employed",
    source: "page1",
    target: "company1",
    name: "Rada Nadzorcza",
    start_date: "2017-11-10",
  };
  const upload = [{ update_automatic: true, update_user: "uploader" }];

  it("takes a job an upload wrote", () => {
    expect(checkEdge(job, "page1", "company1", upload)).toEqual({ act: true });
  });

  it("counts a job already removed as done, not as a failure", () => {
    expect(
      checkEdge({ ...job, deleted: true }, "page1", "company1", upload),
    ).toMatchObject({ act: false, done: true });
  });

  it("leaves a job somebody wrote or edited by hand", () => {
    // A reviewer's own edit is a judgement this list cannot outrank.
    expect(
      checkEdge(job, "page1", "company1", [
        ...upload,
        { update_automatic: false, update_user: "of0BKlwq" },
      ]),
    ).toMatchObject({ act: false, done: false });
  });

  it("does not count its own earlier writes as a person's", () => {
    expect(
      checkEdge(job, "page1", "company1", [
        ...upload,
        {
          update_automatic: false,
          update_user: "migration:remove-namesake-jobs",
        },
      ]),
    ).toEqual({ act: true });
  });

  it("leaves a job that moved to another page or company", () => {
    expect(checkEdge(job, "page2", "company1", upload).act).toBe(false);
    expect(checkEdge(job, "page1", "company2", upload).act).toBe(false);
  });

  it("only takes jobs", () => {
    expect(
      checkEdge({ ...job, type: "election" }, "page1", "company1", upload).act,
    ).toBe(false);
  });

  it("reports a relation that is gone", () => {
    expect(checkEdge(undefined, "page1", "company1", upload)).toMatchObject({
      act: false,
      done: false,
    });
  });
});

describe("movedCopy", () => {
  it("keeps what the job says and gives it the other page", () => {
    expect(
      movedCopy(
        {
          type: "employed",
          source: "page1",
          target: "company1",
          name: "Zarząd",
          start_date: "2015-11-24",
          end_date: "2016-12-16",
          published: true,
          revision_id: "r1",
          stats: { a: 1 },
        },
        "page2",
      ),
    ).toEqual({
      type: "employed",
      source: "page2",
      target: "company1",
      name: "Zarząd",
      start_date: "2015-11-24",
      end_date: "2016-12-16",
    });
  });
});
