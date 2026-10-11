import { describe, it, expect } from "vitest";
import { normalizeUrl, normalizeUrlIgnoringPage } from "../../shared/url";

describe("normalizeUrl", () => {
  it("matches a scheme-less url against a stored one", () => {
    // The case that kept every extracted fact from finding its article: the
    // pipeline sends no scheme, the crawler stored https.
    expect(normalizeUrl("wpolityce.pl/polityka/736478-sad")).toBe(
      normalizeUrl("https://wpolityce.pl/polityka/736478-sad"),
    );
  });

  it("ignores www., the scheme, case in the host and a trailing slash", () => {
    const forms = [
      "https://www.Example.pl/a/",
      "http://example.pl/a",
      "example.pl/a",
      "www.example.pl/a/",
    ];
    const normalized = new Set(forms.map(normalizeUrl));
    expect([...normalized]).toEqual(["example.pl/a"]);
  });

  it("keeps the path case, which servers do distinguish", () => {
    expect(normalizeUrl("example.pl/Artykul")).not.toBe(
      normalizeUrl("example.pl/artykul"),
    );
  });

  it("keeps the query string, which some sites use as the article id", () => {
    expect(normalizeUrl("example.pl/news?id=7")).not.toBe(
      normalizeUrl("example.pl/news?id=8"),
    );
  });

  it("falls back to comparing verbatim when the url will not parse", () => {
    expect(normalizeUrl("  NOT A URL  ")).toBe("not a url");
  });

  it("drops the fragment, which is never sent to the server", () => {
    expect(
      normalizeUrl("https://www.iswinoujscie.pl/artykuly/56911/#komentarz"),
    ).toBe("iswinoujscie.pl/artykuly/56911");
    expect(
      normalizeUrl(
        "https://jawnylublin.pl/z-urzedu-do-panstwowej-spolki/#:~:text=prezeska",
      ),
    ).toBe(normalizeUrl("jawnylublin.pl/z-urzedu-do-panstwowej-spolki"));
  });
});

describe("normalizeUrlIgnoringPage", () => {
  it("sets a numeric page aside", () => {
    // The article, and the second page of its comments.
    expect(
      normalizeUrlIgnoringPage(
        "https://www.iswinoujscie.pl/artykuly/56911/?page=1#komentarz",
      ),
    ).toBe(
      normalizeUrlIgnoringPage("https://www.iswinoujscie.pl/artykuly/56911/"),
    );
    expect(
      normalizeUrlIgnoringPage("iswinoujscie.pl/artykuly/25915/?page=0"),
    ).toBe("iswinoujscie.pl/artykuly/25915");
  });

  it("keeps every other parameter, in its place", () => {
    expect(normalizeUrlIgnoringPage("example.pl/a?id=7&page=2&sort=DESC")).toBe(
      "example.pl/a?id=7&sort=DESC",
    );
    expect(
      normalizeUrlIgnoringPage("facebook.com/profile.php?id=587531424"),
    ).toBe("facebook.com/profile.php?id=587531424");
  });

  it("keeps a page that is not a number, which names a page rather than counting one", () => {
    expect(normalizeUrlIgnoringPage("example.pl/index.php?page=kontakt")).toBe(
      "example.pl/index.php?page=kontakt",
    );
  });
});
