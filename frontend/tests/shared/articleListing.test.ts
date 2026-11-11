import { describe, it, expect } from "vitest";
import {
  isListedSource,
  isUnlistedSourceUrl,
} from "../../shared/articleListing";
import { inSitemap } from "../../shared/lastmod";

const live = { published: true, name: "Strona z linkedin.com" };

describe("isUnlistedSourceUrl", () => {
  it("knows the social networks, their subdomains and www.", () => {
    expect(isUnlistedSourceUrl("https://www.facebook.com/tkajor/")).toBe(true);
    expect(isUnlistedSourceUrl("https://m.facebook.com/story.php?id=1")).toBe(
      true,
    );
    expect(
      isUnlistedSourceUrl("https://pl.linkedin.com/in/adam-skowron-1"),
    ).toBe(true);
    expect(isUnlistedSourceUrl("https://x.com/someone/status/1")).toBe(true);
    expect(isUnlistedSourceUrl("https://youtu.be/abc")).toBe(true);
    // Stored without a scheme, as two hand-typed articles were.
    expect(isUnlistedSourceUrl("www.linkedin.com/in/someone")).toBe(true);
  });

  it("keeps BIP, news and lookalike hosts listed", () => {
    expect(
      isUnlistedSourceUrl(
        "https://bip.karczew.pl/fls/bip_pliki/2024_10/BIPF6237D18C822F5Z/Roslonek_Tomasz_zanonimi.pdf",
      ),
    ).toBe(false);
    expect(
      isUnlistedSourceUrl("https://wiadomosci.onet.pl/kraj/partyjny-desant"),
    ).toBe(false);
    // Only the site itself or a subdomain of it: not a name that ends alike.
    expect(isUnlistedSourceUrl("https://notfacebook.com/x")).toBe(false);
    expect(isUnlistedSourceUrl("https://linkedin.com.example.pl/x")).toBe(
      false,
    );
  });

  it("lists what it cannot read", () => {
    expect(isUnlistedSourceUrl(undefined)).toBe(false);
    expect(isUnlistedSourceUrl("")).toBe(false);
    expect(isUnlistedSourceUrl("not a url at all")).toBe(false);
    expect(isUnlistedSourceUrl(42)).toBe(false);
  });
});

describe("isListedSource", () => {
  it("unlists only an article whose source is on a listed site", () => {
    expect(
      isListedSource({
        type: "article",
        sourceURL: "https://www.linkedin.com/in/x",
      }),
    ).toBe(false);
    expect(
      isListedSource({
        type: "article",
        sourceURL: "https://bip.warszawa.pl/x",
      }),
    ).toBe(true);
    // A person or company is never unlisted by a field it does not have.
    expect(
      isListedSource({
        type: "person",
        sourceURL: "https://www.linkedin.com/in/x",
      }),
    ).toBe(true);
    expect(isListedSource({ type: "article" })).toBe(true);
  });
});

describe("inSitemap", () => {
  it("leaves an article from a social network out", () => {
    expect(
      inSitemap({
        ...live,
        type: "article",
        sourceURL: "https://www.linkedin.com/in/adam-skowron-1",
      }),
    ).toBe(false);
    expect(
      inSitemap({
        ...live,
        type: "article",
        sourceURL: "https://www.facebook.com/tkajor/",
      }),
    ).toBe(false);
  });

  it("keeps a BIP or news source, and pages that are not articles", () => {
    expect(
      inSitemap({
        ...live,
        type: "article",
        sourceURL: "https://bip.umww.pl/artykuly/2833700",
      }),
    ).toBe(true);
    expect(inSitemap({ ...live, type: "article" })).toBe(true);
    expect(inSitemap({ ...live, type: "person" })).toBe(true);
    expect(inSitemap({ ...live, type: "place" })).toBe(true);
  });

  it("still leaves out what it always did", () => {
    expect(
      inSitemap({
        type: "article",
        name: "x",
        published: false,
        sourceURL: "https://bip.x.pl",
      }),
    ).toBe(false);
    expect(inSitemap({ ...live, type: "region" })).toBe(false);
    expect(inSitemap({ ...live, type: "article", name: "" })).toBe(false);
  });
});
