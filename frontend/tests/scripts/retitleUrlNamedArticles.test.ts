import { describe, it, expect } from "vitest";
import {
  chooseTitle,
  decodeBody,
  isHtmlResponse,
  parseRobots,
  robotsAllows,
  robotsFromResponse,
  usablePageTitle,
} from "../../scripts/migrate/retitle-url-named-articles";

describe("parseRobots", () => {
  const text = [
    "# a comment",
    "User-agent: Googlebot",
    "Disallow: /tylko-google/",
    "",
    "User-agent: *",
    "Disallow: /admin/",
    "Allow: /admin/publiczne/",
    "Disallow: /*.pdf$",
  ].join("\n");

  it("takes the * group when nothing names this script", () => {
    const rules = parseRobots(text);
    expect(robotsAllows(rules, "/aktualnosci/1")).toBe(true);
    expect(robotsAllows(rules, "/tylko-google/a")).toBe(true);
    expect(robotsAllows(rules, "/admin/x")).toBe(false);
  });

  it("lets the longest rule decide, and an allow win a tie", () => {
    const rules = parseRobots(text);
    expect(robotsAllows(rules, "/admin/publiczne/a")).toBe(true);
    expect(
      robotsAllows(
        [
          { allow: false, path: "/a" },
          { allow: true, path: "/a" },
        ],
        "/a/b",
      ),
    ).toBe(true);
  });

  it("reads * and $ in a path", () => {
    const rules = parseRobots(text);
    expect(robotsAllows(rules, "/pliki/oswiadczenie.pdf")).toBe(false);
    expect(robotsAllows(rules, "/pliki/oswiadczenie.pdf?v=2")).toBe(true);
  });

  it("follows a group that names this script, over the * one", () => {
    const rules = parseRobots(
      [
        "User-agent: *",
        "Disallow: /",
        "",
        "User-agent: other",
        "User-agent: koryta-article-titles",
        "Disallow: /prywatne/",
      ].join("\n"),
    );
    expect(robotsAllows(rules, "/artykul")).toBe(true);
    expect(robotsAllows(rules, "/prywatne/a")).toBe(false);
  });

  it("forbids nothing with an empty Disallow", () => {
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow:"), "/a")).toBe(
      true,
    );
  });
});

describe("robotsFromResponse", () => {
  it("reads a 4xx as no robots.txt at all, but a 429 as keep out", () => {
    expect(robotsFromResponse(404)).toBe("everything");
    expect(robotsFromResponse(403)).toBe("everything");
    expect(robotsFromResponse(429)).toBe("nothing");
  });

  it("keeps out of a site whose robots.txt cannot be read", () => {
    expect(robotsFromResponse(503)).toBe("nothing");
    expect(robotsFromResponse(undefined)).toBe("nothing");
  });

  it("parses one that answered", () => {
    expect(robotsFromResponse(200, "User-agent: *\nDisallow: /")).toEqual([
      { allow: false, path: "/" },
    ]);
  });
});

describe("decodeBody", () => {
  // "Świnoujście" in ISO-8859-2: Ś is 0xA6, ś is 0xB6.
  const latin2 = (prefix: string) =>
    new Uint8Array([
      ...new TextEncoder().encode(prefix),
      0xa6,
      ...new TextEncoder().encode("winouj"),
      0xb6,
      ...new TextEncoder().encode("cie</title>"),
    ]);

  it("reads a page in the charset its head declares", () => {
    const bytes = latin2(
      '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2"><title>',
    );
    expect(decodeBody(bytes)).toContain("Świnoujście");
  });

  it("believes the Content-Type header first", () => {
    expect(
      decodeBody(latin2("<title>"), "text/html; charset=ISO-8859-2"),
    ).toContain("Świnoujście");
  });

  it("reads UTF-8 where nothing is declared", () => {
    expect(
      decodeBody(new TextEncoder().encode("<title>Łódź</title>")),
    ).toContain("Łódź");
  });
});

