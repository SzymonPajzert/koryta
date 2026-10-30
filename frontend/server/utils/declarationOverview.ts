import { Timestamp } from "firebase-admin/firestore";
import type {
  DocumentSnapshot,
  Firestore,
  Query,
} from "firebase-admin/firestore";
import { warsawDate } from "~~/shared/dates";
import { pageIsPublic } from "~~/shared/model";
import {
  candidacyStatuses,
  extractStatuses,
  publicationHoldReasons,
  type DeclarationOverview,
  type DeclarationPublicationRow,
  type DeclarationReviewRow,
  type ExtractStatus,
  type PublicationHoldReason,
} from "~~/shared/declarations";

/** Why a search found nothing, in the crawler's words
 * (jobs/bip_crawler/people.py). Counted one by one so an unknown code still
 * shows, as what is left over. */
const NOT_FOUND_REASONS = [
  "no_seed",
  "unreachable",
  "robots",
  "no_declarations",
  "not_listed",
  "download_failed",
  "timeout",
  "error",
] as const;

/** Why nothing could be cut from a file, in the cutter's words. */
const FAILED_REASONS = [
  "blank_form",
  "scan_in_word",
  "no_label",
  "blank_field",
  "no_date_line",
  "not_fetched",
  "unreadable",
] as const;

const LIST_SIZE = 20;
const DAYS = 30;

async function count(query: Query): Promise<number> {
  return (await query.count().get()).data().count;
}

