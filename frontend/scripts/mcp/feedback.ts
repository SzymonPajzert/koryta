/** The feedback queue from /admin/opinie, for agents: read-only, and without
 * anything that says who wrote a report.
 *
 * It answers the way the page does - the same open and settled split, the same
 * queue order, the same "Poprawka" judgement from `shared/feedbackFixes.ts` -
 * so an agent reads the list the admin sees. Reporters' `contact` and
 * `context.userAgent` stay in Firestore, and so does the raw `userUid`, which
 * is read only to become one of the labels in `Reporter`.
 */
import {
  FEEDBACK_ID_PATTERN,
  blocksClosing,
  fixIndex,
  fixState,
  followUpsOf,
  suggestClose,
  type FixState,
} from "../../shared/feedbackFixes";
import {
  OPEN_CAP,
  OPEN_STATUSES,
  SETTLED_STATUSES,
  compareNewest,
  compareQueue,
  isQueued,
  isSettled,
} from "../../shared/feedbackQueue";
import type {
  Feedback,
  FeedbackKind,
  FeedbackStatus,
} from "../../shared/model";
import { QA_ITEMS, type QaCheck, type QaItem } from "../../shared/qa";
import type { Doc, FirestoreReader } from "./firestore-reader";

/** Every field of a report the tools read. Not `contact`, an address the
 * reporter volunteered so that we could reply; not `context.userAgent`; not
 * `slack`, which is the forward's bookkeeping. `userUid` only to say whose
 * report it is - it is never printed. */
export const FEEDBACK_FIELDS = [
  "kind",
  "message",
  "createdAt",
  "adminStatus",
  "adminNote",
  "queueRank",
  "userUid",
  "context.route",
  "context.nodeId",
  "context.pageTitle",
  "context.viewport",
  "context.qa",
] as const;

/** Whose report it is, as much as an agent needs to know. */
export type Reporter = "owner" | "trusted" | "signed-in" | "anonymous";

/** The site owner, whose reports are requests to act on, and a reviewer whose
 * reports the owner wants worked before the rest. Both are admins in
 * data/pipelines/src/set_auth_claims.py. */
const REPORTERS: Readonly<Record<string, Reporter>> = {
  of0BKlwqWLX21Cuml4NMHZ18xoC3: "owner",
  REdyYP4uvMSgCEjdSoiEHqy360G3: "trusted",
};

export function reporterOf(uid: unknown): Reporter {
  if (typeof uid !== "string" || uid === "") return "anonymous";
  return REPORTERS[uid] ?? "signed-in";
}

