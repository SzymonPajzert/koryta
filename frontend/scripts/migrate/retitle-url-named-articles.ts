import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  composedArticleTitle,
  isDocumentUrl,
  isUrlShapedName,
  sourceHost,
} from "../../shared/articleTitle";
import { pageIsPublic } from "../../shared/model";
import { withHttpScheme } from "../../shared/url";
import { reportRemaining } from "./remaining";

/**
 * Gives a real title to the article pages that are named after their address.
 *
 * Where `getPageMeta` read no title - a PDF, a page behind a sign-in wall, one
 * that did not answer - the note editor filed the source under its url, and
 * the url became the article's name: its `<title>`, heading, slug and row in
 * every list. Against the production export of 2026-11-09, 167 of 908 article
 * nodes were named like that, all of them published; 161 are still cited from a
 * note, and two of the other 6 were typed in by hand with no address but their
 * name. Search Console showed them with an address for a headline (237
 * impressions, 7 clicks since 09-01). New ones were still being made, 7 in the
 * first three days of November.
 *
 * The cause is fixed in `ensureArticleNode` (server/utils/articles.ts): an
 * article that arrives without a title, or with its address for one, is titled
 * after who it is filed under and the site it is on, `composedArticleTitle` in
 * shared/articleTitle.ts. This gives the ones already stored a title, in this
 * order:
 *
 *   page    the page's own title, read the way `getPageMeta` reads it - the
 *           first `<title>`, or `og:title` where that one will not do - unless
 *           `usablePageTitle` refuses both: the bare site name a sign-in wall
 *           answers with, an error page's, one that lost its letters.
 *   names   otherwise the people and companies it is filed under - the node
 *           the note citing it hangs off, and its `mentions` relations - with
 *           where it is from: "Tomasz Rosłonek: dokument z bip.karczew.pl".
 *           Public pages only: an article page is public, and its title is no
 *           place to name somebody whose own page is still a draft.
 *   host    with nobody public to name, only where it is from: "Dokument z
 *           bip.karczew.pl", "Strona z linkedin.com".
 *
 * PDFs are not read. A page is fetched as `koryta-article-titles`, only where
 * its site's robots.txt allows it (any 4xx but 429 means there is none, as RFC
 * 9309 says; 429, 5xx or no answer means keep out), one request at a time per
 * site and three seconds apart, and a body that is not HTML is not downloaded.
 * `--no-fetch` skips the pages altogether and composes every title.
 *
 * Left alone, and listed: an article with a proposal still waiting for review
 * (`revisions.has_unapproved`) - approving it afterwards would write the url
 * back over this - and a removed or merged-away one, which nobody reads.
 *
 * Two of the 167, typed in by hand in January and March, have no `sourceURL`
 * at all: the address is only in their name. It is written to `sourceURL` in
 * the same revision, so retitling them does not lose it.
 *
 * Written as an approved revision, like backfill-article-dates.ts and for the
 * same reason: `name` is revision-carried data, and a bare field write would
 * leave the node disagreeing with its approved revision. The slug follows the
 * name, and the article's old address answers with a 301 to the new one
 * (`[seoType]/[slug].vue`). Signed-in readers see the new names at once.
 * Anonymous readers and crawlers are served `/api/nodes/[id]` (and
 * `/api/nodes/[id]/mentions`) from Nitro's cache for up to 6 hours, so for that
 * long the new address can answer 301 back to the old one, computed from the
 * cached old name; it settles by itself when the cache expires, with no loop.
 *
 * Archiving: besides the `../` on the imports, the runtime path in
 * `loadCheerio` (`../../functions/package.json`) needs one more `../`.
 * Typecheck does not see it, and a dry run with nothing to retitle never loads
 * cheerio.
 *
 * Reads titles with cheerio, the parser `getPageMeta` uses, which is a
 * dependency of `functions/` and not of the app: run `npm ci` in functions/
 * first (not needed with `--no-fetch`).
 *
 * Usage (against a running emulator):
 *   npx tsx scripts/migrate/retitle-url-named-articles.ts              # dry run
 *   npx tsx scripts/migrate/retitle-url-named-articles.ts --csv proposals.csv
 *   npx tsx scripts/migrate/retitle-url-named-articles.ts --commit
 * Against production:
 *   npx tsx scripts/migrate/retitle-url-named-articles.ts --prod --csv proposals.csv
 *   npx tsx scripts/migrate/retitle-url-named-articles.ts --prod --commit --csv committed.csv
 * --commit fetches every page again, so its own --csv is the record of what
 * was written, which can differ from the dry run's where a site answers
 * differently the second time.
 *
 * `--commit` fetches the pages again rather than trusting a dry run's file, so
 * what it writes is what the pages say that day.
 */