/** Counts per code, plus whatever the known codes do not cover. */
async function byReason(
  base: Query,
  codes: readonly string[],
  total: number,
): Promise<{ reason: string; count: number }[]> {
  const counts = await Promise.all(
    codes.map(async (reason) => ({
      reason,
      count: await count(base.where("reason", "==", reason)),
    })),
  );
  const other = total - counts.reduce((sum, row) => sum + row.count, 0);
  return [...counts, ...(other > 0 ? [{ reason: "other", count: other }] : [])]
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * Everything /admin/oswiadczenia shows (see /api/declarations/overview).
 *
 * Counts are Firestore aggregations, billed a read per thousand entries; only
 * the distinct pages and the last month's answers are read document by
 * document, and both are capped.
 *
 * The readers' figures are those of the answers that vote, as a crop's own
 * counts are (`writeSettlement` in server/utils/declarations.ts): an answer
 * without a vote, given without an account or by one nobody confirmed, has
 * no say in what settles, and a browser's reader id is no reader to count.
 */
export async function countEverything(
  db: Firestore,
  dailyLimit: number,
  now: Date,
): Promise<DeclarationOverview> {
  const candidacies = db.collection("declarationCandidacies");
  const extracts = db.collection("declarationExtracts");
  const answers = db.collection("declarationAnswers");
  const publications = db.collection("declarationPublications");
  const since = new Date(now.getTime() - DAYS * 86_400_000);
  const today = warsawDate(now);

  const [
    candidacyTotal,
    candidacyByStatus,
    extractTotal,
    extractByStatus,
    answerTotal,
    pageCounts,
    publicationCounts,
    heldBy,
    todayDoc,
  ] = await Promise.all([
    count(candidacies),
    Promise.all(
      candidacyStatuses.map((status) =>
        count(candidacies.where("status", "==", status)),
      ),
    ),
    count(extracts),
    Promise.all(
      extractStatuses.map((status) =>
        count(extracts.where("status", "==", status)),
      ),
    ),
    count(answers.where("counted", "==", true).where("votes", "==", true)),
    Promise.all(
      (["same", "different", "no_date"] as const).map((match) =>
        count(extracts.where("pageMatch", "==", match)),
      ),
    ),
    Promise.all(
      (["queued", "published", "held", "confirmed", "publishing"] as const).map(
        (status) => count(publications.where("status", "==", status)),
      ),
    ),
    Promise.all(
      publicationHoldReasons.map(async (reason) => ({
        reason,
        count: await count(
          publications
            .where("status", "==", "held")
            .where("reason", "==", reason),
        ),
      })),
    ),
    db.collection("declarationPublishLimits").doc(today).get(),
  ]);

  const statusCount = <T extends string>(
    statuses: readonly T[],
    counts: number[],
  ) =>
    Object.fromEntries(statuses.map((s, i) => [s, counts[i] ?? 0])) as Record<
      T,
      number
    >;
  const byStatus = statusCount(candidacyStatuses, candidacyByStatus);

  const [notFound, failed, people, days, lists, runs] = await Promise.all([
    byReason(
      candidacies.where("status", "==", "not_found"),
      NOT_FOUND_REASONS,
      byStatus.not_found,
    ),
    byReason(
      extracts.where("status", "==", "failed"),
      FAILED_REASONS,
      extractByStatus[extractStatuses.indexOf("failed")] ?? 0,
    ),
    distinctPages(db),
    readingDays(db, since, now),
    reviewLists(db),
    recentRuns(db),
  ]);

  return {
    at: now.toISOString(),
    dailyLimit,
    candidacies: { total: candidacyTotal, people, byStatus, notFound },
    extracts: {
      total: extractTotal,
      byStatus: statusCount(extractStatuses, extractByStatus),
      failed,
    },
    readers: {
      answers: answerTotal,
      readers: days.readers,
      days: days.days,
    },
    pages: {
      same: pageCounts[0] ?? 0,
      different: pageCounts[1] ?? 0,
      noDate: pageCounts[2] ?? 0,
      confirmed: publicationCounts[3] ?? 0,
    },
    publications: {
      // A page being published right now is still the queue's: a pass cut
      // short leaves it there until the next one.
      queued: (publicationCounts[0] ?? 0) + (publicationCounts[4] ?? 0),
      // Every page that went up, the automation's and an admin's press's.
      published: publicationCounts[1] ?? 0,
      held: publicationCounts[2] ?? 0,
      // The automation's slots: a press takes none.
      today: (todayDoc.get("count") as number | undefined) ?? 0,
      heldBy: heldBy.filter((row) => row.count > 0) as {
        reason: PublicationHoldReason;
        count: number;
      }[],
    },
    lists,
    runs,
  };
}

/** How many pages the searches are for. Read document by document - a count
 * cannot see inside the lists - so capped. */
async function distinctPages(db: Firestore): Promise<number> {
  const snapshot = await db
    .collection("declarationCandidacies")
    .select("personIds")
    .limit(20_000)
    .get();
  const pages = new Set<string>();
  for (const doc of snapshot.docs) {
    for (const id of (doc.get("personIds") as string[] | undefined) ?? []) {
      pages.add(id);
    }
  }
  return pages.size;
}

/** Answers that vote and settled crops per Warsaw day over the last month,
 * oldest day first, every day present, and how many readers answered in it.
 *
 * Answers without a vote are read too and passed over: leaving them out of
 * the query would take an index of its own. They take room under the cap,
 * which is why the newest are read first - past it, it is the oldest days
 * that come up short, not today. */
async function readingDays(
  db: Firestore,
  since: Date,
  now: Date,
): Promise<{ readers: number; days: DeclarationOverview["readers"]["days"] }> {
  const [answered, settled] = await Promise.all([
    db
      .collection("declarationAnswers")
      .where("at", ">=", Timestamp.fromDate(since))
      .orderBy("at", "desc")
      .select("day", "uid", "counted", "votes")
      .limit(20_000)
      .get(),
    db
      .collection("declarationExtracts")
      .where("agreed.at", ">=", Timestamp.fromDate(since))
      .select("agreed")
      .limit(20_000)
      .get(),
  ]);

  const days = new Map<string, { answers: number; settled: number }>();
  for (let i = DAYS - 1; i >= 0; i--) {
    days.set(warsawDate(new Date(now.getTime() - i * 86_400_000)), {
      answers: 0,
      settled: 0,
    });
  }
  const readers = new Set<string>();
  for (const doc of answered.docs) {
    if (doc.get("counted") !== true || doc.get("votes") !== true) continue;
    readers.add(String(doc.get("uid")));
    const day = days.get(String(doc.get("day")));
    if (day) day.answers += 1;
  }
  for (const doc of settled.docs) {
    const at = doc.get("agreed.at") as Timestamp | undefined;
    const day = at ? days.get(warsawDate(at.toDate())) : undefined;
    if (day) day.settled += 1;
  }
  return {
    readers: readers.size,
    days: [...days.entries()].map(([day, counts]) => ({ day, ...counts })),
  };
}

type PersonFacts = {
  id: string;
  name: string;
  published: boolean;
  birthDate: string | null;
};

async function peopleById(
  db: Firestore,
  ids: readonly string[],
): Promise<Map<string, PersonFacts>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const snapshots = await db.getAll(
    ...unique.map((id) => db.collection("nodes").doc(id)),
  );
  return new Map(
    snapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [
        snapshot.id,
        {
          id: snapshot.id,
          name: String(snapshot.get("name") ?? snapshot.id),
          published: pageIsPublic(snapshot.data() ?? {}),
          birthDate: (snapshot.get("birthDate") as string | undefined) || null,
        },
      ]),
  );
}

function isoOf(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return typeof value === "string" ? value : "";
}

