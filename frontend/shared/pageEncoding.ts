/** Reading a fetched web page's bytes as text, in the encoding the page is
 * written in.
 *
 * `getPageMeta` (functions/src/index.ts) used to take the body as axios hands
 * it over, and axios decodes every body as UTF-8 whatever the page says. A fair
 * part of the Polish web is not UTF-8 - local news portals and the PKW's older
 * election sites still serve ISO-8859-2 - and in those every Polish letter is a
 * byte UTF-8 cannot read. Each came out as U+FFFD, and the title went into the
 * database like that, as the name of the article: "�winouj�cie -
 * iswinoujscie.pl » Dariusz Bielski dzi�kuje wszystkim wyborcom"
 * (https://koryta.pl/admin/opinie#fb-3qIISyfU0iXo0Sus5bgJ).
 *
 * The order is a browser's, so that what is read is what the page's own
 * readers see: a byte order mark, then the charset in the `Content-Type`
 * header, then one the page declares in a `<meta>` of its head. A declaration
 * is believed even where the bytes disagree with it, as a browser believes it
 * - with one exception. A server's default of ISO-8859-1 (which a browser
 * reads as windows-1252, and which says nothing about Polish) over bytes that
 * are valid UTF-8 with letters outside ASCII in them is a default nobody set
 * for this page, and the page is read as the UTF-8 it is.
 *
 * Only a page that declares nothing is guessed at. Valid UTF-8 is UTF-8: text
 * in a single-byte encoding with any Polish in it practically never is. So is
 * a page that is mostly valid UTF-8 with a stray byte or two in it - a pasted
 * snippet, a truncated character - which the old code read right, and which a
 * single-byte guess would garble whole. What is left is one of the two
 * encodings Polish pages were written in before UTF-8, and the bytes tell them
 * apart. ISO-8859-2 has nothing but control characters at 0x80-0x9F, while
 * windows-1250 keeps ś, ź, Ś and Ź there, as well as „ ” – and —, so a page of
 * Polish in windows-1250 practically always uses one of them - and a page in
 * ISO-8859-2 never does.
 */

/** What decided the encoding a page was read in. */
export type PageEncodingSource =
  "bom" | "header" | "meta" | "valid-utf-8" | "guess";

export type DecodedPage = {
  text: string;
  /** The encoding's name as the Encoding Standard gives it - `utf-8`,
   * `iso-8859-2`, `windows-1250` - whatever label the page used for it. */
  encoding: string;
  source: PageEncodingSource;
};

/** How far into a page to look for a `<meta>` declaring its charset.
 *
 * A browser's first look covers 1024 bytes, but it also acts on a declaration
 * it meets later in the head, so the whole head is read - up to this much of
 * it, which no head that matters comes near. */
const HEAD_BYTES = 64 * 1024;

/** The page as text, in the encoding it declares or, failing that, in the one
 * its bytes are in. `contentType` is the response's `Content-Type` header. */
export function decodePage(
  bytes: Uint8Array,
  contentType?: string | null,
): DecodedPage {
  const declared = declaredEncoding(bytes, contentType);
  if (declared?.encoding === "windows-1252") {
    const utf8 = utf8Reading(bytes);
    if (utf8.valid && utf8.multiByte > 0) {
      return { text: utf8.text, encoding: "utf-8", source: "valid-utf-8" };
    }
  }
  if (declared) return decodeAs(bytes, declared.encoding, declared.source);

  const utf8 = utf8Reading(bytes);
  if (utf8.valid) {
    return { text: utf8.text, encoding: "utf-8", source: "valid-utf-8" };
  }
  // Mostly UTF-8, with the odd byte that is not: those become U+FFFD and the
  // rest of the page reads as it should.
  if (utf8.multiByte > utf8.invalid) {
    return { text: utf8.text, encoding: "utf-8", source: "guess" };
  }
  // Not UTF-8, so one of the two older encodings of Polish.
  const windows = bytes.some((byte) => byte >= 0x80 && byte <= 0x9f);
  return decodeAs(bytes, windows ? "windows-1250" : "iso-8859-2", "guess");
}

