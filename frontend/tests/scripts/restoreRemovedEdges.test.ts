import { describe, expect, it, vi } from "vitest";
import type {
  DocumentReference,
  Firestore,
  WriteBatch,
} from "firebase-admin/firestore";
// The class `firebase-admin/firestore` re-exports, from its source: under the
// Nuxt test environment firebase-admin's lazy exports read as undefined.
import { Timestamp } from "@google-cloud/firestore";
import {
  AUTHOR,
  judge,
  parseArgs,
  parseIdList,
  removalOf,
  UsageError,
  writeRestore,
  yearOf,
} from "../../scripts/migrate/restore-removed-edges";
import { holdsRevision } from "../../server/utils/revisions";
import type { Revision } from "../../shared/model";

// Which is also why the write needs these: `createRevisionTransaction` stamps
// its revision with `Timestamp.now()`, and nothing here reads the stamp back.
vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { now: () => ({ toMillis: () => 0 }) },
  FieldValue: { delete: () => "<delete>" },
  getFirestore: vi.fn(),
}));

/** A candidacy as /api/edges/delete leaves it, shaped like the first list's:
 * removed as a duplicate, unpublished on the way out, and pointing at the
 * revision of the night that updated it since. */
function removedCandidacy(fields: Record<string, unknown> = {}) {
  return {
    source: "person",
    target: "region",
    type: "election",
    name: "kandydatura",
    position: "Samorząd",
    start_date: "2018-01-01",
    party: "PO",
    deleted: true,
    delete_reason: "duplikat",
    published: false,
    stats: { count: 3 },
    revision_id: { id: "night", path: "revisions/night" },
    ...fields,
  };
}

type Write = { path: string; data: Record<string, unknown> };

/** Enough of Firestore for `createRevisionTransaction` and `recordAudit`:
 * documents to address, and a batch that keeps what was set. */
function fakeDb() {
  let generated = 0;
  const writes: Write[] = [];
  const ref = (collection: string, id: string) => ({
    id,
    path: `${collection}/${id}`,
    parent: { id: collection },
  });
  const db = {
    collection: (collection: string) => ({
      doc: (id?: string) => ref(collection, id ?? `generated-${++generated}`),
    }),
  };
  const batch = {
    set: (target: { path: string }, data: Record<string, unknown>) => {
      writes.push({ path: target.path, data });
    },
  };
  return {
    db: db as unknown as Firestore,
    batch: batch as unknown as WriteBatch,
    edgeRef: ref("edges", "e1") as unknown as DocumentReference,
    written: (prefix: string) =>
      writes.find((write) => write.path.startsWith(prefix))?.data,
    writes,
  };
}

function restore(edge: Record<string, unknown>, reason = "druga kandydatura") {
  const fake = fakeDb();
  const revisionRef = writeRestore(
    fake.db,
    fake.batch,
    fake.edgeRef,
    edge,
    reason,
  );
  return {
    revisionRef,
    edge: fake.written("edges/")!,
    revision: fake.written("revisions/")!,
    audit: fake.written("audit/")!,
    writes: fake.writes,
  };
}