function reviewRow(
  doc: DocumentSnapshot,
  people: Map<string, PersonFacts>,
): DeclarationReviewRow {
  const data = doc.data() ?? {};
  const unit = Array.isArray(data.units) ? data.units[0] : undefined;
  const readings = Object.entries(
    (data.answers?.readings as Record<string, number> | undefined) ?? {},
  )
    .map(([value, readers]) => ({ value, readers }))
    .sort((a, b) => b.readers - a.readers);
  return {
    id: doc.id,
    unit: unit?.unitName ?? (unit?.teryt ? `TERYT ${unit.teryt}` : ""),
    office: unit?.office ?? null,
    declarationYear: data.declarationYear ?? null,
    documentUrl: String(data.url ?? ""),
    status: data.status as ExtractStatus,
    readings,
    unreadable:
      Number(data.answers?.unreadable ?? 0) + Number(data.answers?.empty ?? 0),
    agreed: (data.agreed?.value as string | undefined) ?? null,
    machine: data.machine
      ? {
          birthDate: data.machine.birthDate ?? null,
          confidence: data.machine.confidence ?? null,
        }
      : null,
    people: ((data.personIds as string[] | undefined) ?? [])
      .map((id) => people.get(id))
      .filter((person): person is PersonFacts => !!person),
    updatedAt: isoOf(data.updatedAt),
  };
}

function publicationRow(
  doc: DocumentSnapshot,
  people: Map<string, PersonFacts>,
): DeclarationPublicationRow {
  const data = doc.data() ?? {};
  const first = Array.isArray(data.declarations) ? data.declarations[0] : {};
  return {
    personId: doc.id,
    name: people.get(doc.id)?.name ?? doc.id,
    status: data.status,
    reason: (data.reason as PublicationHoldReason | undefined) ?? null,
    at: isoOf(data.publishedAt ?? data.heldAt ?? data.queuedAt),
    unit: String(first?.unit ?? ""),
    documentUrl: String(first?.url ?? ""),
    edges: {
      published: Array.isArray(data.edges?.published)
        ? data.edges.published.length
        : 0,
      held: Array.isArray(data.edges?.held) ? data.edges.held.length : 0,
    },
    pressed: typeof data.pressedBy === "string" && data.pressedBy !== "",
  };
}

async function reviewLists(
  db: Firestore,
): Promise<DeclarationOverview["lists"]> {
  const extracts = db.collection("declarationExtracts");
  const publications = db.collection("declarationPublications");
  const [disputed, different, held, recent] = await Promise.all([
    extracts
      .where("status", "==", "disputed")
      .orderBy("updatedAt", "desc")
      .limit(LIST_SIZE)
      .get(),
    extracts
      .where("pageMatch", "==", "different")
      .orderBy("updatedAt", "desc")
      .limit(LIST_SIZE)
      .get(),
    publications
      .where("status", "==", "held")
      .orderBy("queuedAt", "desc")
      .limit(LIST_SIZE)
      .get(),
    publications
      .where("status", "==", "published")
      .orderBy("publishedAt", "desc")
      .limit(LIST_SIZE)
      .get(),
  ]);
  const people = await peopleById(db, [
    ...[...disputed.docs, ...different.docs].flatMap(
      (doc) => (doc.get("personIds") as string[] | undefined) ?? [],
    ),
    ...[...held.docs, ...recent.docs].map((doc) => doc.id),
  ]);
  return {
    disputed: disputed.docs.map((doc) => reviewRow(doc, people)),
    different: different.docs.map((doc) => reviewRow(doc, people)),
    held: held.docs.map((doc) => publicationRow(doc, people)),
    recent: recent.docs.map((doc) => publicationRow(doc, people)),
  };
}

/** The latest uploads, by the cutter's tag and the job run. */
async function recentRuns(db: Firestore): Promise<DeclarationOverview["runs"]> {
  const snapshot = await db
    .collection("declarationExtracts")
    .orderBy("updatedAt", "desc")
    .select("tag", "runId", "updatedAt")
    .limit(300)
    .get();
  const runs = new Map<string, DeclarationOverview["runs"][number]>();
  for (const doc of snapshot.docs) {
    const tag = String(doc.get("tag") ?? "");
    const runId = (doc.get("runId") as string | null | undefined) ?? null;
    const key = `${tag}|${runId}`;
    const at = isoOf(doc.get("updatedAt"));
    const run = runs.get(key) ?? { tag, runId, extracts: 0, at };
    run.extracts += 1;
    if (at > run.at) run.at = at;
    runs.set(key, run);
  }
  return [...runs.values()].sort((a, b) => b.at.localeCompare(a.at));
}
