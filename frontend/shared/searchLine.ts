/** The short line the search box draws under every person it offers, so that
 * two people of one name can be told apart before either is opened.
 *
 * Seen 2026-11-10: a reader walking Mielec's town council typed „robert wó”
 * and opened Robert Wójcik of TAURON rather than the Mielec councillor, and
 * „wiśniewski jac” opened a Jacek Wiśniewski of KRAK GAZ rather than Mielec's
 * mayor. Two of the walk's six picks, and nothing on the menu said which was
 * which: `/api/search` sent a person's id, name and type, and the box drew a
 * line under parties only.
 *
 * One line, the town first, under every person: decided 2026-11-18 on board
 * rounds search-same-name-r1 and -r2. The town is what a reader looking
 * somebody up already knows. Then the party of a published person, then the
 * office or the company: „Mielec · PiS · Rada miasta 2024”. Which tie the line
 * names is `personSearchLine`'s rule, and which town `lineTown`'s.
 *
 * The search answers from documents it has already read, so the line is
 * stored on the person's own document (`stats.searchLine`) by
 * `/api/stats/computeNodes`, the one place that already holds every tie, the
 * nodes at their far ends, the seat and owner edges of those and the
 * revisions that say who wrote them (`storedSearchLines`). That makes a line
 * only as fresh as the last run, so the search checks it against the
 * person's edge stats, which the edge stats sweeper keeps current within a
 * minute of any change, and drops a line about a tie that has gone
 * (`hitLine`).
 */

import {
  asArray,
  pageIsPublic,
  type SearchLine,
  type StoredSearchLines,
} from "./model";
import { OTHER_PARTY } from "./misc";
import { mostRecentPost } from "./personTeaser";
import { splitQualifier } from "./search";
import { spellDate } from "./succession";
import {
  candidacyElection,
  electionOptions,
  electionResultKey,
  type ElectionKey,
} from "./electionDays";

/** One of a person's ties, as much of it as the line reads: an `employed` or
 * an `election` edge. */
export type LineEdge = {
  id: string;
  source: string;
  type?: string;
  target: string;
  /** The role, on a post. */
  name?: string | null;
  /** The office, on a candidacy. */
  position?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  elected?: boolean | null;
  by_election?: boolean | null;
  deleted?: boolean;
};

/** A node the line reads: the far end of a tie, or a region a company sits in
 * or belongs to. */
export type LineTarget = {
  type?: string;
  name?: string;
  deleted?: boolean;
  /** A region's TERYT code: 2 digits a województwo, 4 a powiat or a city
   * with powiat rights, 7 a gmina. */
  teryt?: string;
  /** A company's registered seat: the region its `seat` edge comes from, a
   * powiat or a city with powiat rights for most of them. */
  seat?: string;
  /** The regions that own a company, by their `owns` edges. */
  owners?: readonly string[];
};

/** The nodes the line reads, by id. A `Map` is one. */
export type LineTargets = { get(id: string): LineTarget | undefined };

export type { SearchLine, StoredSearchLines };

/** What `/api/search` sends with a person: the line, and the parties the
 * person page prints beside the name. */
export type HitLine = Pick<SearchLine, "where" | "what" | "when"> & {
  parties?: string[];
};

/** The newest election of each kind the site records - a seat won in one of
 * these is a seat held now. */
const LATEST_ELECTIONS: ReadonlySet<ElectionKey> = new Set(
  electionOptions
    .filter(
      (option, index, all) =>
        all.findIndex(
          (other) => other.value.split("-")[0] === option.value.split("-")[0],
        ) === index,
    )
    .map((option) => option.value),
);

/** A region's name as a line says it: „Gmina Mielec” and „Miasto Warszawa”
 * are the town, „Powiat mielecki” and „Województwo mazowieckie” lose the
 * capital they carry at the start of a page title. */
export function placeName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  const gmina = /^(?:Gmina|Miasto)\s+(.+)$/u.exec(trimmed);
  if (gmina) return gmina[1]!;
  const powiat = /^Powiat\s+(.+)$/u.exec(trimmed);
  if (powiat) return `powiat ${powiat[1]}`;
  const wojewodztwo = /^Województwo\s+(.+)$/iu.exec(trimmed);
  if (wojewodztwo) return wojewodztwo[1]!.toLowerCase();
  return trimmed;
}

/** A company's register name as a line says it: without the town its bracket
 * names, and where it carries a name of its own in quotes, the quotes alone -
 * „PRZEDSIĘBIORSTWO WODOCIĄGÓW I KANALIZACJI "WODNIK"” is „„WODNIK””. */
