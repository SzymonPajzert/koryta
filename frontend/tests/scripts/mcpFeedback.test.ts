// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  FEEDBACK_FIELDS,
  feedbackGet,
  feedbackQueue,
  idFrom,
  reporterOf,
} from "../../scripts/mcp/feedback";
import type {
  Doc,
  FirestoreReader,
  ReadQuery,
} from "../../scripts/mcp/firestore-reader";
import type { QaItem } from "../../shared/qa";

const OWNER = "of0BKlwqWLX21Cuml4NMHZ18xoC3";
const TRUSTED = "REdyYP4uvMSgCEjdSoiEHqy360G3";
const STRANGER = "strangerUid0000000000001";
const CONTACT = "someone@example.com";
const USER_AGENT = "Mozilla/5.0 (X11) unique-user-agent";

/** A well-formed feedback id: Firestore auto-ids are 20 alphanumerics. */
const fid = (tag: string) => tag.padEnd(20, "0");

const INBOX_OLD = fid("inboxOld");
const INBOX_NEW = fid("inboxNew");
const QUEUE_FIRST = fid("queueFirst");
const QUEUE_SECOND = fid("queueSecond");
const CLOSED_OLD = fid("closedOld");
const CLOSED_NEW = fid("closedNew");
const FOLLOW_UP = fid("followUp");

/** A stored report, with everything a real one carries - including what the
 * tools must never pass on. */
const stored = (fields: Record<string, unknown>) => ({
  kind: "bug",
  message: "Coś nie działa",
  createdAt: "2026-09-01T10:00:00.000Z",
  adminStatus: "new",
  contact: CONTACT,
  slack: { state: "sent", ts: "1727000000.000100" },
  ...fields,
  context: {
    route: "/",
    userAgent: USER_AGENT,
    ...(fields.context as object),
  },
});

const LONG = "Wykres na stronie osoby nachodzi na tabelę. ".repeat(8);

const FEEDBACK = {
  [INBOX_OLD]: stored({ createdAt: "2026-09-01T10:00:00.000Z" }),
  [INBOX_NEW]: stored({
    createdAt: "2026-09-05T10:00:00.000Z",
    userUid: STRANGER,
    kind: "idea",
  }),
  [QUEUE_FIRST]: stored({
    createdAt: "2026-09-03T10:00:00.000Z",
    adminStatus: "in_progress",
    queueRank: 1024,
    userUid: OWNER,
    message: LONG,
    context: { route: "/osoba/jan", pageTitle: "Jan", nodeId: "jan1" },
  }),
  [QUEUE_SECOND]: stored({
    createdAt: "2026-09-02T10:00:00.000Z",
    queueRank: 2048,
    userUid: TRUSTED,
    adminNote: "Najpierw projekt.",
  }),
  [CLOSED_OLD]: stored({
    createdAt: "2026-08-20T10:00:00.000Z",
    adminStatus: "resolved",
    queueRank: 512,
    userUid: OWNER,
  }),
  [CLOSED_NEW]: stored({
    createdAt: "2026-09-04T10:00:00.000Z",
    adminStatus: "wont_fix",
    userUid: STRANGER,
  }),
  [FOLLOW_UP]: stored({
    createdAt: "2026-09-06T10:00:00.000Z",
    userUid: OWNER,
    message: "Nadal nachodzi.",
    context: {
      route: "/qa",
      qa: { itemId: "wykres-osoby", title: "Wykres", status: "issue" },
    },
  }),
};

const QA_CHECKS = {
  [`wykres-osoby_${STRANGER}`]: {
    itemId: "wykres-osoby",
    userUid: STRANGER,
    status: "ok",
  },
};

const entry = (id: string, fixes: string[]): QaItem => ({
  id,
  title: `entry ${id}`,
  description: "d",
  steps: ["s"],
  area: "public",
  fixes,
});

const FIXES = new Map([[QUEUE_FIRST, [entry("wykres-osoby", [QUEUE_FIRST])]]]);

type Stored = Record<string, Record<string, Record<string, unknown>>>;

/** Firestore, minus the field mask: it hands back whole documents, so the
 * tests show that what the tools print is chosen by the tools. */