/** The page read as UTF-8, with how much of it reads: whether all of it
 * does, the characters outside ASCII that came out of a multi-byte sequence,
 * and the U+FFFD that stand for bytes that are not UTF-8. Single-byte Polish
 * text forms a valid sequence only by accident, a handful of times a page at
 * most. */
function utf8Reading(bytes: Uint8Array): {
  text: string;
  valid: boolean;
  multiByte: number;
  invalid: number;
} {
  let valid = true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    valid = false;
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  let multiByte = 0;
  let invalid = 0;
  for (const char of text) {
    if (char === "\uFFFD") invalid += 1;
    else if (char > "\u007F") multiByte += 1;
  }
  return { text, valid, multiByte, invalid };
}

function decodeAs(
  bytes: Uint8Array,
  encoding: string,
  source: PageEncodingSource,
): DecodedPage {
  const decoder = decoderFor(encoding);
  if (decoder) return { text: decoder.decode(bytes), encoding, source };
  // Only a Node built without full ICU knows no single-byte encodings, and
  // there this reads the page the way it always used to be read rather than
  // not at all.
  return {
    text: new TextDecoder("utf-8").decode(bytes),
    encoding: "utf-8",
    source,
  };
}

function decoderFor(label: string): TextDecoder | undefined {
  try {
    return new TextDecoder(label);
  } catch {
    // An unknown label, or an encoding this runtime was built without.
    return undefined;
  }
}

/** The encoding's own name for `label`, when it names one this runtime can
 * read. Resolved as a browser resolves it, so `latin2` is ISO-8859-2 and
 * `iso-8859-1` is windows-1252. */
function encodingNamed(label: string | undefined): string | undefined {
  if (!label) return undefined;
  return decoderFor(label.trim())?.encoding;
}

function declaredEncoding(
  bytes: Uint8Array,
  contentType: string | null | undefined,
): { encoding: string; source: PageEncodingSource } | undefined {
  const bom = encodingFromBom(bytes);
  if (bom) return { encoding: bom, source: "bom" };

  const header = encodingNamed(
    /;\s*charset\s*=\s*"?([^";\s]*)/i.exec(contentType ?? "")?.[1],
  );
  if (header) return { encoding: header, source: "header" };

  const meta = encodingInHead(bytes);
  if (meta) return { encoding: meta, source: "meta" };
  return undefined;
}

function encodingFromBom(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  return undefined;
}

/** The charset a `<meta>` in the page's head declares, in either of the two
 * forms there are: `<meta charset="utf-8">`, and the older
 * `<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2">`,
 * which is the one iswinoujscie.pl uses.
 *
 * The head is read one byte to a character, so the markup, which is ASCII in
 * every encoding this can find, reads as itself whatever the page turns out to
 * be in. */
function encodingInHead(bytes: Uint8Array): string | undefined {
  let head = new TextDecoder("latin1").decode(bytes.subarray(0, HEAD_BYTES));
  const end = head.search(/<\/head\s*>|<body[\s>]/i);
  if (end >= 0) head = head.slice(0, end);
  // A tag commented out declares nothing.
  head = head.replace(/<!--[\s\S]*?-->/g, "");

  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const label = /\bcharset\s*=\s*["']?\s*([^\s"'/>;]+)/i.exec(tag)?.[1];
    const encoding = encodingNamed(label);
    if (!encoding) continue;
    // A page whose head could be read one byte to a character is not in
    // UTF-16, whatever it claims - a browser takes that claim as UTF-8 too.
    return encoding.startsWith("utf-16") ? "utf-8" : encoding;
  }
  return undefined;
}

/** Whether a response is a page to read a title from. A missing header is
 * given the benefit of the doubt, as it always was; a declared type that is
 * not HTML - a PDF, an image - is not a page. */
export function isHtml(contentType: string | undefined): boolean {
  if (!contentType?.trim()) return true;
  return /html/i.test(contentType.split(";")[0]!);
}
