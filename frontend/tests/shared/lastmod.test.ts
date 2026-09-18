import { describe, it, expect } from "vitest";
import { pagesChangedByEdgeWrite, sitemapLastmod } from "../../shared/lastmod";

const NOW = new Date("2026-09-18T12:00:00.000Z");

describe("sitemapLastmod", () => {
  it("has nothing to say about a page nothing has ever stamped", () => {
    // The module drops the element and keeps the url, which is what the spec
    // asks for where the date is not known - better than inventing one.
    expect(sitemapLastmod({}, NOW)).toBeUndefined();
    expect(sitemapLastmod({ revisions: null }, NOW)).toBeUndefined();
  });

  it("falls back to the newest revision, which every page has", () => {
    // The whole of day one rests on this: no backfill runs, and 6,795 of the
    // 6,802 urls are dated by `latest_time` alone.
    expect(
      sitemapLastmod(
        {
          revisions: {
            latest_id: "r1",
            latest_time: "2026-03-26T08:30:00.000Z",
            total: 3,
            has_unapproved: false,
          },
        },
        NOW,
      ),
    ).toBe("2026-03-26T08:30:00.000Z");
  });

  it("takes the newer of the stamp and the revision, whichever it is", () => {
    const revisions = {
      latest_id: "r1",
      latest_time: "2026-03-26T08:30:00.000Z",
      total: 3,
      has_unapproved: false,
    };

    expect(
      sitemapLastmod(
        { content_changed_at: "2026-09-17T09:00:00.000Z", revisions },
        NOW,
      ),
    ).toBe("2026-09-17T09:00:00.000Z");

    // An edit after the last publication decision wins just as readily.
    expect(
      sitemapLastmod(
        {
          content_changed_at: "2026-01-02T00:00:00.000Z",
          revisions: { ...revisions, latest_time: "2026-05-05T00:00:00.000Z" },
        },
        NOW,
      ),
    ).toBe("2026-05-05T00:00:00.000Z");
  });

  it("will not date a page by a revision nobody has approved", () => {
    // `computeRevisionsObj` takes the newest revision whatever its status, so
    // an unreviewed proposal moves `latest_time` while the public page still
    // says what it said before. Dating the page by it would be the exact lie
    // that costs a site Google's trust in the field.
    expect(
      sitemapLastmod(
        {
          revisions: {
            latest_id: "r9",
            latest_time: "2026-09-17T09:00:00.000Z",
            total: 4,
            has_unapproved: true,
          },
        },
        NOW,
      ),
    ).toBeUndefined();

    // ...but a real change to the page still dates it.
    expect(
      sitemapLastmod(
        {
          content_changed_at: "2026-08-01T00:00:00.000Z",
          revisions: {
            latest_id: "r9",
            latest_time: "2026-09-17T09:00:00.000Z",
            total: 4,
            has_unapproved: true,
          },
        },
        NOW,
      ),
    ).toBe("2026-08-01T00:00:00.000Z");
  });

  it("reads a timestamp in any of the three shapes it arrives in", () => {
    // `revisions.latest_time` is a string on every row measured, but the
    // normaliser is shared with paths where it is not, and a `{_seconds}` husk
    // is what a Timestamp becomes after the cached handler's JSON round trip.
    expect(
      sitemapLastmod(
        {
          revisions: {
            latest_id: "r1",
            latest_time: {
              _seconds: Math.floor(
                new Date("2026-07-01T10:00:00.000Z").getTime() / 1000,
              ),
            } as unknown as string,
            total: 1,
            has_unapproved: false,
          },
        },
        NOW,
      ),
    ).toBe("2026-07-01T10:00:00.000Z");
  });

  it("ignores a value that is not a date at all", () => {
    expect(
      sitemapLastmod({ content_changed_at: "wczoraj" }, NOW),
    ).toBeUndefined();
    expect(sitemapLastmod({ content_changed_at: "" }, NOW)).toBeUndefined();
  });

  it("clamps a stamp from a clock a little ahead, and drops a wild one", () => {
    // A `lastmod` in the future is the one value the spec calls invalid and
    // Google discards, so within the skew allowance the answer is "just now".
    expect(
      sitemapLastmod({ content_changed_at: "2026-09-18T12:00:30.000Z" }, NOW),
    ).toBe("2026-09-18T12:00:00.000Z");

    // Past it, the write is wrong rather than early, and saying nothing beats
    // claiming a freshness the page has not earned.
    expect(
      sitemapLastmod({ content_changed_at: "2027-09-18T12:00:00.000Z" }, NOW),
    ).toBeUndefined();
  });

  it("emits something @nuxtjs/sitemap will accept as a W3C date", () => {
    // The module validates against a W3C regex and silently drops what fails
    // it, so a url would lose its date with nothing in the logs to say so.
    const W3C =
      /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+Z$|^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\dZ$/;
    expect(
      sitemapLastmod({ content_changed_at: "2026-09-17T09:00:00.000Z" }, NOW),
    ).toMatch(W3C);
  });
});

describe("pagesChangedByEdgeWrite", () => {
  const employment = (overrides: Record<string, unknown> = {}) => ({
    type: "employment",
    source: "person-1",
    target: "company-1",
    ...overrides,
  });

  it("names both ends when a relation is published", () => {
    // The case the whole field exists for. `edgeStatsDirty` marks only the
    // source, which is the right rule for counting what a node points at and
    // blind to the company's page - and 7 of 10 pages in the sitemap are only
    // ever a target.
    expect(
      pagesChangedByEdgeWrite(
        employment({ published: false }),
        employment({ published: true }),
      ),
    ).toEqual(["person-1", "company-1"]);
  });

  it("names both ends when a published relation is hidden or deleted", () => {
    expect(
      pagesChangedByEdgeWrite(employment({ published: true }), undefined),
    ).toEqual(["person-1", "company-1"]);
    expect(
      pagesChangedByEdgeWrite(
        employment({ published: true }),
        employment({ published: true, deleted: true }),
      ),
    ).toEqual(["person-1", "company-1"]);
  });

  it("names the page a relation moved off as well as the one it moved to", () => {
    expect(
      pagesChangedByEdgeWrite(
        employment({ published: true, target: "company-old" }),
        employment({ published: true, target: "company-new" }),
      ),
    ).toEqual(["person-1", "company-old", "company-new"]);
  });

  it("names nothing while the relation is a draft", () => {
    // The gate, and the whole reason the dates stay trustworthy: two edges in
    // three are drafts and the ingest rewrites them by the thousand. A draft is
    // invisible, so it cannot have changed a page.
    expect(
      pagesChangedByEdgeWrite(undefined, employment({ published: false })),
    ).toEqual([]);
    expect(
      pagesChangedByEdgeWrite(employment(), employment({ name: "poprawka" })),
    ).toEqual([]);
    expect(
      pagesChangedByEdgeWrite(
        employment({ published: true, deleted: true }),
        employment({ published: true, deleted: true }),
      ),
    ).toEqual([]);
  });

  it("names a node once, however many ends of the relation it is", () => {
    expect(
      pagesChangedByEdgeWrite(
        employment({ published: true, target: "person-1" }),
        employment({ published: true, target: "person-1" }),
      ),
    ).toEqual(["person-1"]);
  });

  it("ignores an end that is missing or not an id", () => {
    expect(
      pagesChangedByEdgeWrite(undefined, {
        published: true,
        source: "person-1",
        target: "",
      }),
    ).toEqual(["person-1"]);
    expect(
      pagesChangedByEdgeWrite(undefined, { published: true, source: 42 }),
    ).toEqual([]);
  });
});