function fakeDb(collections: Stored) {
  const reads: ReadQuery[] = [];
  const gets: string[][] = [];
  const db: FirestoreReader = {
    source: "a fake database",
    async query(query) {
      reads.push(query);
      let docs: Doc[] = Object.entries(collections[query.collection] ?? {}).map(
        ([id, data]) => ({ id, data }),
      );
      const where = query.where;
      if (where) {
        docs = docs.filter(({ data }) =>
          where.in.includes(String(data[where.field])),
        );
      }
      const order = query.orderBy;
      if (order) {
        const sign = order.descending ? -1 : 1;
        docs.sort(
          (a, b) =>
            sign *
            String(a.data[order.field]).localeCompare(
              String(b.data[order.field]),
            ),
        );
      }
      return docs.slice(0, query.limit);
    },
    async get(collection, ids) {
      gets.push([...ids]);
      return ids.flatMap((id) => {
        const data = collections[collection]?.[id];
        return data ? [{ id, data }] : [];
      });
    },
  };
  return { db, reads, gets };
}

const everything = () => fakeDb({ feedback: FEEDBACK, qaChecks: QA_CHECKS });

/** The report lines of a listing: "- " and what follows, per report. */
const rows = (listing: string) =>
  listing.split("\n").filter((line) => line.startsWith("- "));

function expectNothingPersonal(output: string) {
  for (const secret of [OWNER, TRUSTED, STRANGER, CONTACT, USER_AGENT]) {
    expect(output).not.toContain(secret);
  }
  expect(output).not.toContain("1727000000");
}

describe("reporterOf", () => {
  it("names the owner and the trusted reviewer, and nobody else", () => {
    expect(reporterOf(OWNER)).toBe("owner");
    expect(reporterOf(TRUSTED)).toBe("trusted");
    expect(reporterOf(STRANGER)).toBe("signed-in");
    expect(reporterOf(undefined)).toBe("anonymous");
    expect(reporterOf("")).toBe("anonymous");
  });
});

describe("idFrom", () => {
  it("takes an id or a link to it", () => {
    expect(idFrom(QUEUE_FIRST)).toBe(QUEUE_FIRST);
    expect(idFrom(` https://koryta.pl/admin/opinie#fb-${QUEUE_FIRST} `)).toBe(
      QUEUE_FIRST,
    );
  });
});

describe("feedbackQueue", () => {
  it("lists what is not in the queue newest first, then the queue from the top", async () => {
    const listing = await feedbackQueue(everything().db, {}, FIXES);

    expect(listing).toContain("read from a fake database");
    expect(listing).toContain(
      "Open: 5 - 3 not yet in the queue, 2 in it. By reporter: owner 2, trusted 1, signed-in 1, anonymous 1.",
    );
    expect(rows(listing).map((row) => row.split(" · ").slice(0, 2))).toEqual([
      ["- " + FOLLOW_UP, "2026-09-06"],
      ["- " + INBOX_NEW, "2026-09-05"],
      ["- " + INBOX_OLD, "2026-09-01"],
      ["- #1", QUEUE_FIRST],
      ["- #2", QUEUE_SECOND],
    ]);
    expect(rows(listing)[1]).toBe(
      `- ${INBOX_NEW} · 2026-09-05 · idea · new · signed-in · /`,
    );
  });

  it("never prints who wrote a report", async () => {
    for (const section of ["open", "closed"] as const) {
      expectNothingPersonal(
        await feedbackQueue(everything().db, { section }, FIXES),
      );
    }
  });

  it("asks Firestore for no field it does not print", async () => {
    const { db, reads } = everything();
    await feedbackQueue(db, {}, FIXES);

    expect(reads[0]!.fields).toEqual(FEEDBACK_FIELDS);
    for (const field of ["contact", "context.userAgent", "slack", "context"]) {
      expect(reads[0]!.fields).not.toContain(field);
    }
    expect(
      reads.find((read) => read.collection === "qaChecks")!.fields,
    ).toEqual(["itemId", "status"]);
  });

  it("keeps a report's place in the queue when showing one reporter", async () => {
    const listing = await feedbackQueue(
      everything().db,
      { reporter: "trusted" },
      FIXES,
    );
    expect(rows(listing)).toEqual([
      `- #2 · ${QUEUE_SECOND} · 2026-09-02 · bug · new · trusted · /`,
    ]);
    expect(listing).toContain(
      "## Kolejka - the queue, worked from the top: 1, from trusted",
    );
  });

  it("says which fix claims a report, and what checking it found", async () => {
    const listing = await feedbackQueue(everything().db, { preview: 0 }, FIXES);
    const byId = (id: string) => rows(listing).find((row) => row.includes(id));

    expect(byId(QUEUE_FIRST)).toContain(
      "fix: wykres-osoby (works, but a problem found checking it is still open)",
    );
    expect(byId(FOLLOW_UP)).toContain("on /qa: wykres-osoby (issue)");
  });

  it("offers closing a fix that works once nothing about it is open", async () => {
    const { [FOLLOW_UP]: _, ...rest } = FEEDBACK;
    const { db } = fakeDb({ feedback: rest, qaChecks: QA_CHECKS });
    const listing = await feedbackQueue(db, {}, FIXES);
    expect(listing).toContain("fix: wykres-osoby (works, can be closed)");
  });

  it("cuts each message to the preview, or leaves messages out", async () => {
    const short = await feedbackQueue(everything().db, { preview: 20 }, FIXES);
    expect(short).toContain(`\n  ${LONG.slice(0, 20).trimEnd()}…\n`);
    expect(short).toContain("\n  note: Najpierw projekt.");

    const bare = await feedbackQueue(everything().db, { preview: 0 }, FIXES);
    expect(bare.split("\n").filter((line) => line.startsWith("  "))).toEqual(
      [],
    );
  });

  it("lists the newest closed reports", async () => {
    const listing = await feedbackQueue(
      everything().db,
      { section: "closed", closed_limit: 1 },
      FIXES,
    );
    expect(rows(listing)).toEqual([
      `- ${CLOSED_NEW} · 2026-09-04 · bug · wont_fix · signed-in · /`,
    ]);
    expect(listing).toContain("Open: 5");
  });
});

