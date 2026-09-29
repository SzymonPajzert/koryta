// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decodePage, isHtml } from "../../shared/pageEncoding";

/** A string of `\xNN` escapes as the bytes it spells, one byte a character -
 * how a page in a single-byte encoding is written down here. */
const bytes = (binary: string) =>
  Uint8Array.from(binary, (char) => char.charCodeAt(0));

const titleOf = (text: string) => /<title>([\s\S]*?)<\/title>/.exec(text)?.[1];

/** The head of https://www.iswinoujscie.pl/artykuly/25915/?page=0 as the
 * server sends it, byte for byte - with `Content-Type: text/html` and no
 * charset, so the `<meta http-equiv>` is the only thing that says ISO-8859-2.
 * One of the three articles on Dariusz Bielski's page that were stored with
 * U+FFFD for every Polish letter. */
const ISWINOUJSCIE_HEAD =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n' +
  '<html xmlns="https://www.w3.org/1999/xhtml/" xml:lang="pl" lang="pl">\n' +
  "<head>\n" +
  '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2" />\n' +
  '<meta http-equiv="content-language" content="pl" />\n' +
  '<base target="_self" href="https://www.iswinoujscie.pl/" />\n' +
  "<title>\xa6winouj\xb6cie - iswinoujscie.pl &raquo; \xa6winouj\xb6cianin -  Dariusz Bielski nagrodzony br\xb1zow\xb1 oznak\xb1 za zas\xb3ugi dla Sportu</title>\n";