describe("writeRestore", () => {
  it("takes the removal off the relation, leaving no `deleted` key at all", () => {
    // Not `deleted: false`: `applyRevision` carries what the document owns
    // over whatever it applies, so a stored `false` would cancel the next
    // removal somebody approved.
    const { edge } = restore(removedCandidacy());

    expect(edge).toMatchObject({
      source: "person",
      target: "region",
      position: "Samorząd",
      start_date: "2018-01-01",
      party: "PO",
    });
    expect("deleted" in edge).toBe(false);
    expect("delete_reason" in edge).toBe(false);
  });

  it("keeps a draft a draft", () => {
    expect(restore(removedCandidacy()).edge.published).toBe(false);
  });

  it("keeps `published` as it was, whatever it was", () => {
    // Older removals did not unpublish: the dry run calls such a one LIVE,
    // and this is why.
    expect(restore(removedCandidacy({ published: true })).edge.published).toBe(
      true,
    );
  });

  it("keeps the counters the document owns", () => {
    expect(restore(removedCandidacy()).edge.stats).toEqual({ count: 3 });
  });

  it("points the relation at an approved revision that says nothing of the removal", () => {
    // Left on the removal, re-approving that from /admin/rewizje would remove
    // the relation again.
    const { edge, revision, revisionRef } = restore(removedCandidacy());

    expect(revision).toMatchObject({
      node_id: "e1",
      collection: "edges",
      status: "approved",
      update_user: AUTHOR,
      review_user: AUTHOR,
    });
    const data = revision.data as Record<string, unknown>;
    expect(data).toMatchObject({ source: "person", position: "Samorząd" });
    for (const owned of ["deleted", "delete_reason", "published", "stats"]) {
      expect(owned in data).toBe(false);
    }
    expect(edge.revision_id).toBe(revisionRef);
    expect(holdsRevision(edge, revision.data)).toBe(true);
  });

  it("files a restore in the audit log, naming the revision, with the reason given", () => {
    const { audit, revisionRef } = restore(
      removedCandidacy(),
      "PKW: druga kandydatura, nie duplikat",
    );

    expect(audit).toEqual({
      action: "restore",
      collection: "edges",
      target_id: "e1",
      revision_id: revisionRef.id,
      user: AUTHOR,
      reason: "PKW: druga kandydatura, nie duplikat",
      at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
    });
  });

  it("writes the revision, the relation and the audit row, and nothing else", () => {
    const { writes } = restore(removedCandidacy());

    expect(writes.map((write) => write.path.split("/")[0]).sort()).toEqual([
      "audit",
      "edges",
      "revisions",
    ]);
  });
});

describe("judge", () => {
  const live = new Map<string, Record<string, unknown>>([
    ["person", { type: "person", name: "Jan Kowalski" }],
    ["region", { type: "region", name: "Zabrze" }],
  ]);

  it("restores a removed relation between two live pages", () => {
    const edge = removedCandidacy();

    expect(judge("e1", edge, live)).toEqual({ id: "e1", restore: true, edge });
  });

  it("refuses an id that names no relation", () => {
    expect(judge("typo", undefined, live)).toEqual({
      id: "typo",
      restore: false,
      why: "no such relation",
    });
  });

  it("refuses a relation that is not removed, live or a draft", () => {
    const shown = removedCandidacy({ deleted: undefined, published: true });
    const draft = removedCandidacy({ deleted: false });

    expect(judge("e1", shown, live)).toMatchObject({
      restore: false,
      why: "not removed (live)",
    });
    expect(judge("e1", draft, live)).toMatchObject({
      restore: false,
      why: "not removed (a draft)",
    });
  });

  it("refuses one that would hang off a page that is gone", () => {
    const merged = new Map(live).set("person", {
      type: "person",
      deleted: true,
      merged_into: "survivor",
    });
    const removed = new Map(live).set("region", {
      type: "region",
      deleted: true,
    });
    const missing = new Map(live);
    missing.delete("person");

    expect(judge("e1", removedCandidacy(), merged)).toMatchObject({
      restore: false,
      why: "its source person is merged into survivor",
    });
    expect(judge("e1", removedCandidacy(), removed)).toMatchObject({
      restore: false,
      why: "its target region is removed",
    });
    expect(judge("e1", removedCandidacy(), missing)).toMatchObject({
      restore: false,
      why: "its source person does not exist",
    });
  });
});

describe("removalOf", () => {
  function revision(
    id: string,
    data: Record<string, unknown>,
    status?: Revision["status"],
  ): Revision & { id: string } {
    return {
      id,
      node_id: "e1",
      collection: "edges",
      data,
      status,
      update_time: "2026-09-11T12:48:11.788Z",
      update_user: "admin",
    };
  }

  it("finds the newest revision that states the removal", () => {
    // Newest first: the night updated the removed relation after the removal.
    const removal = revision("removal", { deleted: true }, "approved");
    const history = [
      revision("night", { position: "Samorząd" }, "approved"),
      revision("proposal_e1_x", { deleted: true }, "rejected"),
      removal,
      revision("first", {}),
    ];

    expect(removalOf(history)).toBe(removal);
  });

  it("finds none where no revision states one", () => {
    expect(removalOf([revision("first", {})])).toBeUndefined();
  });
});