describe("feedbackGet", () => {
  const get = async (refs: string[]) => {
    const { db, gets } = everything();
    const answer = JSON.parse(await feedbackGet(db, refs, FIXES));
    return { answer, gets };
  };

  it("takes ids and links, and says which are not reports", async () => {
    const { answer } = await get([
      `https://koryta.pl/admin/opinie#fb-${QUEUE_FIRST}`,
      QUEUE_SECOND,
      QUEUE_FIRST,
      "nope",
      fid("missing"),
    ]);
    expect(answer.source).toBe("a fake database");
    expect(answer.reports.map((report: { id: string }) => report.id)).toEqual([
      QUEUE_FIRST,
      QUEUE_SECOND,
    ]);
    expect(answer.notFound).toEqual([fid("missing")]);
    expect(answer.notAReportId).toEqual(["nope"]);
  });

  it("gives the whole report and where it stands", async () => {
    const { answer, gets } = await get([QUEUE_FIRST, FOLLOW_UP, CLOSED_OLD]);
    const [first, followUp, closed] = answer.reports;

    expect(first).toEqual({
      id: QUEUE_FIRST,
      link: `https://koryta.pl/admin/opinie#fb-${QUEUE_FIRST}`,
      place: "queue #1",
      status: "in_progress",
      kind: "bug",
      createdAt: "2026-09-03T10:00:00.000Z",
      reporter: "owner",
      page: { route: "/osoba/jan", nodeId: "jan1", pageTitle: "Jan" },
      fix: {
        claimedBy: [{ id: "wykres-osoby", title: "entry wykres-osoby" }],
        state: "works",
        followUps: [FOLLOW_UP],
        canBeClosed: false,
        blockedByOpenFollowUp: true,
      },
      message: LONG,
    });
    expect(followUp).toMatchObject({
      place: "not in the queue yet",
      writtenOnQa: { itemId: "wykres-osoby", title: "Wykres", status: "issue" },
      verdictOnFixFor: [QUEUE_FIRST],
    });
    expect(closed).toMatchObject({ place: "closed", status: "resolved" });
    // Open reports are all read anyway; only the closed one is fetched by id.
    expect(gets).toEqual([[CLOSED_OLD]]);
  });

  it("never passes on who wrote a report", async () => {
    const { db } = everything();
    expectNothingPersonal(await feedbackGet(db, Object.keys(FEEDBACK), FIXES));
  });
});