/** Two writes per article - the revision, and the node pointing at it. */
const BATCH_SIZE = 400;
/** Sites fetched at once; one request at a time within each. */
const HOSTS_AT_ONCE = 4;
/** Between two requests to the same site, robots.txt included. */
const PER_HOST_DELAY_MS = 3_000;
const FETCH_TIMEOUT_MS = 15_000;
/** No `<title>` is further in than this, and nothing past it is read. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** The product token robots.txt groups are matched against. */
export const ROBOTS_AGENT = "koryta-article-titles";
const USER_AGENT = `${ROBOTS_AGENT} (+https://koryta.pl)`;
const AUTHOR = "migration:retitle-url-named-articles";

/** Kept in step with `INTERNAL_FIELDS` in server/utils/revisions.ts, which this
 * script cannot import: that module resolves `~~/` aliases that tsx does not
 * know about outside the Nuxt build. */
const INTERNAL_FIELDS = new Set([
  "stats",
  "revision_id",
  "published",
  "revisions",
  "votes",
  "id",
  "deleted",
  "delete_reason",
  "visibility",
  "merged_into",
  "needs_split",
  "nameChunksLower",
  "content_changed_at",
]);

// ---------------------------------------------------------------------------
// robots.txt

export type RobotsRule = { allow: boolean; path: string };
/** What a site's robots.txt says this script may fetch: its rules, or
 * everything, or nothing. */
export type Robots = RobotsRule[] | "everything" | "nothing";

/** The rules of the groups that name `agent`, or of the `*` groups where none
 * does - RFC 9309, section 2.2.1. Consecutive `user-agent` lines open one group
 * between them, and the rules of every group that matches are combined. */
export function parseRobots(text: string, agent = ROBOTS_AGENT): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | undefined;
  let lastWasAgent = false;

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      current.rules.push({ allow: key === "allow", path: value });
    }
  }

  const named = groups.filter((group) =>
    group.agents.includes(agent.toLowerCase()),
  );
  const chosen = named.length
    ? named
    : groups.filter((group) => group.agents.includes("*"));
  return chosen.flatMap((group) => group.rules);
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/** Whether `robots` lets this script fetch `pathAndQuery`: the longest rule
 * that matches decides, and an allow wins a tie (RFC 9309, section 2.2.2). An
 * empty `Disallow:` forbids nothing. */