describe("parseIdList", () => {
  it("reads one id a line, skipping blank lines and # comments", () => {
    expect(
      parseIdList(
        "# the 21 of 2026-10-12\r\n4nU3bplwaPG1fTmpdN8q\n\n  PzttyrRtcNSkHfAHJ3E0  \n",
      ),
    ).toEqual(["4nU3bplwaPG1fTmpdN8q", "PzttyrRtcNSkHfAHJ3E0"]);
  });

  it("keeps a line that holds more than an id whole, for parseArgs to refuse", () => {
    expect(parseIdList("4nU3bplwaPG1fTmpdN8q,2018,Zabrze")).toEqual([
      "4nU3bplwaPG1fTmpdN8q,2018,Zabrze",
    ]);
  });
});

describe("parseArgs", () => {
  const files: Record<string, string> = {
    "ids.txt": "# list\nb\nc\n",
  };
  const parse = (...argv: string[]) =>
    parseArgs(argv, (path) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path]!;
    });

  it("is a dry run against the emulator unless told otherwise", () => {
    expect(parse("--reason", "why", "a")).toEqual({
      isProd: false,
      commit: false,
      reason: "why",
      ids: ["a"],
      repeated: 0,
    });
    expect(parse("--reason", "why", "a", "--prod", "--commit")).toMatchObject({
      isProd: true,
      commit: true,
    });
  });

  it("takes ids from the command line and a file, each once, in order", () => {
    expect(
      parse("a", "--ids-file", "ids.txt", "--reason", " why ", "b", "a"),
    ).toMatchObject({ ids: ["a", "b", "c"], repeated: 2, reason: "why" });
  });

  it("requires a reason, since each audit row says it", () => {
    expect(() => parse("a")).toThrow(UsageError);
    expect(() => parse("--reason", "  ", "a")).toThrow(/--reason is required/);
  });

  it("does not take the next flag for a flag's value", () => {
    // `--reason --commit a` would otherwise be a dry run whose every audit
    // row said "--commit".
    expect(() => parse("--reason", "--commit", "a")).toThrow(
      "--reason needs a value",
    );
    expect(() => parse("--reason", "why", "--ids-file")).toThrow(
      "--ids-file needs a value",
    );
  });

  it("refuses a flag it does not know", () => {
    expect(() => parse("--reason", "why", "--publish", "a")).toThrow(
      "Unknown flag --publish",
    );
  });

  it("refuses what cannot be a relation's id rather than guess", () => {
    files["rows.csv"] = "4nU3bplwaPG1fTmpdN8q,2018,Zabrze\n";

    expect(() => parse("--reason", "why", "--ids-file", "rows.csv")).toThrow(
      'Not relation ids: "4nU3bplwaPG1fTmpdN8q,2018,Zabrze"',
    );
    expect(() => parse("--reason", "why", "edges/e1")).toThrow(UsageError);
  });

  it("refuses a run with no ids", () => {
    expect(() => parse("--reason", "why")).toThrow("No relation ids given");
    expect(() =>
      parse("--reason", "why", "--ids-file", "ids.txt"),
    ).not.toThrow();
  });
});

describe("yearOf", () => {
  it("reads the year off a stored date, whichever way it was stored", () => {
    expect(yearOf("2018-01-01")).toBe("2018");
    expect(yearOf("2006")).toBe("2006");
    expect(yearOf(Timestamp.fromDate(new Date("2024-04-07T00:00:00Z")))).toBe(
      "2024",
    );
    expect(yearOf(undefined)).toBeUndefined();
    expect(yearOf("")).toBeUndefined();
  });
});
