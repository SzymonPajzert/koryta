import { describe, it, expect } from "vitest";
import { dateFromUrl, extractPublishedDate } from "../../shared/pageDate";

const ld = (json: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(json)}</script>`;

describe("extractPublishedDate", () => {
  it("reads ld+json", () => {
    expect(
      extractPublishedDate(
        ld({
          "@type": "NewsArticle",
          datePublished: "2020-03-03T15:21:00+01:00",
        }),
      ),
    ).toBe("2020-03-03T14:21:00.000Z");
  });

  it("reads past the first ld+json block", () => {
    // The shape that dated a good part of the archive as undateable: the outlet
    // leads with an Organization block, and `.first()` is the one without a date.
    const html =
      ld({ "@type": "Organization", name: "Redakcja" }) +
      ld({ "@type": "NewsArticle", datePublished: "2021-06-01" });
    expect(extractPublishedDate(html)).toBe("2021-06-01T00:00:00.000Z");
  });

  it("digs the date out of an @graph", () => {
    const html = ld({
      "@graph": [{ "@type": "WebSite" }, { datePublished: "2019-11-12" }],
    });
    expect(extractPublishedDate(html)).toBe("2019-11-12T00:00:00.000Z");
  });

  it("keeps going past a malformed ld+json block", () => {
    const html =
      `<script type="application/ld+json">{ not json </script>` +
      ld({ datePublished: "2022-02-02" });
    expect(extractPublishedDate(html)).toBe("2022-02-02T00:00:00.000Z");
  });

  it("reads the article:published_time meta family", () => {
    expect(
      extractPublishedDate(
        `<meta property="article:published_time" content="2018-04-05T08:00:00Z">`,
      ),
    ).toBe("2018-04-05T08:00:00.000Z");
  });

  it("reads a <time> marked as the publication date", () => {
    // wnp.pl: no ld+json article block, no og tags, two <time> elements.
    const html =
      `<time datetime="2020-03-03T15:21:00+01:00" itemprop="datePublished">3 marca 2020</time>` +
      `<time datetime="2020-03-03T15:36:00+01:00" itemprop="dateModified">3 marca 2020</time>`;
    expect(extractPublishedDate(html)).toBe("2020-03-03T14:21:00.000Z");
  });

  it("takes a lone unmarked <time> as the page's own date", () => {
    // e-legnickie.pl marks it not at all, but there is only one on the page.
    expect(
      extractPublishedDate(
        `<time datetime="2023-03-16T22:06:07+01:00">16 marzec 2023</time>`,
      ),
    ).toBe("2023-03-16T21:06:07.000Z");
  });

  it("ignores several unmarked <time> elements", () => {
    // A forum thread's posts, or a sidebar of related pieces: nothing says
    // which one is the article, so none of them is.
    const html =
      `<time datetime="2026-04-24T14:56:17+0200">…</time>` +
      `<time datetime="2025-01-10T22:43:25+0100">…</time>`;
    expect(extractPublishedDate(html)).toBeUndefined();
  });

  it("falls back to a date in the page's own json payload", () => {
    // olsztyn.tvp.pl renders client-side; the date is only in the payload.
    expect(
      extractPublishedDate(
        `<script>window.__data = {"release_date_dt" : "2019-03-22","title":"x"}</script>`,
      ),
    ).toBe("2019-03-22T00:00:00.000Z");
  });

  it("prefers publication to modification", () => {
    const html =
      `<meta property="article:modified_time" content="2024-01-01">` +
      ld({ datePublished: "2015-05-05" });
    expect(extractPublishedDate(html)).toBe("2015-05-05T00:00:00.000Z");
  });

  it("uses the modification date when that is all there is", () => {
    expect(
      extractPublishedDate(
        `<meta property="og:updated_time" content="2017-07-07">`,
      ),
    ).toBe("2017-07-07T00:00:00.000Z");
  });

  it("rejects a date before the web and one in the future", () => {
    expect(
      extractPublishedDate(ld({ datePublished: "1970-01-01" })),
    ).toBeUndefined();
    expect(
      extractPublishedDate(ld({ datePublished: "2999-01-01" })),
    ).toBeUndefined();
    expect(
      extractPublishedDate(ld({ datePublished: "wczoraj" })),
    ).toBeUndefined();
  });

  it("says nothing about a page that carries no date", () => {
    expect(
      extractPublishedDate("<html><body>Zarząd i Rada Nadzorcza</body></html>"),
    ).toBeUndefined();
  });
});

describe("dateFromUrl", () => {
  it("reads a web.archive.org capture stamp", () => {
    expect(
      dateFromUrl("https://web.archive.org/web/20140203040506/http://x.pl/a"),
    ).toBe("2014-02-03T00:00:00.000Z");
    expect(
      dateFromUrl(
        "https://web.archive.org/web/20140203040506id_/http://x.pl/a",
      ),
    ).toBe("2014-02-03T00:00:00.000Z");
  });

  it("reads a date laid out in the path", () => {
    expect(dateFromUrl("https://blog.pl/2024/09/04/tytul")).toBe(
      "2024-09-04T00:00:00.000Z",
    );
  });

  it("says nothing about a url without one", () => {
    expect(dateFromUrl("https://gov.pl/web/nfosigw/artykul")).toBeUndefined();
  });
});
