import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { approvedRevisionId, pageIsPublic } from "../../shared/model";
import { withoutInternalFields } from "../../server/utils/revisions";
import { edgeRevisionsForMany } from "../../server/utils/edgePublication";
import { reportRemaining } from "./remaining";

/**
 * Put back what the register says about the jobs a crawl stamped as ended.
 *
 * Until 5fe9e12b (2026-05-05) `end_time()` in
 * `data/pipelines/src/scrapers/krs/list.py` read `data_koniec` with the day
 * PeopleKRS ran as its default, so every post rejestr.io listed as current
 * left that run with the run's date as its end. Two runs reached the site. On
 * the 2026-10-14 export 1,044 `employed` edges end on 2026-04-06 (825) or
 * 2026-03-18 (219) - against a median of two ends a day around them - and the
 * register, matched to the page's person as below, lists 845 of those posts as
 * current. Every one was stamped in the revision that created it, by the
 * uploader, and nothing has stamped since: the 10-12 to 10-14 payloads hold
 * two ends on 03-18, both real.
 *
 * The ingest never rewrites an end it has stored, so the night cannot repair
 * them: it reports 5 to 11 of them a night as `dropped` and keeps them. Pages
 * show those people as having left, and the home chart needs
 * `CRAWL_STAMP_END_DATES` (shared/homeTimeline.ts) to hide a March cliff -
 * which also hides the real 03-18 ends and misses 04-06. That set comes off in
 * a later change, once this has run on production and an export confirms it.
 *
 * The register is `person_krs_combined`, as the night reads it, written by
 * `data/pipelines/src/scripts/register_job_ends.py` to a file outside the
 * repository (it names people). Each stamped edge is matched to its rows on
 * the ingest's own identity - the company's KRS, the role and the start day -
 * and on who the person is:
 *   - a page linking a rejestr.io entry, by that entry, and only by it. A page
 *     linking one entry is never matched to another's rows by name, whatever
 *     the name: one entry is one person.
 *   - a page with no link, by name: the register's full name, or its first
 *     name and surname among the page's words (the page often carries a middle
 *     name the register lacks), with the birth date agreeing where the page
 *     has one - and only where the rows found belong to exactly one entry.
 * Then:
 *   - the register lists the post as current: the end is removed, which is the
 *     shape the ingest writes for an open job.
 *   - the register ends it on another day: that day is written - unless the
 *     row is an old spell and the person's later, still open spell of the same
 *     role at the company has no edge of its own. The stamp there stood for
 *     "still held", and writing the old end would leave the person no current
 *     post at all; those are left for a reviewer.
 *   - anything else is left as it is and listed, by id, under its reason.
 *
 * Each change is filed as a revision with the whole document minus the fields
 * no revision carries (`withoutInternalFields`), by AUTHOR, automatic. An edge
 * that points at a revision - or is live - gets an approved one and its
 * `revision_id` moves to it, as `archive/backfill-parties-source.ts` does and
 * as the ingest files an end it learns; an edge still waiting for its first
 * review gets a pending one with the change applied to the document, which is
 * what the ingest does to a waiting job, so `approveWaitingEdge` and a
 * reviewer's publish still find the revision the edge holds.
 *
 * What it will not do:
 *   - touch an edge with a person's proposal waiting at /admin/rewizje, or one
 *     whose stamp a person entered. Their word stands.
 *   - touch a removed edge, or one whose page or company is gone.
 *   - publish, unpublish or delete anything. A revision is never deleted.
 *   - collapse duplicates. An edge whose new end makes it an exact copy of
 *     another edge of the person is listed for `dedupe-edges.ts`.
 *
 * Expected on the 2026-10-14 02:00 export with the 10-14 05:25 register: 843
 * ends cleared (727 by rejestr.io id, 116 by name), 148 rewritten (139 + 9),
 * 53 left alone (45 no evidence - 9 of them pages linking another entry than
 * the one whose row fits - 5 open spells without an edge, 1 real 03-18 end,
 * 1 pending proposal, 1 removed edge), and 6 rewritten edges becoming exact
 * copies of a sibling. 52 live edges stay stamped, which is the budget
 * `test_invariants.py` holds them to.
 *
 * It stays in scripts/migrate/ rather than archive/ (see the README): it
 * needs the register file, and the 45 without evidence are worth re-checking
 * against a later one.
 *
 * Usage, from frontend/, against the running emulators:prod-data emulator:
 *   npx tsx scripts/migrate/clear-crawl-stamp-job-ends.ts <register.jsonl>           # dry run
 *   npx tsx scripts/migrate/clear-crawl-stamp-job-ends.ts <register.jsonl> --commit
 * Against production:
 *   npx tsx scripts/migrate/clear-crawl-stamp-job-ends.ts <register.jsonl> --prod
 *   npx tsx scripts/migrate/clear-crawl-stamp-job-ends.ts <register.jsonl> --prod --commit
 *
 * Each edge written fires `onEdgeWritten`, which re-reads its person's edges:
 * about a thousand of those, so not in the middle of the night's upload.
 */