export function companyName(name: string): string {
  const [called] = splitQualifier(name.replace(/\s+/g, " "), "place");
  const quoted = /["„”]([^"„”]{2,})["„”]/u.exec(called);
  return quoted ? `„${quoted[1]!.trim()}”` : called.trim();
}

/** The town a region is, or nothing for a region that is no town: a gmina
 * and a city with powiat rights are one, a powiat and a województwo are not. */
function regionTown(region: LineTarget | undefined): string | undefined {
  if (!region?.name || region.deleted === true) return undefined;
  const code = region.teryt ?? "";
  if (code.length === 7) return placeName(region.name);
  if (code.length === 4 && !/^Powiat\s/u.test(region.name.trim())) {
    return placeName(region.name);
  }
  return undefined;
}

/** Where a tie is: the town, where one can be named, the TERYT code of the
 * region it lies in, and that region as a line says it. */
type Place = { town?: string; area?: string; region?: string };

function regionPlace(region: LineTarget): Place {
  return {
    town: regionTown(region),
    area: region.teryt,
    region: region.name ? placeName(region.name) : undefined,
  };
}

/** Where a company is. The town in its name's bracket, which is the seat the
 * register gives; else its seat, where that is a town; else the one gmina
 * inside its seat that owns it, or the one town of several - a company a
 * single gmina owns is that gmina's. Most seats are a powiat, which is no
 * town: „CECH RZEMIOSŁ RÓŻNYCH W SZTUMIE” has nothing but powiat sztumski. */
function companyPlace(company: LineTarget, targets: LineTargets): Place {
  const [, bracket] = splitQualifier(
    (company.name ?? "").replace(/\s+/g, " "),
    "place",
  );
  const seat = company.seat ? targets.get(company.seat) : undefined;
  const within = (code: string | undefined) =>
    !seat?.teryt || (code ?? "").startsWith(seat.teryt);
  const gminas = (company.owners ?? [])
    .map((id) => targets.get(id))
    .filter(
      (region): region is LineTarget =>
        region?.teryt?.length === 7 && within(region.teryt),
    );
  const towns = gminas.filter((region) => region.teryt!.endsWith("1"));
  const owner =
    gminas.length === 1 ? gminas[0] : towns.length === 1 ? towns[0] : undefined;
  return {
    town: bracket.trim() || regionTown(seat) || regionTown(owner),
    area: seat?.teryt ?? owner?.teryt,
    region: seat?.name ? placeName(seat.name) : undefined,
  };
}

function yearOf(date: string | null | undefined): string | undefined {
  return /^(\d{4})/.exec(date ?? "")?.[1];
}

/** The town a line leads with, for the tie it names, and the tie it came
 * from where that is another one.
 *
 * The tie's own, where it has one. A run is filed under the powiat it was in,
 * which is no town - every local run is, „Rada miasta” in Mielec included -
 * so failing that, the town of the person's latest other tie inside the
 * same region: a run under „Powiat mielecki” beside a post at a company in
 * Mielec is Mielec. Failing both, the region itself, which is true if it
 * says less. */
function lineTown(
  subject: LineEdge,
  byRecency: readonly LineEdge[],
  placeOf: (edge: LineEdge) => Place,
): { where?: string; from?: string } {
  const own = placeOf(subject);
  if (own.town) return { where: own.town };
  if (own.area) {
    for (const tie of byRecency) {
      if (tie.id === subject.id) continue;
      const place = placeOf(tie);
      if (place.town && place.area?.startsWith(own.area)) {
        return { where: place.town, from: tie.target };
      }
    }
  }
  return own.region ? { where: own.region } : {};
}

/** The line for a person, from their ties and the nodes the line reads, or
 * nothing where no tie says anything.
 *
 * Which tie, in this order:
 * 1. a seat won in the newest election of its kind - the office they hold now,
 *    which is what most readers know a politician by;
 * 2. a post held now, by the teaser's rule (`mostRecentPost`);
 * 3. the latest of the rest by its year: a seat won earlier, a post that has
 *    ended, a run that won nothing. A run with no recorded win is not called
 *    by its office, since „Prezydent” over a lost race would read as the job.
 *
 * `edges` are the ties of one scope: the published ones for the line a logged
 * out reader is sent, all of them for a signed in one. With `lead` „post”, the
 * latest post comes before anything else, and a run only where there is no
 * post at all - what an unpublished person's line does (`storedSearchLines`).
 */
