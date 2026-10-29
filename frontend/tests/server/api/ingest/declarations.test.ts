import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/ingest/declarations.post";

/** Every document, keyed by `collection/id`, and what each commit wrote. */
let stored: Record<string, Record<string, unknown> | undefined> = {};
let commits: { path: string; data: Record<string, unknown> }[][] = [];

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    get: vi.fn(async () => snapshot(`${collection}/${id}`)),
  };
}

function snapshot(path: string) {
  const id = path.slice(path.indexOf("/") + 1);
  return {
    id,
    exists: stored[path] !== undefined,
    data: () => stored[path],
  };
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => docRef(collection, id)),
  })),
  getAll: vi.fn(async (...refs: { path: string }[]) =>
    refs.map((ref) => snapshot(ref.path)),
  ),
  batch: vi.fn(() => {
    const pending: { path: string; data: Record<string, unknown> }[] = [];
    return {
      set: vi.fn((ref: { path: string }, data: Record<string, unknown>) =>
        pending.push({ path: ref.path, data }),
      ),
      commit: vi.fn(async () => {
        for (const { path, data } of pending) {
          // `{merge: true}`: the fields sent replace, the rest stay.
          stored[path] = { ...(stored[path] ?? {}), ...data };
        }
        commits.push(pending);
      }),
    };
  }),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: { now: () => "NOW" },
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

const { mockGetUser } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return {
    mockGetUser: vi.fn().mockResolvedValue({
      uid: "pipeline-bip-declarations",
      datascience: true,
    }),
  };
});

// `requireDatascience` stays real; only the token lookup is faked.
vi.mock("../../../../server/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/utils/auth")>()),
  getUser: mockGetUser,
}));

let body: unknown = {};
const readValidatedBody = vi.fn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (_event: any, parse: any) => parse(body),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).readValidatedBody = readValidatedBody;

/** A PNG header with a size, which is all the endpoint looks at. */
function png(width = 951, height = 105, padding = 0): string {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return Buffer.from(bytes).toString("base64");
}

const KEY = "f23a52f46489f75f";
const SHA = "a".repeat(64);

function candidacy(fields: Record<string, unknown> = {}) {
  return {
    key: KEY,
    kids: ["kowalska"],
    teryt: "021704",
    unitName: "Strzelin (gmina miejsko-wiejska)",
    level: "gmina",
    office: "Rada gminy",
    year: 2024,
    status: "found",
    reason: "named",
    files: 1,
    ...fields,
  };
}

function extract(fields: Record<string, unknown> = {}) {
  return {
    sha256: SHA,
    page: 0,
    url: "https://bip.strzelin.pl/download/1",
    declarationYear: 2023,
    candidacies: [KEY],
    outcome: "crop",
    images: { date: png(), name: png(1159, 94) },
    ...fields,
  };
}

const EXTRACT = `declarationExtracts/${SHA}-p0`;
const IMAGES = `declarationExtractImages/${SHA}-p0`;

async function send(payload: Record<string, unknown>) {
  body = { tag: "bip-cut-v1", ...payload };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await handler({} as any)) as any;
}

