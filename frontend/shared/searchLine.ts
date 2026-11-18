/** The short line the search box draws under a person, so that two people of
 * one name can be told apart before either is opened.
 *
 * Seen 2026-11-10: a reader walking Mielec's town council typed „robert wó”
 * and opened Robert Wójcik of TAURON rather than the Mielec councillor, and
 * „wiśniewski jac” opened a Jacek Wiśniewski of KRAK GAZ rather than Mielec's
 * mayor. Two of the walk's six picks, and nothing on the menu said which was
 * which: `/api/search` sent a person's id, name and type, and the box drew a
 * line under parties only.
 *
 * Where it says, then what: the town or region first, because that is what a
 * reader looking somebody up already knows, then the office or the company.
 * Which of a person's ties it names is `personSearchLine`'s rule.
 *
 * Nothing here reads anything. The search answers from documents it has
 * already read, so the line has to be stored on the person's own document
 * (`stats.searchLine`), by what already holds a person's ties, the names at
 * their far ends and the revisions that say who wrote them:
 * `/api/stats/computeNodes` reads every node, edge and revision anyway. The
 * edge stats sweeper's `getAll` of every target could keep the two scopes of
 * published and all ties fresh in between at no extra read. Nothing writes it
 * yet: what it says is being decided on the design board first (round
 * search-same-name-r1).
 */

