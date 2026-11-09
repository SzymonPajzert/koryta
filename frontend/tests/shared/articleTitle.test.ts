import { describe, it, expect } from "vitest";
import {
  composedArticleTitle,
  isDocumentUrl,
  isUrlShapedName,
  sourceHost,
} from "../../shared/articleTitle";

const KARCZEW =
  "https://bip.karczew.pl/fls/bip_pliki/2024_10/BIPF6237D18C822F5Z/Roslonek_Tomasz_zanonimi.pdf";

describe("isUrlShapedName", () => {
  it("knows an address standing in for a title", () => {
    // 167 article nodes on 2026-11-09, every one starting like one of these.
    expect(isUrlShapedName(KARCZEW)).toBe(true);
    expect(
      isUrlShapedName("http://bip.tomaszow.miasta.pl/public/getFile?id=594851"),
    ).toBe(true);
    expect(isUrlShapedName("www.ohp.pl/aktualnosci/nowe-powolanie")).toBe(true);
  });

  it("leaves a real title alone, even one that names a site", () => {
    expect(isUrlShapedName("Nowy prezes ZUW - dobremiasto.net")).toBe(false);
    expect(isUrlShapedName("")).toBe(false);
    expect(isUrlShapedName(undefined)).toBe(false);
  });
});

describe("sourceHost", () => {
  it("names the site as a reader would, without www.", () => {
    expect(sourceHost("https://www.linkedin.com/in/x/")).toBe("linkedin.com");
    expect(sourceHost(KARCZEW)).toBe("bip.karczew.pl");
    expect(sourceHost("bip.um.wroc.pl/a")).toBe("bip.um.wroc.pl");
  });
});

describe("isDocumentUrl", () => {
  it("tells a file from a page by its extension, encoded or not", () => {
    expect(isDocumentUrl(KARCZEW)).toBe(true);
    expect(
      isDocumentUrl(
        "https://bip.katowice.eu/Lists/Oswiadczenia/Attachments/10329/Adam%20Skowron_o%C5%9Bwiadczenie.PDF",
      ),
    ).toBe(true);
    expect(isDocumentUrl("https://bip.miastozabrze.pl/doc/62")).toBe(false);
  });
});

describe("composedArticleTitle", () => {
  it("says who a document is about and where it is from", () => {
    expect(
      composedArticleTitle({ url: KARCZEW, names: ["Tomasz Rosłonek"] }),
    ).toBe("Tomasz Rosłonek: dokument z bip.karczew.pl");
  });

  it("calls a page a page", () => {
    expect(
      composedArticleTitle({
        url: "https://www.linkedin.com/in/michal-panicz/",
        names: ["Michał Panicz"],
      }),
    ).toBe("Michał Panicz: strona z linkedin.com");
  });

  it("believes a fetch that saw a file over the address's extension", () => {
    // /api/files/3602187 is a PDF, which only its Content-Type says.
    expect(
      composedArticleTitle({
        url: "https://bip.malopolska.pl/api/files/3602187",
        names: ["Anna Nowak"],
        document: true,
      }),
    ).toBe("Anna Nowak: dokument z bip.malopolska.pl");
  });

  it("names two, and shortens a longer list", () => {
    expect(
      composedArticleTitle({ url: KARCZEW, names: ["A B", "C D", "A B"] }),
    ).toBe("A B i C D: dokument z bip.karczew.pl");
    expect(
      composedArticleTitle({ url: KARCZEW, names: ["A B", "C D", "E F"] }),
    ).toBe("A B, C D i in.: dokument z bip.karczew.pl");
  });

  it("says only where it is from with nobody to name", () => {
    expect(composedArticleTitle({ url: KARCZEW })).toBe(
      "Dokument z bip.karczew.pl",
    );
    expect(
      composedArticleTitle({ url: "https://x.com/ZychKonrad", names: [] }),
    ).toBe("Strona z x.com");
  });

  it("never writes a dash longer than a hyphen", () => {
    const title = composedArticleTitle({
      url: KARCZEW,
      names: ["A", "B", "C"],
    });
    expect(title).not.toMatch(/[\u2013\u2014]/);
  });
});
