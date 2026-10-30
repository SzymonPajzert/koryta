import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cropImages,
  decideExtract,
  waitsForAdmin,
} from "../../../server/utils/declarationDecisions";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
});

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { fromDate: (date: Date) => ({ iso: date.toISOString() }) },
}));

/** A Firestore double over an in-memory map: documents, getAll, and
 * transactions whose writes land only when the function returns. */
type Data = Record<string, unknown>;
let stored: Map<string, Data>;

function snapshot(path: string) {
  const data = stored.get(path);
  return {
    id: path.slice(path.indexOf("/") + 1),
    exists: data !== undefined,
    data: () => (data ? structuredClone(data) : undefined),
    get: (field: string) => data?.[field],
  };
}

const db = {
  collection: (collection: string) => ({
    doc: (id: string) => ({ path: `${collection}/${id}`, id }),
  }),
  getAll: async (...refs: { path: string }[]) =>
    refs.map((ref) => snapshot(ref.path)),
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const writes: (() => void)[] = [];
    const tx = {
      get: async (ref: { path: string }) => snapshot(ref.path),
      update: (ref: { path: string }, data: Data) =>
        writes.push(() =>
          stored.set(ref.path, { ...stored.get(ref.path)!, ...data }),
        ),
    };
    const result = await fn(tx);
    for (const write of writes) write();
    return result;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const firestore = db as any;

const NOW = new Date("2026-10-29T12:00:00Z");
const AT = { iso: NOW.toISOString() };
const EARLIER = { iso: "2026-10-27T09:00:00.000Z" };

/** A crop readers could not agree on, and one they agreed on whose page says
 * another day. */
function crops() {
  stored.set("declarationExtracts/sporny", {
    status: "disputed",
    agreed: null,
    pageMatch: null,
    answers: { readings: { "1966-05-21": 2, "1966-12-05": 2 }, unreadable: 1 },
    personIds: ["fx0001"],
  });
  stored.set("declarationExtracts/inna-data", {
    status: "agreed",
    agreed: { value: "1971-09-03", kind: "date", by: "readers", at: EARLIER },
    pageMatch: "different",
    pageRecheck: true,
    pageOutcomes: { fx0002: "different" },
    personIds: ["fx0002"],
  });
}

const crop = (id: string) => stored.get(`declarationExtracts/${id}`)!;

const decide = (
  extractId: string,
  decision: Parameters<typeof decideExtract>[1]["decision"],
) =>
  decideExtract(firestore, { extractId, uid: "admin-uid", decision, now: NOW });

/** What a call threw, for the cases that must throw. */
async function failure(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    return error as { statusCode?: number; message: string };
  }
  throw new Error("expected the call to throw");
}

beforeEach(() => {
  stored = new Map();
  crops();
});

describe("waitsForAdmin", () => {
  it("is the overview's two lists: a dispute, and a reading its page contradicts", () => {
    expect(waitsForAdmin({ status: "disputed" })).toBe(true);
    expect(waitsForAdmin({ status: "agreed", pageMatch: "different" })).toBe(
      true,
    );
    for (const data of [
      { status: "agreed", pageMatch: "same" },
      { status: "agreed", pageMatch: null },
      { status: "open" },
      { status: "unreadable" },
      { status: "withdrawn" },
      undefined,
    ]) {
      expect(waitsForAdmin(data)).toBe(false);
    }
  });
});