import { asArray } from "./model";
import { OTHER_PARTY } from "./misc";
import { mostRecentPost } from "./personTeaser";
import { splitQualifier } from "./search";
import { spellDate } from "./succession";
import {
  candidacyElection,
  electionOptions,
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

/** The node at the far end of a tie, as much of it as the line reads. */
export type LineTarget = {
  type?: string;
  name?: string;
  deleted?: boolean;
};

/** What the line says, stored on the person per scope. */
export type SearchLine = {
  /** The town of the company, or the region of the run: „Jelenia Góra”,
   * „powiat mielecki”. */
  where?: string;
  /** The office won, or the company: „Rada miasta”, „TAURON DYSTRYBUCJA”. */
  what?: string;
  /** The year of the election, or when a post ended: „2024”, „do 2025”. */
  when?: string;
};

/** What `/api/search` sends with a person: the stored line, and the parties
 * the person page prints beside the name. */
export type HitLine = SearchLine & { parties?: string[] };

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

/** A region's name as a line says it: „Gmina Mielec” is the town, „Powiat
 * mielecki” and „Województwo mazowieckie” lose the capital they carry at the
 * start of a page title. */
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

/** A company's register name as a line says it, and the town its bracket
 * names. Where the name carries a name of its own in quotes, the quotes are
 * the company: „PRZEDSIĘBIORSTWO WODOCIĄGÓW I KANALIZACJI "WODNIK"” is
 * „„WODNIK””. */
export function companyName(name: string): { what: string; where?: string } {
  const [called, town] = splitQualifier(name.replace(/\s+/g, " "), "place");
  const quoted = /["„”]([^"„”]{2,})["„”]/u.exec(called);
  const what = quoted ? `„${quoted[1]!.trim()}”` : called.trim();
  return town ? { what, where: town.trim() } : { what };
}

function yearOf(date: string | null | undefined): string | undefined {
  return /^(\d{4})/.exec(date ?? "")?.[1];
}

/** The line for a person, from their ties and the nodes those lead to (keyed
 * by id), or nothing where no tie says anything.
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
 * out reader is sent, all of them for a signed in one.
 */
export function personSearchLine(
  edges: readonly LineEdge[],
  targets: ReadonlyMap<string, LineTarget>,
  today: number,
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
    .toSorted(
      (a, b) =>
        yearOf(b.start_date)!.localeCompare(yearOf(a.start_date)!) ||
        Number(b.elected === true) - Number(a.elected === true) ||
        a.id.localeCompare(b.id),
    );
  const posts = live.filter(
    (edge) =>
      edge.type === "employed" && targets.get(edge.target)?.type === "place",
  );

  const runLine = (run: LineEdge): SearchLine => {
    const where = placeName(targets.get(run.target)!.name!);
    const year = yearOf(run.start_date)!;
    const office = run.position?.trim();
    return run.elected === true && office && office !== "Samorząd"
      ? { where, what: office, when: year }
      : { where, what: "wybory", when: year };
  };
  const postLine = (post: LineEdge, held: boolean): SearchLine => {
    const company = companyName(targets.get(post.target)!.name!);
    const ended = held ? undefined : yearOf(post.end_date);
    return { ...company, ...(ended ? { when: `do ${ended}` } : {}) };
  };

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
  const latestPost = mostRecentPost(posts, today);
  const end = spellDate(latestPost?.end_date);
  if (latestPost && (end === null || end >= today)) {
    return postLine(latestPost, true);
  }

  // The rest by year; on one year a seat won, then a post, then a run.
  const candidates: { year: string; rank: number; line: SearchLine }[] = [];
  if (won[0]) {
    candidates.push({
      year: yearOf(won[0].start_date)!,
      rank: 0,
      line: runLine(won[0]),
    });
  }
  if (latestPost) {
    const ended = yearOf(latestPost.end_date) ?? yearOf(latestPost.start_date);
    if (ended) {
      candidates.push({
        year: ended,
        rank: 1,
        line: postLine(latestPost, false),
      });
    }
  }
  if (runs[0]) {
    candidates.push({
      year: yearOf(runs[0].start_date)!,
      rank: 2,
      line: runLine(runs[0]),
    });
  }
  candidates.sort((a, b) => b.year.localeCompare(a.year) || a.rank - b.rank);
  return candidates[0]?.line;
}

/** The lines stored on a person, one per kind of reader.
 *
 * `approved` and `all` are `personSearchLine` over the published ties and over
 * every tie. `teaser` is the same over the posts alone, and only those an
 * import wrote or a reviewer approved: what the teaser page of an unpublished
 * person shows a logged out reader (`/api/nodes/[id]/teaser`), and absent
 * where that page is a 404. */
export type StoredSearchLines = {
  approved?: SearchLine;
  all?: SearchLine;
  teaser?: SearchLine;
};

/** What `/api/search` sends with a person hit: the line the reader may see,
 * with the parties of a published person.
 *
 * A logged out reader is told of an unpublished person what its teaser page
 * would tell them and no more: the latest post, never a party or a run
 * (`shared/personTeaser.ts`). Nobody is told an unpublished person's parties
 * here: they are PKW matches nobody has checked, and on the 11-18 export the
 * fifteen Krzysztof Nowaks a signed in reader is offered carried up to six
 * each, the same few on most of them - a line that leads with them tells
 * namesakes apart less than one that does not. The line is read off the
 * document the search already holds; it costs no read of its own.
 */
export function hitLine(
  node: {
    type?: string;
    visibility?: boolean;
    parties?: unknown;
    stats?: { searchLine?: StoredSearchLines };
  },
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
  const parties =
    node.visibility === true
      ? asArray(
          node.parties as string[] | Record<string, string> | undefined,
        ).filter((party) => typeof party === "string" && party !== OTHER_PARTY)
      : [];
  const line: HitLine = {
    ...(said?.where ? { where: said.where } : {}),
    ...(said?.what ? { what: said.what } : {}),
    ...(said?.when ? { when: said.when } : {}),
    ...(parties.length > 0 ? { parties } : {}),
  };
  return Object.keys(line).length > 0 ? line : undefined;
}

/** The line as the box prints it. `short` is where alone („PiS · powiat
 * mielecki”), and the full one says what is there too („PiS · powiat
 * mielecki, Rada miasta 2024”). */
export function hitLineText(
  line: HitLine | undefined,
  form: "full" | "short" = "full",
): string {
  if (!line) return "";
  const what = [line.what, line.when].filter(Boolean).join(" ");
  const said =
    form === "short"
      ? (line.where ?? what)
      : [line.where, what].filter(Boolean).join(", ");
  return [line.parties?.join(", "), said].filter(Boolean).join(" · ");
}

/** Which of `names` belong to namesakes: people who share a surname and a
 * given name with another of them. „Jacek Wiśniewski” and „Jacek Andrzej
 * Wiśniewski” both answer „wiśniewski jac”, and „Tomasz Paweł Wiśniewski”
 * stands among four Paweł Wiśniewskis when „paweł wiśniewski” is typed. The
 * surname is the last word, a hyphenated one whole. */
export function namesakes(names: readonly string[]): boolean[] {
  const people = names.map((name) => {
    const words = name.toLocaleLowerCase("pl").split(/\s+/).filter(Boolean);
    return { surname: words.at(-1), given: new Set(words.slice(0, -1)) };
  });
  return people.map((person, index) =>
    people.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.surname === person.surname &&
        [...other.given].some((word) => person.given.has(word)),
    ),
  );
}