export function robotsAllows(robots: Robots, pathAndQuery: string): boolean {
  if (robots === "everything") return true;
  if (robots === "nothing") return false;
  let best: RobotsRule | undefined;
  for (const rule of robots) {
    if (!rule.path || !patternMatches(rule.path, pathAndQuery)) continue;
    if (
      !best ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

/** What a robots.txt response means: any 4xx but 429 is a site with no
 * robots.txt, so everything is allowed; a 429, a 5xx or no answer at all means
 * keep out until it can be read. */
export function robotsFromResponse(
  status: number | undefined,
  text = "",
): Robots {
  if (status !== undefined && status >= 200 && status < 300) {
    return parseRobots(text);
  }
  if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
    return "everything";
  }
  return "nothing";
}

// ---------------------------------------------------------------------------
// Reading a page

/** The page's bytes as text, in the charset its `Content-Type` or a `<meta>`
 * in its head declares, UTF-8 where it declares none. A title that still comes
 * out with U+FFFD in it is refused by `usablePageTitle`, so a page read wrong
 * falls back to a composed title rather than storing garbled letters. */
export function decodeBody(
  bytes: Uint8Array,
  contentType?: string | null,
): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 65_536));
  const label =
    /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? "")?.[1] ??
    /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([^\s"'/>;]+)/i.exec(head)?.[1];
  try {
    return new TextDecoder(label ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Whether a response is a page to read a title from. A missing header is
 * given the benefit of the doubt; a PDF, an image or a download is not. */
export function isHtmlResponse(contentType: string | null): boolean {
  if (!contentType?.trim()) return true;
  return /html/i.test(contentType.split(";")[0]!);
}

type Cheerio = { load: (html: string) => CheerioRoot };
type CheerioRoot = (selector: string) => {
  first: () => { text: () => string };
  attr: (name: string) => string | undefined;
};

let cheerio: Cheerio | undefined;
/** cheerio, as `functions/` resolves it: it is that package's dependency, not
 * the app's. Loaded on first use so `--no-fetch` and the tests need neither. */
function loadCheerio(): Cheerio {
  cheerio ??= createRequire(
    new URL("../../functions/package.json", import.meta.url),
  )("cheerio") as Cheerio;
  return cheerio;
}

/** The titles a page offers, in the order `getPageMeta` would take them. */
function pageTitles(html: string): string[] {
  const $ = loadCheerio().load(html);
  return [
    $("title").first().text(),
    $('meta[property="og:title"]').attr("content") ?? "",
  ].map((title) => title.trim());
}

async function readBody(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.subarray(0, Math.min(size, MAX_BODY_BYTES));
}

/** What fetching an article's address found. */
export type PageOutcome =
  | { kind: "titled"; titles: string[] }
  | { kind: "document"; contentType: string }
  | { kind: "skipped"; reason: string };

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** One site's robots.txt and the time of its last request, so its requests
 * keep their distance. */
class Site {
  private last = 0;
  /** Requests take turns: a redirect can land two sites' worth of work on
   * this one at once. */
  private queue: Promise<void> = Promise.resolve();
  private robots: Promise<Robots> | undefined;
  constructor(private readonly origin: string) {}

  wait(): Promise<void> {
    const turn = this.queue.then(async () => {
      const due = this.last + PER_HOST_DELAY_MS - Date.now();
      if (due > 0) await sleep(due);
      this.last = Date.now();
    });
    this.queue = turn;
    return turn;
  }

  allows(pathAndQuery: string): Promise<boolean> {
    this.robots ??= (async () => {
      await this.wait();
      try {
        const response = await fetch(`${this.origin}/robots.txt`, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        const text = response.ok ? await response.text() : "";
        return robotsFromResponse(response.status, text);
      } catch {
        return robotsFromResponse(undefined);
      }
    })();
    return this.robots.then((robots) => robotsAllows(robots, pathAndQuery));
  }
}

const sites = new Map<string, Site>();
function siteFor(url: URL): Site {
  let site = sites.get(url.origin);
  if (!site) {
    site = new Site(url.origin);
    sites.set(url.origin, site);
  }
  return site;
}

/** Fetches an article's address for its title, as politely as the module
 * comment says. Redirects are followed by hand, so that each hop is checked
 * against its own site's robots.txt. */
export async function fetchPage(address: string): Promise<PageOutcome> {
  let url: URL;
  try {
    url = new URL(withHttpScheme(address.trim()));
  } catch {
    return { kind: "skipped", reason: "not an address" };
  }
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const site = siteFor(url);
      if (!(await site.allows(url.pathname + url.search))) {
        return { kind: "skipped", reason: `robots.txt of ${url.host}` };
      }
      await site.wait();
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => undefined);
        url = new URL(location, url);
        continue;
      }
      const contentType = response.headers.get("content-type");
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { kind: "skipped", reason: `HTTP ${response.status}` };
      }
      if (!isHtmlResponse(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        return { kind: "document", contentType: contentType ?? "" };
      }
      const html = decodeBody(await readBody(response), contentType);
      return { kind: "titled", titles: pageTitles(html) };
    }
    return { kind: "skipped", reason: "too many redirects" };
  } catch (error) {
    return {
      kind: "skipped",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Choosing the title

/** What error pages and bot checks are titled with, whole. Anchored at both
 * ends, so a headline that merely starts with "Błąd" or "500" is not one. */
const NOT_A_TITLE =
  /^(?:[45]\d{2}\b.*(?:not found|forbidden|error|unavailable|unauthorized|gone|gateway).*|access denied.*|attention required.*|just a moment.*|(?:page )?not found|forbidden|error|błąd(?: \d{3})?|nie znaleziono strony|strona nie istnieje|strona główna.*|object moved|redirecting.*|sign in.*|log in.*|zaloguj się.*)$/i;

/** What a page's own title says, when it is a title worth storing, or
 * undefined when it is not.
 *
 * Not worth storing: nothing at all, a title that lost letters to the wrong
 * encoding (U+FFFD), an address, the bare name of the site - which is what a
 * sign-in wall or a single-page app answers with before it renders - a home
 * page's "Strona główna", where a link to a subpage now lands, and the handful
 * of words error pages and bot checks are titled with. Otherwise the title is
 * kept as the page wrote it, its own punctuation and site suffix included, the
 * way `getPageMeta` stores every other title. */
export function usablePageTitle(
  raw: string | null | undefined,
  url: string,
): string | undefined {
  const title = (raw ?? "").replace(/\s+/g, " ").trim();
  if (title.length < 3) return undefined;
  if (title.includes("\uFFFD")) return undefined;
  if (isUrlShapedName(title)) return undefined;

  const host = sourceHost(url);
  const bare = title.toLowerCase().replace(/^www\./, "");
  if (host && (bare === host || host.split(".").includes(bare))) {
    return undefined;
  }
  if (NOT_A_TITLE.test(title)) return undefined;
  return title;
}

export type TitleMethod = "page" | "names" | "host";

/** The title an url-named article gets, and where it came from: the page's
 * own title where it is usable, else one composed from `names` - the public
 * people and companies it is filed under - and the site it is on. */
export function chooseTitle({
  url,
  page,
  names,
}: {
  url: string;
  page?: PageOutcome;
  names: readonly string[];
}): { title: string; method: TitleMethod; detail: string } {
  if (page?.kind === "titled") {
    for (const candidate of page.titles) {
      const title = usablePageTitle(candidate, url);
      if (title) return { title, method: "page", detail: "" };
    }
  }
  const detail = !page
    ? "not fetched"
    : page.kind === "titled"
      ? `page title not usable: ${JSON.stringify(page.titles[0] ?? "")}`
      : page.kind === "document"
        ? `not a page: ${page.contentType}`
        : page.reason;
  const document = page?.kind === "document" ? true : isDocumentUrl(url);
  return {
    title: composedArticleTitle({ url, names, document }),
    method: names.length ? "names" : "host",
    detail,
  };
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Runs `worker` over the groups, `HOSTS_AT_ONCE` of them at a time and the
 * items of each group one after another. */
async function byHost<T>(
  groups: T[][],
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(HOSTS_AT_ONCE, groups.length) }, async () => {
      for (let index = next++; index < groups.length; index = next++) {
        for (const item of groups[index]!) await worker(item);
      }
    }),
  );
}

// ---------------------------------------------------------------------------

interface Candidate {
  id: string;
  name: string;
  sourceURL: string;
  /** The node has no `sourceURL` of its own, so the address in its name is
   * written there before the name stops carrying it. */
  movesAddress: boolean;
  /** Fields to carry into the revision - everything but the node's own
   * bookkeeping. */
  revisionData: Record<string, unknown>;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");
  const fetchPages = !process.argv.includes("--no-fetch");
  const csvPath = argValue("--csv");

  if (!isProd) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
    process.env.GCLOUD_PROJECT = "koryta-pl";
  }
  const app = initializeApp({ projectId: "koryta-pl" });
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run - pass --commit to apply)"),
  );

  const snap = await db
    .collection("nodes")
    .where("type", "==", "article")
    .get();

  const candidates: Candidate[] = [];
  let setAside = 0;
  const awaitingReview: { id: string; name: string }[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!isUrlShapedName(data.name)) continue;
    if (data.deleted === true || data.merged_into) {
      setAside += 1;
      continue;
    }
    if (data.revisions?.has_unapproved === true) {
      awaitingReview.push({ id: doc.id, name: data.name });
      continue;
    }
    const revisionData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!INTERNAL_FIELDS.has(key)) revisionData[key] = value;
    }
    // Two were typed in by hand with the address as the title and no
    // `sourceURL`; their name is the only address they have, and renaming
    // them without moving it would lose it.
    const movesAddress = !(
      typeof data.sourceURL === "string" && data.sourceURL.trim()
    );
    candidates.push({
      id: doc.id,
      name: data.name,
      sourceURL: movesAddress
        ? withHttpScheme(data.name.trim())
        : data.sourceURL,
      movesAddress,
      revisionData,
    });
  }

  console.log(
    `Read ${snap.size} article nodes: ${candidates.length} named after their ` +
      `address` +
      (setAside ? `, ${setAside} more removed or merged away, left alone` : ""),
  );
  if (awaitingReview.length > 0) {
    console.log(
      `\n${awaitingReview.length} left alone because a proposal is waiting for ` +
        `review on /admin/rewizje - review it, then run this again:`,
    );
    for (const { id, name } of awaitingReview) console.log(`  ${id}  ${name}`);
  }
  if (candidates.length === 0) {
    console.log("\nNothing to do.");
    if (!commit) reportRemaining({ retitled: 0 });
    return;
  }

  // Who each one is filed under: the node a note citing it hangs off, then
  // its `mentions`, either way round (the pipeline stores person -> article,
  // the app article -> person).
  const wanted = new Set(candidates.map((candidate) => candidate.id));
  const about = new Map<string, string[]>();
  const add = (articleId: string, nodeId: unknown) => {
    if (typeof nodeId !== "string" || !nodeId || nodeId === articleId) return;
    const list = about.get(articleId) ?? [];
    if (!list.includes(nodeId)) list.push(nodeId);
    about.set(articleId, list);
  };
  const notes = await db.collection("notes").select("nodeId", "sources").get();
  for (const note of notes.docs) {
    const sources = note.get("sources");
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      const articleId = source?.articleNodeId;
      if (wanted.has(articleId)) add(articleId, note.get("nodeId"));
    }
  }
  for (const candidate of candidates) {
    const [outgoing, incoming] = await Promise.all([
      db
        .collection("edges")
        .where("source", "==", candidate.id)
        .where("type", "==", "mentions")
        .get(),
      db
        .collection("edges")
        .where("target", "==", candidate.id)
        .where("type", "==", "mentions")
        .get(),
    ]);
    for (const edge of outgoing.docs) {
      if (edge.get("deleted") !== true) add(candidate.id, edge.get("target"));
    }
    for (const edge of incoming.docs) {
      if (edge.get("deleted") !== true) add(candidate.id, edge.get("source"));
    }
  }

  const nodeIds = Array.from(new Set([...about.values()].flat()));
  const publicName = new Map<string, string>();
  let draftsLeftOut = 0;
  for (let start = 0; start < nodeIds.length; start += 100) {
    const refs = nodeIds
      .slice(start, start + 100)
      .map((id) => db.collection("nodes").doc(id));
    for (const node of await db.getAll(...refs)) {
      const data = node.data();
      if (!data || (data.type !== "person" && data.type !== "place")) continue;
      if (typeof data.name !== "string" || !data.name.trim()) continue;
      if (pageIsPublic(data)) publicName.set(node.id, data.name.trim());
      else draftsLeftOut += 1;
    }
  }

  const pages = new Map<string, PageOutcome>();
  if (fetchPages) {
    const groups = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      let host = "";
      try {
        host = new URL(withHttpScheme(candidate.sourceURL)).host;
      } catch {
        // Fetched on its own; `fetchPage` says why it is not an address.
      }
      groups.set(host, [...(groups.get(host) ?? []), candidate]);
    }
    console.log(
      `\nFetching ${candidates.length} page(s) on ${groups.size} site(s), ` +
        `${HOSTS_AT_ONCE} sites at a time, as ${USER_AGENT}...`,
    );
    let done = 0;
    await byHost([...groups.values()], async (candidate) => {
      pages.set(candidate.id, await fetchPage(candidate.sourceURL));
      done += 1;
      if (done % 25 === 0) console.log(`  ${done}/${candidates.length}`);
    });
  }

  const proposals = candidates.map((candidate) => {
    const names = (about.get(candidate.id) ?? [])
      .map((id) => publicName.get(id))
      .filter((name): name is string => !!name);
    return {
      candidate,
      ...chooseTitle({
        url: candidate.sourceURL,
        page: pages.get(candidate.id),
        names,
      }),
    };
  });
  const writes = proposals.filter(
    (proposal) => proposal.title !== proposal.candidate.name,
  );

  const byMethod = new Map<TitleMethod, number>();
  for (const { method } of writes) {
    byMethod.set(method, (byMethod.get(method) ?? 0) + 1);
  }
  console.log(
    `\n${writes.length} to retitle: ` +
      `${byMethod.get("page") ?? 0} from the page's own title, ` +
      `${byMethod.get("names") ?? 0} after who they are filed under, ` +
      `${byMethod.get("host") ?? 0} after the site alone` +
      (fetchPages ? "" : " (--no-fetch)") +
      (draftsLeftOut
        ? `\n${draftsLeftOut} linked page(s) left out of the titles as drafts`
        : ""),
  );
  for (const { candidate, title, method, detail } of writes) {
    console.log(
      `\n  ${candidate.id}  [${method}]${detail ? `  (${detail})` : ""}`,
    );
    console.log(`      was  ${candidate.name}`);
    console.log(`      now  ${title}`);
    if (candidate.movesAddress) {
      console.log(`      sourceURL  ${candidate.sourceURL} (it had none)`);
    }
  }

  if (csvPath) {
    mkdirSync(dirname(csvPath), { recursive: true });
    const lines = [
      "id,old_name,new_name,method,detail",
      ...proposals.map(({ candidate, title, method, detail }) =>
        [
          candidate.id,
          candidate.name,
          title,
          method,
          candidate.movesAddress
            ? `${detail}; sourceURL set from the name`
            : detail,
        ]
          .map(csvCell)
          .join(","),
      ),
    ];
    writeFileSync(csvPath, lines.join("\n") + "\n");
    console.log(`\nProposals written to ${csvPath}`);
  }

  if (!commit) {
    console.log("\nDry run - nothing written.");
    reportRemaining({ retitled: writes.length });
    return;
  }

  let batch = db.batch();
  let pending = 0;
  let done = 0;
  for (const { candidate, title } of writes) {
    const revisionRef = db.collection("revisions").doc();
    const now = Timestamp.now();
    const fields: Record<string, unknown> = { name: title };
    if (candidate.movesAddress) fields.sourceURL = candidate.sourceURL;
    batch.set(revisionRef, {
      node_id: candidate.id,
      collection: "nodes",
      data: { ...candidate.revisionData, ...fields },
      update_time: now,
      update_user: AUTHOR,
      update_automatic: true,
      // Written already reviewed, and pointed at below, so `computeRevisionsObj`
      // does not read the node as having a change still waiting for approval.
      status: "approved",
      review_user: AUTHOR,
      review_time: now,
    });
    batch.update(db.collection("nodes").doc(candidate.id), {
      ...fields,
      revision_id: revisionRef,
    });

    pending += 2;
    done += 1;
    if (pending >= BATCH_SIZE) {
      await batch.commit();
      console.log(`committed ${done}/${writes.length}`);
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  console.log(`\n${done} article(s) retitled. Done.`);
}

// Importable by the tests, which check robots.txt, decoding and the choice of
// title without touching Firestore or the network.
if (process.argv[1]?.endsWith("retitle-url-named-articles.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
