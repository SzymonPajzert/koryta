import { gzipSync } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { getStorage } from "firebase-admin/storage";
import { getApp } from "firebase-admin/app";

/** The bucket the crawler writes to, and the only one the article pipelines
 * read. Spelled here exactly as `CRAWLED_BUCKET` in
 * `data/scrapers/src/stores/storage.py`. */
export const CRAWLED_BUCKET = "koryta-pl-crawled";

/** The parts of a url the crawled-bucket layout is built from.
 *
 * Mirrors `NormalizedParse.parse` in `data/scrapers/src/entities/util.py`,
 * because every path below has to come out byte-identical to the one the
 * crawler wrote — `ArticleParsed` looks a page up inside its archive by
 * recomputing this from the url and nothing else, and a mismatch is silent
 * (the page is recorded `not_in_mirror` rather than failing).
 */
export function parseCrawlUrl(url: string): {
  hostname: string;
  path: string;
  full: string;
} {
  let text = url.trim();
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  // The fragment identifies a place on the page, never a different page, and
  // nothing downstream looks at it: the bucket path drops it, and `url_store`
  // canonicalises only the scheme and the trailing slash — so a `#comments`
  // left on would make the same article two rows there.
  const hash = text.indexOf("#");
  if (hash !== -1) text = text.slice(0, hash);
  // A single trailing slash, exactly as the Python does it: `url[:-1]`, not a
  // strip of every trailing slash.
  if (text.endsWith("/")) text = text.slice(0, -1);

  // `URL` is the gate, not the source: it rejects what is not a url at all
  // (`http://not a url`, `http:/`), which the hand parsing below would happily
  // turn into a plausible-looking host. What it must not be used for is the
  // parts themselves — it punycodes an IDN host and normalizes an empty path
  // to `/`, and Python does neither.
  try {
    void new URL(text);
  } catch {
    throw createError({ statusCode: 422, message: `Zły adres URL: ${url}` });
  }

  // Matched rather than sliced at `indexOf("://")`: stripping the trailing
  // slash can leave `http:/`, which has no `://` to find and would otherwise be
  // cut at a nonsense offset.
  const withoutScheme = /^https?:\/\/(.*)$/i.exec(text);
  if (!withoutScheme) {
    throw createError({ statusCode: 422, message: `Zły adres URL: ${url}` });
  }
  const afterScheme = withoutScheme[1]!;
  const authorityEnd = afterScheme.search(/[/?#]/);
  const authority =
    authorityEnd === -1 ? afterScheme : afterScheme.slice(0, authorityEnd);

  // `urlparse().hostname`: userinfo and port dropped, lowercased, `www.` kept
  // (stripping that is `hostname_normalized`, which the batch upload path
  // deliberately does not use). Read off the text rather than taken from
  // `URL.hostname`, which punycodes an IDN host where Python leaves it alone.
  const hostname = authority
    .slice(authority.lastIndexOf("@") + 1)
    .replace(/:\d*$/, "")
    .toLowerCase();
  if (!hostname) {
    throw createError({ statusCode: 422, message: `Zły adres URL: ${url}` });
  }

  // Likewise the path: `URL.pathname` reports `/` for a url that has no path
  // at all, where `urlparse` reports the empty string — and the two take
  // different branches of the `path if path else "index"` below, so
  // `https://example.pl/` would be filed under `example.pl` rather than
  // `example.pl/index`.
  const rest = authorityEnd === -1 ? "" : afterScheme.slice(authorityEnd);
  const path = rest.startsWith("/") ? rest.split(/[?#]/)[0]! : "";

  return { hostname, path, full: text };
}

/** Python's `str.replace("//", "/")`: one non-overlapping left-to-right pass,
 * not a repeat-until-stable collapse. `split`/`join` has the same semantics;
 * a regex with /g would too, but this says which language it is copying. */
function collapseDoubleSlash(value: string): string {
  return value.split("//").join("/");
}

/** Where a page sits *inside* the archive.
 *
 * `BatchClient.batch_upload` names the member `hostname/path`, and
 * `_member_path_from_url` in `parsed_pipeline.py` recomputes it the same way
 * when it comes to read. Both drop the query string (`include_query` is left
 * false for crawls), so two urls differing only in their query share a member
 * name — harmless here, where each upload carries a single page.
 */
export function crawlMemberPath(url: string): string {
  const { hostname, path } = parseCrawlUrl(url);
  const member = `${hostname}/${path || "index"}`;
  return collapseDoubleSlash(member).replace(/\/+$/, "");
}

/** Where the archive itself sits in the bucket.
 *
 * `hostname=…/date=…/uid_….tar.gz`, the layout `_flush_batch` writes and the
 * hive-style partitioning `CloudStorage` prefixes select on.
 */
export function crawlArchivePath(
  url: string,
  date: string,
  uid: string,
): string {
  const { hostname } = parseCrawlUrl(url);
  return `hostname=${hostname}/date=${date}/uid_${uid}.tar.gz`;
}

/** The Warsaw calendar date, which is what partitions the bucket.
 *
 * The crawler stamps `datetime.now(warsaw_tz)`; a UTC date would put anything
 * captured after 22:00 (23:00 in winter) in the previous day's partition. */
export function warsawDate(now: Date = new Date()): string {
  // en-CA gives YYYY-MM-DD, which is the format the partition uses.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A time-ordered id, in the shape `uuid7str()` produces on the Python side.
 *
 * Only the ordering matters — nothing parses these back — but keeping archives
 * sorted by name keeps a bucket listing chronological. */
export function uuid7(now: Date = new Date()): string {
  const hex = randomUUID().replace(/-/g, "");
  const timestamp = now.getTime().toString(16).padStart(12, "0");
  const rest = hex.slice(12);
  // Version 7, variant 10xx, as uuid7 lays them out.
  const versioned = `7${rest.slice(1, 4)}`;
  const variant = ((parseInt(rest[4]!, 16) & 0x3) | 0x8).toString(16);
  const tail = `${variant}${rest.slice(5)}`;
  return [
    timestamp.slice(0, 8),
    timestamp.slice(8, 12),
    versioned,
    tail.slice(0, 4),
    tail.slice(4, 16),
  ].join("-");
}

const BLOCK = 512;

function octal(value: number, width: number): Buffer {
  // A tar numeric field is octal, NUL-terminated, left-padded with zeros.
  const text = value.toString(8).padStart(width - 1, "0");
  return Buffer.from(`${text}\0`, "ascii");
}

function writeField(header: Buffer, offset: number, value: Buffer): void {
  value.copy(header, offset);
}

/** One 512-byte ustar header. `checksum` is computed over the header with its
 * own checksum field read as spaces, which is how tar defines it. */
function tarHeader(name: string, size: number, typeflag: string): Buffer {
  const header = Buffer.alloc(BLOCK);
  writeField(header, 0, Buffer.from(name, "utf8").subarray(0, 100));
  writeField(header, 100, octal(0o644, 8)); // mode
  writeField(header, 108, octal(0, 8)); // uid
  writeField(header, 116, octal(0, 8)); // gid
  writeField(header, 124, octal(size, 12));
  writeField(header, 136, octal(0, 12)); // mtime, fixed so uploads are reproducible
  header.fill(" ", 148, 156); // checksum placeholder
  writeField(header, 156, Buffer.from(typeflag, "ascii"));
  writeField(header, 257, Buffer.from("ustar\0", "binary"));
  writeField(header, 263, Buffer.from("00", "ascii"));

  let sum = 0;
  for (const byte of header) sum += byte;
  // Six octal digits, NUL, space — the one field that is not plain `octal()`.
  writeField(
    header,
    148,
    Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `, "ascii"),
  );
  return header;
}

function padding(size: number): Buffer {
  const remainder = size % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder);
}

/** A member, with a GNU long-name entry in front of it when the name does not
 * fit tar's 100-byte field.
 *
 * Article paths run past 100 bytes often enough that this is the normal case,
 * not an edge one. `tarfile` reads GNU long names whatever format it writes
 * itself, and `././@LongLink` is less fiddly to emit than a ustar prefix split
 * (which only reaches 255 bytes anyway) or a pax extended header.
 */
function tarEntry(name: string, body: Buffer): Buffer[] {
  const encoded = Buffer.from(name, "utf8");
  if (encoded.length <= 100) {
    return [tarHeader(name, body.length, "0"), body, padding(body.length)];
  }

  const nameBlock = Buffer.concat([encoded, Buffer.from("\0", "ascii")]);
  return [
    tarHeader("././@LongLink", nameBlock.length, "L"),
    nameBlock,
    padding(nameBlock.length),
    tarHeader(name, body.length, "0"),
    body,
    padding(body.length),
  ];
}

export type CrawlArchiveEntry = { memberPath: string; content: Buffer };

/** A gzipped tar in the shape `BatchClient._flush_batch` uploads: the pages,
 * then an `index.txt` listing their member paths, then tar's two empty
 * trailing blocks. */
export function buildCrawlArchive(entries: CrawlArchiveEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    blocks.push(...tarEntry(entry.memberPath, entry.content));
  }

  const index = Buffer.from(
    `${entries.map((entry) => entry.memberPath).join("\n")}\n`,
    "utf8",
  );
  blocks.push(...tarEntry("index.txt", index));
  blocks.push(Buffer.alloc(BLOCK * 2));

  return gzipSync(Buffer.concat(blocks));
}

export function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Where a capture goes when there is no bucket to put it in.
 *
 * `firebase.json` runs no storage emulator, and `USE_EMULATORS` does not reach
 * `firebase-admin/storage` — so a local capture would write a real object into
 * `gs://koryta-pl-crawled`, which the nightly pipeline reads. It would succeed,
 * which is the problem: developing the capture flow would keep feeding the
 * production mirror.
 *
 * So locally the same archive is written to disk instead, under the same
 * `hostname=…/date=…/uid_….tar.gz` name, and the path comes back as a `file://`
 * url. The extractor reads either scheme (`service/storage.py`), so the whole
 * loop runs on one machine with nothing to clean up afterwards.
 */
export function localCaptureRoot(): string {
  return resolve(
    process.env.CAPTURE_LOCAL_DIR || join(tmpdir(), "koryta-captures"),
  );
}

/** True when this process is talking to the emulators rather than to Firebase.
 *
 * Read off the environment rather than off `useRuntimeConfig().public.isLocal`,
 * which is also true under vitest — the unit tests exercise the bucket path,
 * and mock `firebase-admin/storage` to do it.
 */
function useLocalCaptureSink(): boolean {
  return process.env.USE_EMULATORS === "true";
}

/** Stores one captured page where the crawler would have put it.
 *
 * Returns the `gs://` path, which is what `url_store` records as
 * `storage_path` and what `ArticleParsed` later downloads — so the batch
 * pipeline reprocesses a browser-captured page exactly as a crawled one, with
 * no special case anywhere in it.
 */
export async function uploadCapturedPage(options: {
  url: string;
  html: Buffer;
  now?: Date;
}): Promise<{ storagePath: string; blobName: string; htmlSha256: string }> {
  const now = options.now ?? new Date();
  const blobName = crawlArchivePath(options.url, warsawDate(now), uuid7(now));
  const archive = buildCrawlArchive([
    { memberPath: crawlMemberPath(options.url), content: options.html },
  ]);

  let storagePath: string;
  if (useLocalCaptureSink()) {
    const file = join(localCaptureRoot(), blobName);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, archive);
    storagePath = pathToFileURL(file).href;
  } else {
    await getStorage(getApp())
      .bucket(CRAWLED_BUCKET)
      .file(blobName)
      .save(archive, { contentType: "application/gzip" });
    storagePath = `gs://${CRAWLED_BUCKET}/${blobName}`;
  }

  return {
    storagePath,
    blobName,
    htmlSha256: sha256(options.html),
  };
}
