import { describe, it, expect, vi, afterEach } from "vitest";
import { gunzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCrawlArchive,
  crawlArchivePath,
  crawlMemberPath,
  parseCrawlUrl,
  uploadCapturedPage,
  warsawDate,
  uuid7,
} from "../../../server/utils/crawledBucket";

// `createError` is a Nitro auto-import; the module only reaches for it when a
// url turns out to be unusable, so stubbing it here is soon enough.
vi.stubGlobal(
  "createError",
  (error: { message: string }) => new Error(error.message),
);

/** Reads a ustar/GNU archive far enough to check what was written.
 *
 * Deliberately not a tar library: the point of these tests is that the bytes
 * are what Python's `tarfile` will read, and checking them against a second
 * implementation of the same format is worth more than checking them against
 * the one that produced them.
 */
function readArchive(gz: Buffer): Map<string, string> {
  const tar = gunzipSync(gz);
  const members = new Map<string, string>();
  let offset = 0;
  let pendingLongName: string | null = null;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const readField = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/, "")
        .trim();

    const size = parseInt(readField(124, 12), 8);
    const typeflag = header.subarray(156, 157).toString("ascii");

    // The checksum is over the header with its own field blanked to spaces.
    const stored = parseInt(readField(148, 8), 8);
    const zeroed = Buffer.from(header);
    zeroed.fill(" ", 148, 156);
    let computed = 0;
    for (const byte of zeroed) computed += byte;
    expect(computed, "header checksum").toBe(stored);
    expect(header.subarray(257, 262).toString("ascii")).toBe("ustar");

    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (typeflag === "L") {
      pendingLongName = body.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    members.set(pendingLongName ?? readField(0, 100), body.toString("utf8"));
    pendingLongName = null;
  }
  return members;
}

describe("parseCrawlUrl", () => {
  // Every one of these was checked against NormalizedParse.parse in
  // data/scrapers; see src/service/test_storage.py for the other half.
  it.each([
    ["https://example.pl/", "example.pl", ""],
    ["https://example.pl", "example.pl", ""],
    ["https://www.example.pl/a/b/", "www.example.pl", "/a/b"],
    ["https://example.pl/a?x=1", "example.pl", "/a"],
    ["https://example.pl?x=1", "example.pl", ""],
    ["http://EXAMPLE.pl:8080/A", "example.pl", "/A"],
    ["example.pl/a", "example.pl", "/a"],
    ["https://user:pw@example.pl/a#frag", "example.pl", "/a"],
  ])("%s", (url, hostname, path) => {
    const parsed = parseCrawlUrl(url);
    expect(parsed.hostname).toBe(hostname);
    expect(parsed.path).toBe(path);
  });

  it("keeps www., which the batch upload path does not normalize away", () => {
    expect(parseCrawlUrl("https://www.example.pl/a").hostname).toBe(
      "www.example.pl",
    );
  });

  it("refuses a url with no host", () => {
    expect(() => parseCrawlUrl("http://")).toThrow();
  });
});

describe("crawlMemberPath", () => {
  it("names a page with no path 'index', as the crawler does", () => {
    expect(crawlMemberPath("https://example.pl/")).toBe("example.pl/index");
  });

  it("drops the query, matching _member_path_from_url", () => {
    expect(crawlMemberPath("https://example.pl/a?x=1")).toBe("example.pl/a");
  });

  it("collapses doubled slashes the way Python's str.replace does", () => {
    // One non-overlapping left-to-right pass, not a collapse to stable: for
    // `example.pl///a///b` that leaves `example.pl//a//b`, verified against
    // NormalizedParse. A regex without /g, or a while loop, would each get a
    // different answer here and stop finding the page in its archive.
    expect(crawlMemberPath("https://example.pl//a///b")).toBe(
      "example.pl//a//b",
    );
  });
});

describe("crawlArchivePath", () => {
  it("is the hive layout _flush_batch writes", () => {
    expect(
      crawlArchivePath("https://www.example.pl/a", "2026-08-03", "abc"),
    ).toBe("hostname=www.example.pl/date=2026-08-03/uid_abc.tar.gz");
  });
});