const AUTHOR = "migration:clear-crawl-stamp-job-ends";

/** The days PeopleKRS ran before 5fe9e12b and wrote as every open post's end.
 * Found by scoring every employed end on the 2026-10-14 export against the
 * median of the 14 days around it: 825 against 2, and 219 against 2. No other
 * day in 2026 holds more than 13 (2026-07-07). */
export const CRAWL_STAMPS: readonly string[] = ["2026-03-18", "2026-04-06"];

/** One row of the file `register_job_ends.py` writes: one post. */
export type RegisterRow = {
  krs: string;
  /** Who the row is about: one register entry, one person. */
  entry: string;
  rejestrId: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  role: string;
  start: string;
  /** Null where the register lists the post as current. */
  end: string | null;
};

/** As much of a stamped edge as deciding about it needs. */
export type EdgeFacts = {
  id: string;
  source: string;
  /** The role: what `employmentEdge` stores the row's `role` as. */
  name?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  removed: boolean;
};

export type PersonFacts = {
  name: string;
  rejestrIo?: unknown;
  birthDate?: unknown;
  /** Deleted, or merged into another page. */
  gone: boolean;
};

export type CompanyFacts = { krs?: unknown; gone: boolean };

export type RevisionFacts = {
  /** Milliseconds; `update_time`. */
  updateTime: number;
  automatic: boolean;
  updateUser: string;
  status?: string;
  /** The end the revision's data states, as a day; null for none. */
  end: string | null;
};

/** Another employed edge at the same company, not removed. */
export type SiblingFacts = {
  id: string;
  source: string;
  name?: unknown;
  start_date?: unknown;
  /** The register entry the sibling's person page links, if it links one. */
  pageEntry?: string;
};

export type Case = {
  edge: EdgeFacts;
  person: PersonFacts | undefined;
  company: CompanyFacts | undefined;
  revisions: RevisionFacts[];
  /** Every register row at the company's KRS; undefined when the file holds
   * none for it. */
  rows: RegisterRow[] | undefined;
  siblings: SiblingFacts[];
};

export type Via = "rejestr.io id" | "name" | "name words";

/** Why an edge is left as it is, in the order the dry run lists them. */
export const LEAVE_REASONS = {
  removed: "the edge was removed",
  "page gone": "the person's or the company's page is deleted or merged",
  "pending human proposal":
    "a person's proposal on the edge waits for a reviewer at /admin/rewizje",
  "entered by a person": "a person entered this end",
  "real end": "the register ends the post on the stamp day itself",
  "open spell has no edge":
    "the register's end is an old spell's, and the person's later open spell " +
    "of the same role at the company has no edge",
  "register disagrees": "the register's rows for the spell give different ends",
  "end before start": "the register's end is before the edge's start",
  "no evidence: page links another entry":
    "the page links a rejestr.io entry with no row there; only a namesake " +
    "entry's row fits",
  "no evidence: role or start differs":
    "the person is at the company, but no row has the edge's role and start",
  "no evidence: not at the company": "no row of the person at the company",
  "no evidence: name fits two entries":
    "the page has no rejestr.io link and its name fits rows of two entries",
  "no evidence: company has no KRS": "the company has no KRS number",
  "no evidence: company not in the register":
    "the register file has no row for the company",
} as const;

export type LeaveReason = keyof typeof LEAVE_REASONS;

export type Change =
  { action: "clear"; via: Via } | { action: "rewrite"; end: string; via: Via };

export type Decision = Change | { action: "leave"; reason: LeaveReason };

const WARSAW_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A stored date as the day it names, `YYYY-MM-DD`, or null for none.
 *
 * Every writer stores text today, but a Timestamp is read as the Warsaw day
 * it falls on: a date picked as midnight in Poland is stored as 22:00 or
 * 23:00 UTC the evening before. */