export function personSearchLine(
  edges: readonly LineEdge[],
  targets: LineTargets,
  today: number,
  lead: "office" | "post" = "office",
): SearchLine | undefined {
  const live = edges.filter((edge) => {
    if (edge.deleted === true) return false;
    const target = targets.get(edge.target);
    return !!target && target.deleted !== true && !!target.name;
  });
  const runs = live
    .filter(
      (edge) =>
        edge.type === "election" &&
        targets.get(edge.target)?.type === "region" &&
        yearOf(edge.start_date),
    )
    // `sort` on the copy `filter` made, not `toSorted`: functions/ builds
    // shared/ too, for an ES2022 that does not have it.
    .sort(
      (a, b) =>
        yearOf(b.start_date)!.localeCompare(yearOf(a.start_date)!) ||
        Number(b.elected === true) - Number(a.elected === true) ||
        a.id.localeCompare(b.id),
    );
  const posts = live.filter(
    (edge) =>
      edge.type === "employed" && targets.get(edge.target)?.type === "place",
  );

  // Every tie, latest first: posts still held, then by when each ended or
  // was run, for the town of a tie that names none (`lineTown`).
  const held = (edge: LineEdge) => {
    const end = spellDate(edge.end_date);
    return end === null || end >= today;
  };
  const lastSeen = (edge: LineEdge) =>
    edge.type === "employed"
      ? held(edge)
        ? Number.MAX_SAFE_INTEGER
        : (spellDate(edge.end_date) ?? 0)
      : Date.parse(`${yearOf(edge.start_date)}-12-31`);
  const byRecency = [...posts, ...runs].sort(
    (a, b) => lastSeen(b) - lastSeen(a) || a.id.localeCompare(b.id),
  );
  const placeOf = (edge: LineEdge): Place => {
    const target = targets.get(edge.target)!;
    return edge.type === "employed"
      ? companyPlace(target, targets)
      : regionPlace(target);
  };

  /** The fields a line has, and none it does not: Firestore refuses a map
   * holding an undefined value. */
  const line = (
    subject: LineEdge,
    what: string,
    when: string | undefined,
    election?: string,
  ): SearchLine => {
    const { where, from } = lineTown(subject, byRecency, placeOf);
    return {
      ...(where ? { where } : {}),
      what,
      ...(when ? { when } : {}),
      ties: from ? [subject.target, from] : [subject.target],
      ...(election ? { election } : {}),
    };
  };
  const runLine = (run: LineEdge): SearchLine => {
    const office = run.position?.trim();
    const what =
      run.elected === true && office && office !== "Samorząd"
        ? office
        : "wybory";
    const key = candidacyElection(
      run.start_date,
      run.position,
      run.by_election,
    );
    const filed =
      key === null
        ? undefined
        : run.elected === true
          ? electionResultKey(key, "won")
          : key;
    return line(run, what, yearOf(run.start_date), filed);
  };
  const postLine = (post: LineEdge, isHeld: boolean): SearchLine => {
    const ended = isHeld ? undefined : yearOf(post.end_date);
    return line(
      post,
      companyName(targets.get(post.target)!.name!),
      ended ? `do ${ended}` : undefined,
    );
  };

  const latestPost = mostRecentPost(posts, today);
  if (lead === "post" && latestPost) {
    return postLine(latestPost, held(latestPost));
  }

  const won = runs.filter((run) => run.elected === true);
  const seatNow = won.find((run) => {
    const key = candidacyElection(
      run.start_date,
      run.position,
      run.by_election,
    );
    return key !== null && LATEST_ELECTIONS.has(key);
  });
  if (seatNow) return runLine(seatNow);

  // Held as the teaser counts it: no end, or an end still ahead.
  if (latestPost && held(latestPost)) return postLine(latestPost, true);

  // The rest by year; on one year a seat won, then a post, then a run.
  const candidates: { year: string; rank: number; line: () => SearchLine }[] =
    [];
  if (won[0]) {
    const run = won[0];
    candidates.push({
      year: yearOf(run.start_date)!,
      rank: 0,
      line: () => runLine(run),
    });
  }
  if (latestPost) {
    const ended = yearOf(latestPost.end_date) ?? yearOf(latestPost.start_date);
    if (ended) {
      candidates.push({
        year: ended,
        rank: 1,
        line: () => postLine(latestPost, false),
      });
    }
  }
  if (runs[0]) {
    const run = runs[0];
    candidates.push({
      year: yearOf(run.start_date)!,
      rank: 2,
      line: () => runLine(run),
    });
  }
  candidates.sort((a, b) => b.year.localeCompare(a.year) || a.rank - b.rank);
  return candidates[0]?.line();
}