describe("isHtmlResponse", () => {
  it("does not read a file for a title", () => {
    expect(isHtmlResponse("application/pdf")).toBe(false);
    expect(isHtmlResponse("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlResponse(null)).toBe(true);
  });
});

describe("chooseTitle", () => {
  const url = "https://bip.miastozabrze.pl/doc/62";

  it("takes the page's own title where it has a usable one", () => {
    expect(
      chooseTitle({
        url,
        page: {
          kind: "titled",
          titles: ["Oświadczenie majątkowe - Jan Nowak", ""],
        },
        names: ["Jan Nowak"],
      }),
    ).toEqual({
      title: "Oświadczenie majątkowe - Jan Nowak",
      method: "page",
      detail: "",
    });
  });

  it("falls back to og:title when <title> is the bare site name", () => {
    expect(
      chooseTitle({
        url: "https://x.com/a/status/1",
        page: { kind: "titled", titles: ["X", "Jan Nowak on X: wpis"] },
        names: [],
      }).title,
    ).toBe("Jan Nowak on X: wpis");
  });

  it("composes a title for a file, named after who it is filed under", () => {
    expect(
      chooseTitle({
        url,
        page: { kind: "document", contentType: "application/pdf" },
        names: ["Jan Nowak"],
      }),
    ).toEqual({
      title: "Jan Nowak: dokument z bip.miastozabrze.pl",
      method: "names",
      detail: "not a page: application/pdf",
    });
  });

  it("says where it is from when nobody public is linked to it", () => {
    expect(
      chooseTitle({
        url: "https://www.linkedin.com/in/a/",
        page: { kind: "skipped", reason: "robots.txt of www.linkedin.com" },
        names: [],
      }),
    ).toEqual({
      title: "Strona z linkedin.com",
      method: "host",
      detail: "robots.txt of www.linkedin.com",
    });
  });

  it("composes from the address alone when nothing was fetched", () => {
    expect(
      chooseTitle({
        url: "https://bip.karczew.pl/a/Roslonek_Tomasz.pdf",
        names: ["Tomasz Rosłonek"],
      }),
    ).toMatchObject({
      title: "Tomasz Rosłonek: dokument z bip.karczew.pl",
      detail: "not fetched",
    });
  });
});

describe("usablePageTitle", () => {
  const url = "https://pl.wikipedia.org/wiki/Jerzy_Fedorowicz";

  it("takes a page's own title as it is, whitespace tidied", () => {
    // Wikipedia's own en dash stays: it is the page's title, not our copy.
    expect(
      usablePageTitle(
        "  Jerzy Fedorowicz \n \u2013 Wikipedia, wolna encyklopedia ",
        url,
      ),
    ).toBe("Jerzy Fedorowicz \u2013 Wikipedia, wolna encyklopedia");
  });

  it("refuses what a sign-in wall or an app shell is titled", () => {
    expect(
      usablePageTitle("LinkedIn", "https://www.linkedin.com/in/x"),
    ).toBeUndefined();
    expect(usablePageTitle("x.com", "https://x.com/a")).toBeUndefined();
    expect(usablePageTitle("X", "https://x.com/a")).toBeUndefined();
  });

  it("refuses letters lost to the wrong encoding, and an address", () => {
    expect(usablePageTitle("\uFFFDwinouj\uFFFDcie", url)).toBeUndefined();
    expect(usablePageTitle(url, url)).toBeUndefined();
  });

  it("refuses an error page, and the home page a dead link lands on", () => {
    // powiat-lubin.ssdip.bip.gov.pl/oswiadczenia-majatkowe-... on 2026-11-09.
    expect(usablePageTitle("Strona główna SSDIP", url)).toBeUndefined();
    expect(usablePageTitle("404 Not Found", url)).toBeUndefined();
    expect(usablePageTitle("Just a moment...", url)).toBeUndefined();
    expect(usablePageTitle("", url)).toBeUndefined();
  });

  it("keeps a headline that only starts like one", () => {
    expect(usablePageTitle("Błąd lekarski w szpitalu powiatowym", url)).toBe(
      "Błąd lekarski w szpitalu powiatowym",
    );
    expect(usablePageTitle("500 zł podwyżki dla radnych", url)).toBe(
      "500 zł podwyżki dla radnych",
    );
  });
});