export function dayOf(value: unknown): string | null {
  if (value === null || value === undefined || value === "" || value === false)
    return null;
  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}/.exec(value.trim())?.[0] ?? null;
  }
  if (value instanceof Date) return WARSAW_DAY.format(value);
  if (
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return WARSAW_DAY.format((value as Timestamp).toDate());
  }
  return null;
}

/** The register entry a rejestr.io link names: `registerEntry` in the ingest
 * (`server/api/ingest/person.post.ts`), so this and the night agree on which
 * entry a page is. */
export function registerEntry(link: unknown): string | undefined {
  if (typeof link !== "string" || !link) return undefined;
  return /rejestr\.io\/osoby\/(\d+)/.exec(link)?.[1] ?? link;
}

function words(name: string | null | undefined): string[] {
  return (name ?? "")
    .normalize("NFC")
    .toUpperCase()
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The register's full name, as the page spells it. */
function sameName(row: RegisterRow, pageName: string): boolean {
  const theirs = words(row.fullName).join(" ");
  return theirs !== "" && theirs === words(pageName).join(" ");
}

/** The register's first name and every word of its surname among the page's
 * words: a page carrying a middle name the register row does not. */
function nameWordsFit(row: RegisterRow, pageName: string): boolean {
  const page = new Set(words(pageName));
  const first = words(row.firstName)[0];
  const surname = words(row.lastName);
  return (
    first !== undefined &&
    surname.length > 0 &&
    page.has(first) &&
    surname.every((word) => page.has(word))
  );
}

function isHuman(revision: RevisionFacts): boolean {
  return !revision.automatic && !revision.updateUser.startsWith("migration:");
}

/** What to do about one edge, or undefined when its end is not a stamp. */
export function decide(input: Case): Decision | undefined {
  const { edge, person, company, revisions, rows } = input;
  const stamp = dayOf(edge.end_date);
  if (stamp === null || !CRAWL_STAMPS.includes(stamp)) return undefined;
  const leave = (reason: LeaveReason): Decision => ({
    action: "leave",
    reason,
  });

  if (edge.removed) return leave("removed");
  if (!person || person.gone || !company || company.gone) {
    return leave("page gone");
  }
  if (
    revisions.some(
      (revision) => revision.status === "pending" && isHuman(revision),
    )
  ) {
    return leave("pending human proposal");
  }
  if (enteredByAPerson(revisions, stamp)) return leave("entered by a person");

  const krs = String(company.krs ?? "").trim();
  if (!/^\d+$/.test(krs)) return leave("no evidence: company has no KRS");
  if (!rows || rows.length === 0) {
    return leave("no evidence: company not in the register");
  }

  const role = typeof edge.name === "string" ? edge.name : undefined;
  const start = dayOf(edge.start_date);
  const thisSpell = (row: RegisterRow) =>
    role !== undefined && row.role === role && row.start === start;

  // Who the person is, in the register: the rows of their entry at the
  // company, and those of them that are this spell.
  let own: RegisterRow[];
  let spell: RegisterRow[];
  let via: Via;
  const linked = registerEntry(person.rejestrIo);
  if (linked !== undefined) {
    own = rows.filter((row) => row.rejestrId === linked);
    spell = own.filter(thisSpell);
    via = "rejestr.io id";
    if (spell.length === 0) {
      if (own.length > 0) return leave("no evidence: role or start differs");
      const namesake = rows.some(
        (row) => thisSpell(row) && nameWordsFit(row, person.name),
      );
      return leave(
        namesake
          ? "no evidence: page links another entry"
          : "no evidence: not at the company",
      );
    }
  } else {
    const born = dayOf(person.birthDate);
    const isThem = (row: RegisterRow) =>
      (sameName(row, person.name) || nameWordsFit(row, person.name)) &&
      (born === null || row.birthDate === born);
    spell = rows.filter((row) => thisSpell(row) && isThem(row));
    if (spell.length === 0) {
      return leave(
        rows.some(isThem)
          ? "no evidence: role or start differs"
          : "no evidence: not at the company",
      );
    }
    const entries = new Set(spell.map((row) => row.entry));
    if (entries.size > 1) return leave("no evidence: name fits two entries");
    own = rows.filter((row) => entries.has(row.entry));
    via = spell.some((row) => sameName(row, person.name))
      ? "name"
      : "name words";
  }

  const ends = new Set(spell.map((row) => row.end));
  if (ends.size > 1) return leave("register disagrees");
  // One end, shared by every row of the spell.
  const end = spell[0]!.end;
  if (end === null) return { action: "clear", via };
  if (end === stamp) return leave("real end");

  // The same person's later spell in the same role, still open, that no edge
  // of theirs carries: the stamped edge is what stands for it today.
  const entryIds = new Set(
    own.map((row) => row.rejestrId).filter((id): id is string => !!id),
  );
  const carried = new Set(
    input.siblings
      .filter(
        (sibling) =>
          sibling.id !== edge.id &&
          sibling.name === role &&
          (sibling.source === edge.source ||
            (sibling.pageEntry !== undefined &&
              entryIds.has(sibling.pageEntry))),
      )
      .map((sibling) => dayOf(sibling.start_date)),
  );
  const openSpellWithoutEdge = own.some(
    (row) => row.role === role && row.end === null && !carried.has(row.start),
  );
  if (openSpellWithoutEdge) return leave("open spell has no edge");

  if (start !== null && end < start) return leave("end before start");
  return { action: "rewrite", end, via };
}

/** Whether a person, rather than the uploader, put this stamp on the edge: a
 * revision of theirs, not rejected, that changed the end to it. Restating an
 * end the edge already had - the edit form sends the whole edge - is not
 * entering it. */
function enteredByAPerson(revisions: RevisionFacts[], stamp: string): boolean {
  const ordered = [...revisions].sort((a, b) => a.updateTime - b.updateTime);
  let before: string | null | undefined = undefined;
  for (const revision of ordered) {
    if (
      isHuman(revision) &&
      revision.status !== "rejected" &&
      revision.end === stamp &&
      before !== stamp
    ) {
      return true;
    }
    before = revision.end;
  }
  return false;
}

/** As much of an employed edge as telling copies apart needs. */
export type SpellFacts = {
  id: string;
  source: string;
  target: string;
  name?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  removed: boolean;
};

/** The edges a change leaves saying exactly what another live edge says:
 * same person, company, role, start and - after the run - end. They are one
 * spell stored twice, which `dedupe-edges.ts` collapses; listed so they are
 * not mistaken for this script's to delete. */
export function exactCopies(
  edges: SpellFacts[],
  newEnds: Map<string, string | null>,
): { id: string; copyOf: string }[] {
  const endAfter = (edge: SpellFacts) =>
    newEnds.has(edge.id) ? newEnds.get(edge.id)! : dayOf(edge.end_date);
  const key = (edge: SpellFacts) =>
    JSON.stringify([
      edge.source,
      edge.target,
      edge.name ?? null,
      dayOf(edge.start_date),
      endAfter(edge),
    ]);
  const byKey = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.removed) continue;
    byKey.set(key(edge), [...(byKey.get(key(edge)) ?? []), edge.id]);
  }
  const copies: { id: string; copyOf: string }[] = [];
  for (const edge of edges) {
    if (edge.removed || !newEnds.has(edge.id)) continue;
    const other = (byKey.get(key(edge)) ?? [])
      .filter((id) => id !== edge.id)
      .sort()[0];
    if (other) copies.push({ id: edge.id, copyOf: other });
  }
  return copies;
}