/** A report as the tools hand it on: no `userUid`, no `contact`. */
export type Report = Omit<Feedback, "userUid" | "contact" | "slack"> & {
  id: string;
  reporter: Reporter;
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** Built field by field, so that nothing the mask let through by mistake
 * travels any further. */
export function toReport({ id, data }: Doc): Report {
  const context = (data.context ?? {}) as Partial<Feedback["context"]>;
  const report: Report = {
    id,
    kind: (text(data.kind) ?? "other") as FeedbackKind,
    message: text(data.message) ?? "",
    createdAt: text(data.createdAt) ?? "",
    adminStatus: (text(data.adminStatus) ?? "new") as FeedbackStatus,
    context: { route: text(context.route) ?? "" },
    reporter: reporterOf(data.userUid),
  };
  const note = text(data.adminNote);
  if (note) report.adminNote = note;
  if (typeof data.queueRank === "number") report.queueRank = data.queueRank;
  const nodeId = text(context.nodeId);
  if (nodeId) report.context.nodeId = nodeId;
  const pageTitle = text(context.pageTitle);
  if (pageTitle) report.context.pageTitle = pageTitle;
  if (context.viewport) {
    const { width, height } = context.viewport;
    report.context.viewport = { width, height };
  }
  if (context.qa) {
    const { itemId, title, status } = context.qa;
    report.context.qa = { itemId, title, status };
  }
  return report;
}

type FixIndex = ReadonlyMap<string, readonly QaItem[]>;
type Verdict = Pick<QaCheck, "itemId" | "status">;

/** From the changelog in this checkout rather than the deployed one, so a
 * claim made on a branch shows here before it shows on the page. */
const FIXES: FixIndex = fixIndex(QA_ITEMS);

async function openReports(db: FirestoreReader) {
  // The list endpoint's query: no orderBy, so the `in` needs no index.
  const docs = await db.query({
    collection: "feedback",
    fields: FEEDBACK_FIELDS,
    where: { field: "adminStatus", in: OPEN_STATUSES },
    limit: OPEN_CAP + 1,
  });
  return {
    reports: docs.slice(0, OPEN_CAP).map(toReport),
    truncated: docs.length > OPEN_CAP,
  };
}

async function closedReports(db: FirestoreReader, limit: number) {
  // Served by the (adminStatus, createdAt DESC) index, as on the page.
  const docs = await db.query({
    collection: "feedback",
    fields: FEEDBACK_FIELDS,
    where: { field: "adminStatus", in: SETTLED_STATUSES },
    orderBy: { field: "createdAt", descending: true },
    limit,
  });
  return docs.map(toReport);
}

/** What checkers found on these QA entries: the verdict, not whose it is. */
async function verdictsOn(
  db: FirestoreReader,
  itemIds: readonly string[],
): Promise<Verdict[]> {
  const ids = [...new Set(itemIds)];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const found = await Promise.all(
    chunks.map((chunk) =>
      db.query({
        collection: "qaChecks",
        fields: ["itemId", "status"],
        where: { field: "itemId", in: chunk },
      }),
    ),
  );
  return found.flat().map(({ data }) => ({
    itemId: String(data.itemId),
    status: data.status as QaCheck["status"],
  }));
}

/** The entry whose verdicts decide each report's fix: the newest claim. */
const claimedEntries = (reports: readonly Report[], fixes: FixIndex) =>
  reports.flatMap((report) => fixes.get(report.id)?.[0]?.id ?? []);

type Fix = {
  entries: readonly QaItem[];
  state: FixState;
  followUps: Feedback[];
  close: boolean;
  blocked: boolean;
};

/** What the "Poprawka" chip on the page says about a report. */
function fixOf(
  report: Report,
  fixes: FixIndex,
  verdicts: readonly Verdict[],
  all: readonly Report[],
): Fix | undefined {
  const entries = fixes.get(report.id);
  if (!entries?.length) return undefined;
  const followUps = followUpsOf(report, entries, all);
  const state = fixState(entries[0]!, verdicts);
  return {
    entries,
    state,
    followUps,
    close: suggestClose(report, state, followUps),
    blocked:
      !isSettled(report) && state === "works" && followUps.some(blocksClosing),
  };
}

const LINK = "https://koryta.pl/admin/opinie#fb-";

/** A message on one line, cut at `length` characters. */
function preview(message: string, length: number): string {
  const line = message.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length).trimEnd()}…` : line;
}

function fixLabel(fix: Fix): string {
  const advice = fix.close
    ? ", can be closed"
    : fix.blocked
      ? ", but a problem found checking it is still open"
      : "";
  return `fix: ${fix.entries[0]!.id} (${fix.state}${advice})`;
}

function row(
  report: Report,
  position: number | undefined,
  fix: Fix | undefined,
  length: number,
): string {
  const { qa, route } = report.context;
  const facts = [
    position !== undefined && `#${position}`,
    report.id,
    report.createdAt.slice(0, 10),
    report.kind,
    report.adminStatus,
    report.reporter,
    route,
    qa && `on /qa: ${qa.itemId} (${qa.status})`,
    fix && fixLabel(fix),
  ].filter(Boolean);
  const lines = [`- ${facts.join(" · ")}`];
  if (length > 0 && report.message) {
    lines.push(`  ${preview(report.message, length)}`);
  }
  if (length > 0 && report.adminNote) {
    lines.push(`  note: ${preview(report.adminNote, length)}`);
  }
  return lines.join("\n");
}

export type Section = "open" | "inbox" | "queue" | "closed";

export type QueueArgs = {
  /** `open` is `inbox` and `queue` together, as the page shows them. */
  section?: Section;
  reporter?: Reporter;
  /** How many closed reports to read, newest first. */
  closed_limit?: number;
  /** Characters of each message to show; 0 for none. */
  preview?: number;
};