describe("decideExtract", () => {
  it("settles a dispute on the admin's date, to be compared with its pages", async () => {
    await expect(
      decide("sporny", { verdict: "date", value: "1966-05-21" }),
    ).resolves.toEqual({ id: "sporny", status: "agreed", compare: true });

    expect(crop("sporny")).toMatchObject({
      status: "agreed",
      agreed: {
        value: "1966-05-21",
        kind: "date",
        by: "admin",
        uid: "admin-uid",
        at: AT,
      },
      decision: {
        verdict: "date",
        value: "1966-05-21",
        uid: "admin-uid",
        at: AT,
        before: { status: "disputed", agreed: null },
      },
      pageMatch: null,
      pageRecheck: false,
      updatedAt: AT,
    });
    // What the readers typed stays the record of the dispute.
    expect(crop("sporny").answers).toEqual({
      readings: { "1966-05-21": 2, "1966-12-05": 2 },
      unreadable: 1,
    });
  });

  it("settles on a year, which compares with nothing", async () => {
    await expect(
      decide("sporny", { verdict: "date", value: "1966" }),
    ).resolves.toEqual({ id: "sporny", status: "agreed", compare: false });
    expect(crop("sporny").agreed).toMatchObject({
      value: "1966",
      kind: "year",
    });
  });

  it("corrects a reading its page contradicts, and compares it afresh", async () => {
    await expect(
      decide("inna-data", { verdict: "date", value: "1971-03-09" }),
    ).resolves.toMatchObject({ status: "agreed", compare: true });

    expect(crop("inna-data")).toMatchObject({
      agreed: { value: "1971-03-09", by: "admin" },
      decision: { before: { status: "agreed", agreed: "1971-09-03" } },
      // Off the "different" list until the comparison says otherwise.
      pageMatch: null,
      pageRecheck: false,
    });
  });

  it("marks a crop unreadable, with no reading left to count", async () => {
    await expect(
      decide("inna-data", { verdict: "unreadable" }),
    ).resolves.toEqual({
      id: "inna-data",
      status: "unreadable",
      compare: false,
    });
    expect(crop("inna-data")).toMatchObject({
      status: "unreadable",
      agreed: null,
      decision: {
        verdict: "unreadable",
        value: null,
        before: { status: "agreed", agreed: "1971-09-03" },
      },
      pageMatch: null,
      pageRecheck: false,
    });
  });

  it("withdraws a crop, so its reading stops counting for the page", async () => {
    await expect(decide("inna-data", { verdict: "withdraw" })).resolves.toEqual(
      { id: "inna-data", status: "withdrawn", compare: false },
    );
    expect(crop("inna-data")).toMatchObject({
      status: "withdrawn",
      agreed: null,
      decision: { verdict: "withdraw", uid: "admin-uid" },
      pageMatch: null,
    });
  });

  it("refuses a crop somebody settled in the meantime, and writes nothing", async () => {
    await decide("sporny", { verdict: "withdraw" });
    stored.set("declarationExtracts/zgodny", {
      status: "agreed",
      agreed: { value: "1980-01-02", kind: "date", by: "readers" },
      pageMatch: "same",
    });
    const before = structuredClone([...stored.entries()]);

    for (const [id, decision] of [
      ["sporny", { verdict: "date", value: "1966-05-21" }],
      ["sporny", { verdict: "withdraw" }],
      ["zgodny", { verdict: "unreadable" }],
    ] as const) {
      expect(await failure(decide(id, decision))).toMatchObject({
        statusCode: 409,
        message: "Ten wycinek ktoś już rozstrzygnął.",
      });
    }
    expect([...stored.entries()]).toEqual(before);
  });

  it("says a crop still being read waits for readers", async () => {
    stored.set("declarationExtracts/otwarty", { status: "open" });
    expect(
      await failure(decide("otwarty", { verdict: "unreadable" })),
    ).toMatchObject({
      statusCode: 409,
      message: "Ten wycinek czeka jeszcze na czytelników.",
    });
  });

  it("is a 404 for a crop that is not there or has nothing to read", async () => {
    stored.set("declarationExtracts/pusty", { status: "failed" });
    for (const id of ["nie-ma", "pusty"]) {
      expect(await failure(decide(id, { verdict: "withdraw" }))).toMatchObject({
        statusCode: 404,
        message: "Nie ma takiego wycinka.",
      });
    }
  });

  it("refuses a date that is neither a day nor a year", async () => {
    expect(
      (await failure(decide("sporny", { verdict: "date", value: "05.1966" })))
        .statusCode,
    ).toBe(400);
    expect(crop("sporny").status).toBe("disputed");
  });
});

describe("cropImages", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;

  it("gives the crop's pictures as data URLs", async () => {
    stored.set("declarationExtractImages/sporny", { date: PNG, name: PNG });
    await expect(cropImages(firestore, "sporny")).resolves.toEqual({
      date: DATA_URL,
      name: DATA_URL,
    });

    stored.set("declarationExtractImages/inna-data", { date: PNG, name: null });
    await expect(cropImages(firestore, "inna-data")).resolves.toEqual({
      date: DATA_URL,
      name: null,
    });
  });

  it("gives no pictures for a crop the job read itself and sent without", async () => {
    await expect(cropImages(firestore, "inna-data")).resolves.toEqual({
      date: null,
      name: null,
    });
  });

  it("is null for a crop that is not there", async () => {
    stored.set("declarationExtractImages/sierota", { date: PNG });
    await expect(cropImages(firestore, "sierota")).resolves.toBeNull();
  });
});