describe("warsawDate", () => {
  it("partitions on the Warsaw day, not the UTC one", () => {
    // 22:30 UTC in August is already the next day in Warsaw; a UTC date would
    // file the capture under a partition the crawler would never use.
    expect(warsawDate(new Date("2026-08-03T22:30:00Z"))).toBe("2026-08-04");
    expect(warsawDate(new Date("2026-08-03T12:00:00Z"))).toBe("2026-08-03");
  });
});

describe("uuid7", () => {
  it("sorts by time", () => {
    const early = uuid7(new Date("2026-01-01T00:00:00Z"));
    const late = uuid7(new Date("2026-08-03T00:00:00Z"));
    expect(early < late).toBe(true);
    expect(early).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/);
  });

  it("does not repeat", () => {
    const now = new Date("2026-08-03T00:00:00Z");
    expect(new Set([uuid7(now), uuid7(now), uuid7(now)]).size).toBe(3);
  });
});

describe("buildCrawlArchive", () => {
  it("writes the page and an index, as a batch upload would", () => {
    const archive = buildCrawlArchive([
      { memberPath: "example.pl/a", content: Buffer.from("<html>a</html>") },
    ]);

    const members = readArchive(archive);
    expect(members.get("example.pl/a")).toBe("<html>a</html>");
    expect(members.get("index.txt")).toBe("example.pl/a\n");
  });

  it("keeps utf-8 content byte-exact", () => {
    const html = "<html>zażółć gęślą jaźń</html>";
    const members = readArchive(
      buildCrawlArchive([
        { memberPath: "example.pl/a", content: Buffer.from(html, "utf8") },
      ]),
    );
    expect(members.get("example.pl/a")).toBe(html);
  });

  it("carries a name past tar's 100 byte field", () => {
    // Article slugs run long routinely, so the GNU long-name path is the
    // normal case rather than an edge one.
    const long = `www.wyborcza.pl/${"a".repeat(140)}.html`;
    expect(long.length).toBeGreaterThan(100);

    const members = readArchive(
      buildCrawlArchive([{ memberPath: long, content: Buffer.from("body") }]),
    );
    expect(members.get(long)).toBe("body");
  });

  it("ends with tar's two empty blocks", () => {
    const tar = gunzipSync(
      buildCrawlArchive([
        { memberPath: "example.pl/a", content: Buffer.from("x") },
      ]),
    );
    expect(tar.length % 512).toBe(0);
    expect(tar.subarray(tar.length - 1024).every((byte) => byte === 0)).toBe(
      true,
    );
  });
});

describe("fragments", () => {
  it("drops the fragment, which is not part of the page's identity", () => {
    // Left on, `url_store` would hold the same article twice — it canonicalises
    // only the scheme and the trailing slash.
    expect(parseCrawlUrl("https://example.pl/a#komentarze").full).toBe(
      "https://example.pl/a",
    );
    expect(crawlMemberPath("https://example.pl/a#komentarze")).toBe(
      "example.pl/a",
    );
  });
});

describe("uploadCapturedPage against the emulators", () => {
  const created: string[] = [];

  afterEach(() => {
    delete process.env.USE_EMULATORS;
    delete process.env.CAPTURE_LOCAL_DIR;
    for (const dir of created.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the archive to disk instead of the production bucket", async () => {
    // There is no storage emulator, so without this a local capture writes a
    // real object into the mirror the nightly pipeline reads.
    const root = mkdtempSync(join(tmpdir(), "koryta-captures-test-"));
    created.push(root);
    process.env.USE_EMULATORS = "true";
    process.env.CAPTURE_LOCAL_DIR = root;

    const url = "https://www.example.pl/artykuł o czymś";
    const { storagePath, blobName } = await uploadCapturedPage({
      url,
      html: Buffer.from("<html>treść</html>", "utf8"),
    });

    expect(storagePath.startsWith("file://")).toBe(true);
    expect(blobName.startsWith("hostname=www.example.pl/date=")).toBe(true);

    // The percent-escaping in the file:// url has to survive the round trip:
    // most Polish article slugs carry a diacritic, and the extractor resolves
    // this path to find the archive.
    const file = fileURLToPath(storagePath);
    expect(file).toBe(join(root, blobName));
    expect(readArchive(readFileSync(file)).get(crawlMemberPath(url))).toBe(
      "<html>treść</html>",
    );
  });
});