/** The register rows in a file `register_job_ends.py` wrote. Lenient, like
 * `fix-stale-seats.ts`'s parser: anything that is not a JSON row with a
 * company, a role and a start is skipped. */
export function parseRegister(text: string): RegisterRow[] {
  const rows: RegisterRow[] = [];
  for (const line of text.split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const start = dayOf(row?.start);
    if (!row?.krs || typeof row.role !== "string" || !start) continue;
    const text = (value: unknown) =>
      value === null || value === undefined || value === ""
        ? null
        : String(value);
    rows.push({
      krs: String(row.krs).padStart(10, "0"),
      entry: String(row.entry ?? `rejestr.io/${row.rejestrId}`),
      rejestrId: text(row.rejestrId),
      fullName: text(row.fullName),
      firstName: text(row.firstName),
      lastName: text(row.lastName),
      birthDate: dayOf(row.birthDate),
      role: row.role,
      start,
      end: dayOf(row.end),
    });
  }
  return rows;
}

const NODE_FIELDS = [
  "name",
  "krsNumber",
  "rejestrIo",
  "birthDate",
  "deleted",
  "merged_into",
];

function millis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}

function gone(data: Record<string, unknown> | undefined): boolean {
  return !data || data.deleted === true || !!data.merged_into;
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");
  const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!file) {
    console.error(
      "Usage: npx tsx scripts/migrate/clear-crawl-stamp-job-ends.ts " +
        "<register.jsonl> [--commit] [--prod]\n" +
        "The register file comes from data/pipelines/src/scripts/register_job_ends.py.",
    );
    process.exit(1);
  }

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

  const register = parseRegister(readFileSync(file, "utf8"));
  const rowsByKrs = new Map<string, RegisterRow[]>();
  for (const row of register) {
    rowsByKrs.set(row.krs, [...(rowsByKrs.get(row.krs) ?? []), row]);
  }
  console.log(
    `${register.length} register posts at ${rowsByKrs.size} companies in ${file}`,
  );

  const employed = await db
    .collection("edges")
    .where("type", "==", "employed")
    .get();
  const stamped = employed.docs.filter((doc) => {
    const end = dayOf(doc.data().end_date);
    return end !== null && CRAWL_STAMPS.includes(end);
  });
  const companies = new Set(stamped.map((doc) => String(doc.data().target)));
  const atThoseCompanies = employed.docs.filter((doc) =>
    companies.has(String(doc.data().target)),
  );

  const nodeIds = [
    ...new Set(
      atThoseCompanies.flatMap((doc) => [
        String(doc.data().source),
        String(doc.data().target),
      ]),
    ),
  ];
  const nodes = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < nodeIds.length; i += 300) {
    const refs = nodeIds
      .slice(i, i + 300)
      .map((id) => db.collection("nodes").doc(id));
    const snaps: DocumentSnapshot[] = await db.getAll(...refs, {
      fieldMask: NODE_FIELDS,
    });
    for (const snap of snaps) if (snap.exists) nodes.set(snap.id, snap.data()!);
  }
  const revisions = await edgeRevisionsForMany(
    db,
    stamped.map((doc) => doc.id),
  );
  console.log(
    `Read ${employed.size} employed edges, ${stamped.length} of them ending on ` +
      `${CRAWL_STAMPS.join(" or ")}, their ${[...revisions.values()].flat().length} ` +
      `revisions and ${nodes.size} pages.`,
  );

  const siblingsAt = new Map<string, SiblingFacts[]>();
  for (const doc of atThoseCompanies) {
    const data = doc.data();
    if (data.deleted === true) continue;
    const target = String(data.target);
    siblingsAt.set(target, [
      ...(siblingsAt.get(target) ?? []),
      {
        id: doc.id,
        source: String(data.source),
        name: data.name,
        start_date: data.start_date,
        pageEntry: registerEntry(nodes.get(String(data.source))?.rejestrIo),
      },
    ]);
  }

  const changes: { doc: QueryDocumentSnapshot; change: Change }[] = [];
  const left = new Map<LeaveReason, string[]>();
  for (const doc of stamped) {
    const data = doc.data();
    const person = nodes.get(String(data.source));
    const company = nodes.get(String(data.target));
    const decision = decide({
      edge: {
        id: doc.id,
        source: String(data.source),
        name: data.name,
        start_date: data.start_date,
        end_date: data.end_date,
        removed: data.deleted === true,
      },
      person: person && {
        name: String(person.name ?? ""),
        rejestrIo: person.rejestrIo,
        birthDate: person.birthDate,
        gone: gone(person),
      },
      company: company && { krs: company.krsNumber, gone: gone(company) },
      revisions: (revisions.get(doc.id) ?? []).map((revision) => ({
        updateTime: millis(revision.update_time),
        automatic: revision.update_automatic === true,
        updateUser: String((revision.update_user as unknown) ?? ""),
        status: revision.status,
        end: dayOf(
          (revision.data as Record<string, unknown> | undefined)?.end_date,
        ),
      })),
      rows: rowsByKrs.get(
        String(company?.krsNumber ?? "")
          .trim()
          .padStart(10, "0"),
      ),
      siblings: siblingsAt.get(String(data.target)) ?? [],
    });
    if (!decision) continue;
    if (decision.action === "leave") {
      left.set(decision.reason, [...(left.get(decision.reason) ?? []), doc.id]);
    } else {
      changes.push({ doc, change: decision });
    }
  }

  const approves = (data: Record<string, unknown>) =>
    approvedRevisionId(data.revision_id) !== undefined || pageIsPublic(data);
  const tally = (action: Change["action"]) => {
    const of = changes.filter(({ change }) => change.action === action);
    const count = (test: (item: (typeof of)[number]) => boolean) =>
      of.filter(test).length;
    return {
      total: of.length,
      byId: count(({ change }) => change.via === "rejestr.io id"),
      byName: count(({ change }) => change.via === "name"),
      byNameWords: count(({ change }) => change.via === "name words"),
      approved: count(({ doc }) => approves(doc.data())),
      published: count(({ doc }) => pageIsPublic(doc.data())),
      onStamp: CRAWL_STAMPS.map(
        (stamp) =>
          `${stamp}: ${count(({ doc }) => dayOf(doc.data().end_date) === stamp)}`,
      ).join(", "),
    };
  };
  const leftCount = [...left.values()].flat().length;

  const newEnds = new Map(
    changes.map(({ doc, change }) => [
      doc.id,
      change.action === "clear" ? null : change.end,
    ]),
  );
  const copies = exactCopies(
    atThoseCompanies.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        source: String(data.source),
        target: String(data.target),
        name: data.name,
        start_date: data.start_date,
        end_date: data.end_date,
        removed: data.deleted === true,
      };
    }),
    newEnds,
  );

  console.log("");
  for (const [label, action] of [
    ["End removed, the register lists the post as current", "clear"],
    ["End rewritten to the register's", "rewrite"],
  ] as const) {
    const t = tally(action);
    console.log(`${label}: ${t.total}`);
    console.log(
      `    matched by rejestr.io id ${t.byId}, by name ${t.byName}, ` +
        `by name words ${t.byNameWords}`,
    );
    console.log(
      `    approved revision ${t.approved} (${t.published} published), ` +
        `pending revision ${t.total - t.approved}`,
    );
    console.log(`    stamped ${t.onStamp}`);
  }

  console.log(`\nLeft alone, for a reviewer (${leftCount}):`);
  for (const reason of Object.keys(LEAVE_REASONS) as LeaveReason[]) {
    const ids = left.get(reason);
    if (!ids) continue;
    console.log(`  ${reason} (${ids.length}): ${LEAVE_REASONS[reason]}`);
    for (const id of [...ids].sort()) console.log(`    ${id}`);
  }

  if (copies.length > 0) {
    console.log(
      `\nAfter the run these say exactly what another edge says - one spell ` +
        `stored twice, for dedupe-edges.ts (${copies.length}):`,
    );
    for (const { id, copyOf } of copies) console.log(`    ${id} = ${copyOf}`);
  }

  const clear = tally("clear").total;
  const rewrite = tally("rewrite").total;
  console.log("");
  console.log(`  ends to remove:                   ${clear}`);
  console.log(`  ends to rewrite:                  ${rewrite}`);
  console.log(`  left alone:                       ${leftCount}`);
  console.log(`  becoming a copy of another edge:  ${copies.length}`);
  console.log(
    "  (measured on the 2026-10-14 02:00 export with the 10-14 05:25 " +
      "register: 843 removed (727 by id, 116 by name), 148 rewritten " +
      "(139 + 9), 53 left alone, 6 copies)",
  );

  if (!commit) {
    reportRemaining({ clear, rewrite });
    console.log("\nDry run. Re-run with --commit to apply.");
    return;
  }

  let batch = db.batch();
  let pending = 0;
  for (const { doc, change } of changes) {
    const data = doc.data();
    const revisionData = withoutInternalFields(data);
    if (change.action === "clear") delete revisionData.end_date;
    else revisionData.end_date = change.end;

    const approve = approves(data);
    const revisionRef = db.collection("revisions").doc();
    const now = Timestamp.now();
    batch.set(revisionRef, {
      node_id: doc.id,
      collection: "edges",
      data: revisionData,
      update_time: now,
      update_user: AUTHOR,
      update_automatic: true,
      status: approve ? "approved" : "pending",
      ...(approve ? { review_user: AUTHOR, review_time: now } : {}),
    });

    // A targeted update rather than the snapshot written back, so nothing this
    // does not change is touched - `published` least of all. Conditional on
    // the edge being as it was read: an edit landing in between fails the run
    // instead of being answered by a revision built from what came before it.
    // A re-run picks up from there.
    const update: Record<string, unknown> = {
      end_date: change.action === "clear" ? FieldValue.delete() : change.end,
    };
    if (approve) update.revision_id = revisionRef;
    batch.update(doc.ref, update, { lastUpdateTime: doc.updateTime });

    pending += 2;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  console.log(
    `\nRemoved ${clear} ends and rewrote ${rewrite}, each with a revision by ${AUTHOR}.`,
  );
  console.log("Re-run the dry run: it must report nothing left to change.");
}

// Importable by the tests, which check the decision without Firestore. Same
// guard as `backfill-parties-source.ts`.
if (process.argv[1]?.endsWith("clear-crawl-stamp-job-ends.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