describe("api/ingest/declarations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = { "nodes/kowalska": { type: "person", name: "Anna Kowalska" } };
    commits = [];
  });

  it("refuses a caller outside the datascience group before reading the body", async () => {
    mockGetUser.mockResolvedValueOnce({ uid: "reader" });
    await expect(send({ candidacies: [candidacy()] })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(readValidatedBody).not.toHaveBeenCalled();
    expect(commits).toHaveLength(0);
  });

  it("stores a candidacy and its crop, seeded for the reading queue", async () => {
    const result = await send({
      runId: "run-1",
      candidacies: [candidacy()],
      extracts: [extract()],
    });

    expect(result).toEqual({
      status: "ok",
      candidacies: { created: 1, updated: 0, skipped: [] },
      extracts: { created: 1, updated: 0, kept: 0, skipped: [] },
    });
    expect(stored[`declarationCandidacies/${KEY}`]).toMatchObject({
      personIds: ["kowalska"],
      teryt: "021704",
      office: "Rada gminy",
      status: "found",
      tag: "bip-cut-v1",
      runId: "run-1",
      uploaderUid: "pipeline-bip-declarations",
      createdAt: "NOW",
    });
    expect(stored[EXTRACT]).toMatchObject({
      status: "open",
      answerCount: 0,
      agreed: null,
      personIds: ["kowalska"],
      candidacyKeys: [KEY],
      units: [
        {
          teryt: "021704",
          unitName: "Strzelin (gmina miejsko-wiejska)",
          level: "gmina",
          office: "Rada gminy",
          year: 2024,
        },
      ],
      host: "bip.strzelin.pl",
      hasNameImage: true,
      imageSize: {
        date: { width: 951, height: 105 },
        name: { width: 1159, height: 94 },
      },
    });
    expect(typeof stored[EXTRACT]!.rand).toBe("number");
    expect(stored[EXTRACT]!.imageHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[IMAGES]!.date).toBeInstanceOf(Buffer);
  });

  it("does not write the same picture twice", async () => {
    await send({ candidacies: [candidacy()], extracts: [extract()] });
    const result = await send({ extracts: [extract()] });
    expect(result.extracts).toMatchObject({ created: 0, updated: 1 });
    expect(commits[1]!.some((w) => w.path === IMAGES)).toBe(false);
  });

  it("keeps no date the site knows", async () => {
    await send({ candidacies: [candidacy()], extracts: [extract()] });
    const written = JSON.stringify(commits.flat().map((w) => w.data));
    expect(written).not.toMatch(/birthDate"\s*:\s*"\d{4}-\d{2}-\d{2}"/);
  });

  it("is safe to resend: no second document, the reading left alone", async () => {
    await send({ candidacies: [candidacy()], extracts: [extract()] });
    stored[EXTRACT] = {
      ...stored[EXTRACT],
      status: "agreed",
      answerCount: 2,
      rand: 0.5,
    };

    const result = await send({
      candidacies: [candidacy({ files: 2 })],
      extracts: [extract({ images: { date: png(800, 90), name: null } })],
    });

    expect(result.candidacies).toMatchObject({ created: 0, updated: 1 });
    expect(result.extracts).toMatchObject({ created: 0, updated: 0, kept: 1 });
    expect(stored[EXTRACT]).toMatchObject({
      status: "agreed",
      answerCount: 2,
      rand: 0.5,
      imageSize: { date: { width: 951, height: 105 } },
    });
    // The picture readers answered is the one that stays.
    expect(commits[1]!.some((w) => w.path === IMAGES)).toBe(false);
  });

  it("serves a crop to the candidacies of an earlier request", async () => {
    await send({ candidacies: [candidacy()] });
    const result = await send({ extracts: [extract()] });
    expect(result.extracts.created).toBe(1);
    expect(stored[EXTRACT]!.personIds).toEqual(["kowalska"]);
  });

  it("follows a merged page and skips a deleted one", async () => {
    stored["nodes/old"] = { type: "person", merged_into: "kowalska" };
    stored["nodes/gone"] = { type: "person", deleted: true };
    const result = await send({
      candidacies: [
        candidacy({ kids: ["old"] }),
        candidacy({ key: "0".repeat(16), kids: ["gone"] }),
      ],
    });
    expect(stored[`declarationCandidacies/${KEY}`]!.personIds).toEqual([
      "kowalska",
    ]);
    expect(result.candidacies.skipped).toEqual([
      { key: "0".repeat(16), reason: "no_site_person" },
    ]);
  });

  it("never sends readers a page of a file that names nobody unless the name on it is theirs", async () => {
    const unconfirmed = candidacy({ status: "unconfirmed", reason: "unnamed" });
    const refused = await send({
      candidacies: [unconfirmed],
      extracts: [extract()],
    });
    expect(refused.extracts.skipped).toEqual([
      { id: `${SHA}-p0`, reason: "unconfirmed_name" },
    ]);
    expect(stored[EXTRACT]).toBeUndefined();

    const named = await send({
      candidacies: [unconfirmed],
      extracts: [extract({ machine: { nameMatches: true } })],
    });
    expect(named.extracts.created).toBe(1);
  });

  it("skips what it cannot place or read", async () => {
    const result = await send({
      candidacies: [candidacy()],
      extracts: [
        extract({ candidacies: ["1".repeat(16)] }),
        extract({
          page: 1,
          images: { date: Buffer.from("GIF89a").toString("base64") },
        }),
      ],
    });
    expect(result.extracts.skipped).toEqual([
      { id: `${SHA}-p0`, reason: "unknown_candidacy" },
      { id: `${SHA}-p1`, reason: "bad_image" },
    ]);
  });

  it("records a file nothing could be cut from, out of the queue", async () => {
    await send({
      candidacies: [candidacy()],
      extracts: [
        extract({ outcome: "failed", reason: "blank_form", images: undefined }),
      ],
    });
    expect(stored[EXTRACT]).toMatchObject({
      status: "failed",
      failure: "blank_form",
    });
    expect(stored[IMAGES]).toBeUndefined();
  });

  it("settles a typed date the job read with high confidence, without readers", async () => {
    await send({
      candidacies: [candidacy()],
      extracts: [
        extract({
          outcome: "read",
          images: undefined,
          machine: {
            birthDate: "1979-07-15",
            confidence: "high",
            method: "text_layer",
          },
        }),
      ],
    });
    expect(stored[EXTRACT]).toMatchObject({
      status: "agreed",
      agreed: { value: "1979-07-15", kind: "date", by: "machine" },
    });
    expect(stored[IMAGES]).toBeUndefined();
  });

  it("leaves a lower-confidence reading to readers", async () => {
    await send({
      candidacies: [candidacy()],
      extracts: [
        extract({ machine: { birthDate: "1979-07-15", confidence: "medium" } }),
      ],
    });
    expect(stored[EXTRACT]).toMatchObject({ status: "open", agreed: null });
  });

  it("refuses a request heavier than the limit", async () => {
    const big = png(951, 105, 190_000);
    await expect(
      send({
        candidacies: [candidacy()],
        extracts: Array.from({ length: 25 }, (_, page) =>
          extract({ page, images: { date: big, name: big } }),
        ),
      }),
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(commits).toHaveLength(0);
  });
});
