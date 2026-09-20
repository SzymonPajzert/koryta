import { describe, it, expect } from "vitest";
import { queueTier } from "../../shared/queueTiers";
import type { Edge } from "../../shared/model";

const NOW = new Date("2026-09-20T00:00:00Z");
const PUBLIC = new Set(["public-place"]);

function edge(fields: Partial<Edge>): Edge {
  return {
    type: "employed",
    source: "person",
    target: "public-place",
    ...fields,
  } as Edge;
}

const wonIn = (year: string) =>
  edge({
    type: "election",
    target: "teryt1465",
    elected: true,
    start_date: `${year}-01-01`,
  });

const currentPost = edge({ target: "public-place" });

describe("queueTier", () => {
  it("files a person with both a biography and a register entry in tier 1", () => {
    expect(
      queueTier(
        { wikipedia: "https://pl.wikipedia.org/wiki/Jan", rejestrIo: "x" },
        [],
        PUBLIC,
        [],
        NOW,
      ),
    ).toBe(1);
  });

  it("wants both: a biography with no register entry is not tier 1", () => {
    // The task the tier describes is comparing the two - a date of birth in
    // the article against the register's. One of them alone is not a
    // comparison, and 780 people carry a Wikipedia link.
    expect(
      queueTier(
        { wikipedia: "https://pl.wikipedia.org/wiki/Jan" },
        [],
        PUBLIC,
        [],
        NOW,
      ),
    ).toBe(0);
  });

  it("takes the cheapest tier a person qualifies for", () => {
    // 219 of the tier-1 people also have facts and 100 also won recently.
    // Offering them three times would make the counts on /pomoc add up to
    // more people than exist.
    expect(
      queueTier(
        { wikipedia: "w", rejestrIo: "r" },
        [wonIn("2024"), currentPost],
        PUBLIC,
        ["party_membership"],
        NOW,
      ),
    ).toBe(1);
  });

  it("pairs a recent win with a recent public post for tier 2", () => {
    expect(queueTier({}, [wonIn("2024"), currentPost], PUBLIC, [], NOW)).toBe(
      2,
    );
  });

  it("does not count a win older than the window", () => {
    // The oświadczenie majątkowe is what the tier is for, and the filings of a
    // term that ended in 2014 are not online to compare against.
    expect(queueTier({}, [wonIn("2010"), currentPost], PUBLIC, [], NOW)).toBe(
      0,
    );
  });

  it("reads only a recorded win, never an absent or false one", () => {
    // PKW published no result for 68,728 of its 97,748 candidacy rows, and the
    // edit form stores `false` for every box a contributor left unticked - so
    // neither means the person lost.
    for (const elected of [false, undefined]) {
      expect(
        queueTier(
          {},
          [
            edge({
              type: "election",
              target: "teryt1465",
              elected,
              start_date: "2024-01-01",
            }),
            currentPost,
          ],
          PUBLIC,
          [],
          NOW,
        ),
      ).toBe(0);
    }
  });

  it("does not pair a recent win with a post that ended years ago", () => {
    expect(
      queueTier(
        {},
        [wonIn("2024"), edge({ end_date: "2009-04-01" })],
        PUBLIC,
        [],
        NOW,
      ),
    ).toBe(0);
  });

  it("counts an open-ended post however old its start", () => {
    // `end_date` is absent because nobody has left, which is the strongest
    // version of "current" the register offers.
    expect(
      queueTier(
        {},
        [wonIn("2024"), edge({ start_date: "1998-01-01" })],
        PUBLIC,
        [],
        NOW,
      ),
    ).toBe(2);
  });

  it("ignores a post at a company nobody has shown to be public", () => {
    expect(
      queueTier(
        {},
        [wonIn("2024"), edge({ target: "private" })],
        PUBLIC,
        [],
        NOW,
      ),
    ).toBe(0);
  });

  it("files a checkable fact on somebody with a public post in tier 3", () => {
    expect(
      queueTier({}, [currentPost], PUBLIC, ["party_membership"], NOW),
    ).toBe(3);
  });

  it("accepts a candidacy as the anchor, without a public post", () => {
    expect(
      queueTier(
        {},
        [edge({ type: "election", target: "teryt1465" })],
        PUBLIC,
        ["employment"],
        NOW,
      ),
    ).toBe(3);
  });

  it("leaves an unanchored fact out", () => {
    // The model pulls sentences about anybody a text names. A party
    // membership says nothing about somebody who holds no public post and
    // stood in no election.
    expect(
      queueTier(
        {},
        [edge({ target: "private" })],
        PUBLIC,
        ["party_membership"],
        NOW,
      ),
    ).toBe(0);
  });

  it("leaves a fact of a kind nobody can check out", () => {
    expect(queueTier({}, [currentPost], PUBLIC, ["something_else"], NOW)).toBe(
      0,
    );
  });
});