describe("decodePage", () => {
  it("reads iswinoujscie.pl in the ISO-8859-2 its <meta http-equiv> declares", () => {
    const page = bytes(`${ISWINOUJSCIE_HEAD}</head><body></body></html>`);

    // What axios made of it, and what went into the database.
    expect(titleOf(new TextDecoder().decode(page))).toContain(
      "\uFFFDwinouj\uFFFDcie",
    );

    const decoded = decodePage(page, "text/html");
    expect(decoded).toMatchObject({ encoding: "iso-8859-2", source: "meta" });
    expect(titleOf(decoded.text)).toBe(
      "Świnoujście - iswinoujscie.pl &raquo; Świnoujścianin -  Dariusz Bielski nagrodzony brązową oznaką za zasługi dla Sportu",
    );
  });

  it("guesses ISO-8859-2 for a page that declares nothing and is not UTF-8", () => {
    // wybory2001.pkw.gov.pl, the fourth garbled article: no charset in the
    // header, no <meta>, and no byte at 0x80-0x9F.
    const page = bytes(
      "<html><head><title>Pa\xf1stwowa Komisja Wyborcza: Wybory Parlamentarne 2001</title></head>" +
        "<body><td>Nr na li\xb6cie</td></body></html>",
    );

    const decoded = decodePage(page, "text/html");
    expect(decoded).toMatchObject({ encoding: "iso-8859-2", source: "guess" });
    expect(titleOf(decoded.text)).toBe(
      "Państwowa Komisja Wyborcza: Wybory Parlamentarne 2001",
    );
    expect(decoded.text).toContain("Nr na liście");
  });

  it("guesses windows-1250 from a byte only windows-1250 uses for text", () => {
    // ś, Ś, – and the Polish quotes all sit at 0x80-0x9F in windows-1250,
    // where ISO-8859-2 has control characters only.
    const page = bytes(
      "<html><head><title>Wiadomo\x9cci ze \x8cwinouj\x9ccia \x96 b\xead\xb9 \x84remonty\x94</title></head></html>",
    );

    const decoded = decodePage(page, null);
    expect(decoded).toMatchObject({
      encoding: "windows-1250",
      source: "guess",
    });
    expect(titleOf(decoded.text)).toBe(
      "Wiadomości ze Świnoujścia – będą „remonty”",
    );
  });

  it("reads undeclared UTF-8 as UTF-8", () => {
    const page = new TextEncoder().encode(
      "<html><head><title>Świnoujście – będą „remonty”</title></head></html>",
    );

    const decoded = decodePage(page, "text/html");
    expect(decoded).toMatchObject({
      encoding: "utf-8",
      source: "valid-utf-8",
    });
    expect(titleOf(decoded.text)).toBe("Świnoujście – będą „remonty”");
  });

  it("reads undeclared UTF-8 with a stray byte as UTF-8, not as a guess at Polish", () => {
    const utf8 = new TextEncoder().encode(
      "<html><head><title>Świnoujście – będą „remonty”</title></head><body>",
    );
    // One byte that is not UTF-8, far from the title.
    const page = new Uint8Array([...utf8, 0xa6, ...bytes("</body></html>")]);

    const decoded = decodePage(page, "text/html");
    expect(decoded).toMatchObject({ encoding: "utf-8", source: "guess" });
    expect(titleOf(decoded.text)).toBe("Świnoujście – będą „remonty”");
  });

  it("reads valid UTF-8 as UTF-8 under a server's default of ISO-8859-1", () => {
    const page = new TextEncoder().encode(
      "<head><title>Świnoujście – będą „remonty”</title></head>",
    );

    for (const header of [
      "text/html; charset=ISO-8859-1",
      "text/html; charset=us-ascii",
      "text/html; charset=windows-1252",
    ]) {
      const decoded = decodePage(page, header);
      expect(decoded, header).toMatchObject({
        encoding: "utf-8",
        source: "valid-utf-8",
      });
      expect(titleOf(decoded.text)).toBe("Świnoujście – będą „remonty”");
    }
    // Plain ASCII says nothing either way, and keeps the declaration.
    expect(
      decodePage(bytes("<title>x</title>"), "text/html; charset=iso-8859-1")
        .encoding,
    ).toBe("windows-1252");
  });

  it("takes the charset in the Content-Type header over the page's own", () => {
    // 0xB9 is ą in windows-1250 and š in ISO-8859-2.
    const page = bytes(
      '<head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2"><title>Radni s\xb9</title></head>',
    );

    const decoded = decodePage(page, "text/html; charset=windows-1250");
    expect(decoded).toMatchObject({
      encoding: "windows-1250",
      source: "header",
    });
    expect(titleOf(decoded.text)).toBe("Radni są");
  });

  it("reads a quoted, upper-case charset in the header", () => {
    const page = bytes("<head><title>Radni s\xb1</title></head>");

    const decoded = decodePage(page, 'text/html; charset="ISO-8859-2"');
    expect(decoded).toMatchObject({ encoding: "iso-8859-2", source: "header" });
    expect(titleOf(decoded.text)).toBe("Radni są");
  });

  it("reads <meta charset>, quoted or not", () => {
    // No byte at 0x80-0x9F, so a guess would have said ISO-8859-2.
    const page = bytes(
      "<head><meta charset=windows-1250><title>Radni s\xb9</title></head>",
    );

    const decoded = decodePage(page, "text/html");
    expect(decoded).toMatchObject({ encoding: "windows-1250", source: "meta" });
    expect(titleOf(decoded.text)).toBe("Radni są");

    const quoted = bytes(
      '<head><meta charset="windows-1250" /><title>Radni s\xb9</title></head>',
    );
    expect(decodePage(quoted).encoding).toBe("windows-1250");
  });

  it("passes over a charset it does not know", () => {
    const page = bytes(
      '<head><meta charset="iso-8859-2"><title>Radni s\xb1</title></head>',
    );

    expect(decodePage(page, "text/html; charset=nonsense")).toMatchObject({
      encoding: "iso-8859-2",
      source: "meta",
    });
  });

  it("resolves a label to the encoding a browser would", () => {
    const page = bytes("<head><title>x</title></head>");

    expect(decodePage(page, "text/html; charset=latin2").encoding).toBe(
      "iso-8859-2",
    );
    // The Encoding Standard reads every page labelled ISO-8859-1 as
    // windows-1252, and so does every browser.
    expect(decodePage(page, "text/html; charset=iso-8859-1").encoding).toBe(
      "windows-1252",
    );
  });

  it("believes a declaration the bytes contradict, as a browser does", () => {
    // The page's own readers see these replacement characters too, and
    // scripts/migrate/refetch-garbled-article-titles.ts leaves such a title
    // alone rather than storing it again.
    const page = bytes("<head><title>Radni s\xb1</title></head>");

    const decoded = decodePage(page, "text/html; charset=utf-8");
    expect(decoded).toMatchObject({ encoding: "utf-8", source: "header" });
    expect(titleOf(decoded.text)).toBe("Radni s\uFFFD");
  });

  it("lets a byte order mark overrule the header, and drops it", () => {
    const utf8 = new TextEncoder().encode("<title>Świnoujście</title>");
    const page = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);

    const decoded = decodePage(page, "text/html; charset=iso-8859-2");
    expect(decoded).toMatchObject({ encoding: "utf-8", source: "bom" });
    expect(decoded.text).toBe("<title>Świnoujście</title>");
  });

  it("reads no <meta> from a comment or from past the head", () => {
    const page = bytes(
      '<html><head><!-- <meta charset="windows-1250"> --><title>Radni s\xb1</title></head>' +
        '<body><meta charset="windows-1250"></body></html>',
    );

    expect(decodePage(page, "text/html")).toMatchObject({
      encoding: "iso-8859-2",
      source: "guess",
    });
  });

  it("takes a <meta> that claims UTF-16 as UTF-8", () => {
    // Its head was just read one byte to a character, so it is not UTF-16.
    const page = new TextEncoder().encode(
      '<head><meta charset="utf-16"><title>Świnoujście</title></head>',
    );

    const decoded = decodePage(page, "text/html");
    expect(decoded).toMatchObject({ encoding: "utf-8", source: "meta" });
    expect(titleOf(decoded.text)).toBe("Świnoujście");
  });
});

describe("isHtml", () => {
  it("takes html, and a response that names no type, as a page", () => {
    expect(isHtml("text/html")).toBe(true);
    expect(isHtml("text/html; charset=iso-8859-2")).toBe(true);
    expect(isHtml("application/xhtml+xml")).toBe(true);
    expect(isHtml(undefined)).toBe(true);
    expect(isHtml("")).toBe(true);
  });

  it("does not take a PDF or an image for one", () => {
    expect(isHtml("application/pdf")).toBe(false);
    expect(isHtml("image/jpeg")).toBe(false);
    expect(isHtml("application/octet-stream; name=page.html")).toBe(false);
  });
});