/** The reports in one of the page's lists, as lines. */
export async function feedbackQueue(
  db: FirestoreReader,
  args: QueueArgs = {},
  fixes: FixIndex = FIXES,
): Promise<string> {
  const section = args.section ?? "open";
  const length = args.preview ?? 160;
  const [open, closed] = await Promise.all([
    openReports(db),
    section === "closed" ? closedReports(db, args.closed_limit ?? 30) : [],
  ]);
  const all = [...open.reports, ...closed];
  const verdicts = await verdictsOn(db, claimedEntries(all, fixes));

  const list = (title: string, reports: readonly Report[], ranked = false) => {
    // Numbered before filtering, so "#3" is still third in the whole queue.
    const shown = reports
      .map((report, index) => ({ report, position: index + 1 }))
      .filter(
        ({ report }) => !args.reporter || report.reporter === args.reporter,
      );
    const whose = args.reporter ? `, from ${args.reporter}` : "";
    return [
      "",
      `## ${title}: ${shown.length}${whose}`,
      ...shown.map(({ report, position }) =>
        row(
          report,
          ranked ? position : undefined,
          fixOf(report, fixes, verdicts, all),
          length,
        ),
      ),
    ];
  };

  const inbox = open.reports.filter((report) => !isQueued(report));
  const queue = open.reports.filter(isQueued);
  const count = (who: Reporter) =>
    open.reports.filter((report) => report.reporter === who).length;
  const cut = open.truncated
    ? ` (more than ${OPEN_CAP}: the list stops there, as on the page)`
    : "";

  return [
    `Feedback on koryta.pl, read from ${db.source} at ${new Date().toISOString()}.`,
    `Open: ${open.reports.length}${cut} - ${inbox.length} not yet in the queue, ${queue.length} in it.` +
      ` By reporter: owner ${count("owner")}, trusted ${count("trusted")},` +
      ` signed-in ${count("signed-in")}, anonymous ${count("anonymous")}.`,
    `Link a report as ${LINK}<id>. feedback_get has the whole of it.`,
    ...(section === "open" || section === "inbox"
      ? list(
          "Poza kolejką - not in the queue yet, newest first",
          inbox.sort(compareNewest),
        )
      : []),
    ...(section === "open" || section === "queue"
      ? list(
          "Kolejka - the queue, worked from the top",
          queue.sort(compareQueue),
          true,
        )
      : []),
    ...(section === "closed"
      ? list(
          `Zamknięte - closed, newest first, at most ${args.closed_limit ?? 30}`,
          closed.sort(compareNewest),
        )
      : []),
  ].join("\n");
}

/** A report id, from the id or from a link to the report on /admin/opinie. */
export const idFrom = (ref: string): string =>
  ref.trim().replace(/^.*#fb-/, "");

function describe(
  report: Report,
  position: number | undefined,
  fix: Fix | undefined,
  fixes: FixIndex,
) {
  const { qa, ...page } = report.context;
  // A report written on /qa about an entry that claims fixes is a verdict on
  // those fixes.
  const verdictOn = qa
    ? [...fixes]
        .filter(([, entries]) => entries.some(({ id }) => id === qa.itemId))
        .map(([id]) => id)
    : [];
  return {
    id: report.id,
    link: `${LINK}${report.id}`,
    place: isSettled(report)
      ? "closed"
      : position === undefined
        ? "not in the queue yet"
        : `queue #${position}`,
    status: report.adminStatus,
    kind: report.kind,
    createdAt: report.createdAt,
    reporter: report.reporter,
    page,
    writtenOnQa: qa,
    adminNote: report.adminNote,
    fix: fix && {
      claimedBy: fix.entries.map(({ id, title }) => ({ id, title })),
      state: fix.state,
      followUps: fix.followUps.map(({ id }) => id),
      canBeClosed: fix.close,
      blockedByOpenFollowUp: fix.blocked,
    },
    verdictOnFixFor: verdictOn.length > 0 ? verdictOn : undefined,
    message: report.message,
  };
}

/** Whole reports, with where each stands. */
export async function feedbackGet(
  db: FirestoreReader,
  refs: readonly string[],
  fixes: FixIndex = FIXES,
): Promise<string> {
  const ids = [...new Set(refs.map(idFrom))];
  const invalid = ids.filter((id) => !FEEDBACK_ID_PATTERN.test(id));
  const wanted = ids.filter((id) => FEEDBACK_ID_PATTERN.test(id));

  // The open ones are all needed anyway, for places in the queue and for
  // follow-ups; only closed ones are fetched by id.
  const open = await openReports(db);
  const known = new Map(open.reports.map((report) => [report.id, report]));
  const rest = wanted.filter((id) => !known.has(id));
  for (const doc of await db.get("feedback", rest, FEEDBACK_FIELDS)) {
    known.set(doc.id, toReport(doc));
  }
  const all = [...known.values()];
  const found = wanted.flatMap((id) => known.get(id) ?? []);
  const verdicts = await verdictsOn(db, claimedEntries(found, fixes));
  const positions = new Map(
    open.reports
      .filter(isQueued)
      .sort(compareQueue)
      .map((report, index) => [report.id, index + 1]),
  );
  const notFound = wanted.filter((id) => !known.has(id));

  return JSON.stringify(
    {
      source: db.source,
      readAt: new Date().toISOString(),
      reports: found.map((report) =>
        describe(
          report,
          positions.get(report.id),
          fixOf(report, fixes, verdicts, all),
          fixes,
        ),
      ),
      notFound: notFound.length > 0 ? notFound : undefined,
      notAReportId: invalid.length > 0 ? invalid : undefined,
    },
    null,
    2,
  );
}