/** The lines `/api/stats/computeNodes` stores on a person, from every edge it
 * holds of theirs: the published ones for a logged out reader of a published
 * page, all of them for a signed in reader, and for a logged out reader of an
 * unpublished page only the posts its teaser may show - those
 * `importedOrReviewed` passes, of a person it passes, as the teaser route asks
 * them (server/utils/provenance.ts). A scope with nothing to say is left out,
 * so an empty object is a person with no line at all.
 *
 * A signed in reader's line for an unpublished person leads with the latest
 * post too, as the logged out one does, and names a run only where there is
 * no post (decision on 2026-11-18). Its runs are PKW matches nobody has
 * checked, and one run often sits on several namesakes: on the 11-18 export,
 * three Paweł Wiśniewski drafts all read „powiat brodnicki · Rada gminy 2024”,
 * and lines led by the run told 96% of same-name pairs apart against 99% for
 * the post. A published person's line is unchanged. */
export function storedSearchLines(
  person: {
    id: string;
    revision_id?: unknown;
    published?: unknown;
    deleted?: unknown;
  },
  edges: readonly (LineEdge & { published?: unknown; revision_id?: unknown })[],
  targets: LineTargets,
  importedOrReviewed: (doc: { id: string; revision_id?: unknown }) => boolean,
  today: number,
): StoredSearchLines {
  const own = edges.filter(
    (edge) => edge.source === person.id && edge.deleted !== true,
  );
  const teaser = importedOrReviewed(person)
    ? own.filter((edge) => edge.type === "employed" && importedOrReviewed(edge))
    : [];
  const approved = personSearchLine(
    own.filter((edge) => pageIsPublic(edge)),
    targets,
    today,
  );
  const all = personSearchLine(
    own,
    targets,
    today,
    pageIsPublic(person) ? "office" : "post",
  );
  const shown = personSearchLine(teaser, targets, today);
  return {
    ...(approved ? { approved } : {}),
    ...(all ? { all } : {}),
    ...(shown ? { teaser: shown } : {}),
  };
}

/** The part of a person's document the line is read off: what
 * `stats.searchLine` holds, the edge stats it is checked against, the
 * parties, and whether the page is published. */
export type SearchLineNode = {
  type?: string;
  visibility?: boolean;
  parties?: unknown;
  stats?: {
    searchLine?: StoredSearchLines;
    edges?: {
      all?: { targetNodeIds?: unknown; elections?: unknown };
      approved?: { targetNodeIds?: unknown; elections?: unknown };
    };
  };
};

/** What `/api/search` sends with a person hit: the line the reader may see,
 * with the parties of a published person.
 *
 * A logged out reader is told of an unpublished person what its teaser page
 * would tell them and no more: the latest post, never a party or a run
 * (`shared/personTeaser.ts`), as decided 2026-11-18 on board round
 * search-same-name-r1. Nobody is told an unpublished person's parties here:
 * they are PKW matches nobody has checked, and on the 11-18 export the
 * fifteen Krzysztof Nowaks a signed in reader is offered carried up to six
 * each, the same few on most of them.
 *
 * A stored line is as old as the last computeNodes run, and the edge stats
 * beside it are current, so a line whose tie has left the person's ties, or
 * whose election has, is not sent: a namesake's run taken off a page must not
 * go on naming them in the box. The parties are read off the page as it is.
 * All of it from the document the search already holds; no read of its own.
 */
export function hitLine(
  node: SearchLineNode,
  includeDrafts: boolean,
): HitLine | undefined {
  if (node.type !== "person") return undefined;
  const stored = node.stats?.searchLine;
  const teaserOnly = !includeDrafts && node.visibility !== true;
  const said = teaserOnly
    ? stored?.teaser
    : includeDrafts
      ? stored?.all
      : stored?.approved;
  const scope =
    includeDrafts || teaserOnly
      ? node.stats?.edges?.all
      : node.stats?.edges?.approved;
  const current =
    !!said &&
    (said.ties ?? []).every((id) =>
      asArray(scope?.targetNodeIds as string[] | undefined).includes(id),
    ) &&
    (!said.election ||
      asArray(scope?.elections as string[] | undefined).includes(
        said.election,
      ));
  const parties =
    node.visibility === true
      ? asArray(
          node.parties as string[] | Record<string, string> | undefined,
        ).filter((party) => typeof party === "string" && party !== OTHER_PARTY)
      : [];
  const line: HitLine = {
    ...(current && said.where ? { where: said.where } : {}),
    ...(current && said.what ? { what: said.what } : {}),
    ...(current && said.when ? { when: said.when } : {}),
    ...(parties.length > 0 ? { parties } : {}),
  };
  return Object.keys(line).length > 0 ? line : undefined;
}

/** The line as the box prints it: the town, the parties, then what and when.
 * „Mielec · PiS · Rada miasta 2024”, „Jelenia Góra · „WODNIK” do 2025”. */
export function hitLineText(line: HitLine | undefined): string {
  if (!line) return "";
  return [
    line.where,
    line.parties?.join(", "),
    [line.what, line.when].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");
}
