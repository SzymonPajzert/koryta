import { describe, it, expect, vi, beforeEach } from "vitest";
import crops from "../../../../server/api/declarations/publications/[id]/crops.get";
import decline from "../../../../server/api/declarations/publications/[id]/decline.post";
import recheck from "../../../../server/api/declarations/publications/[id]/recheck.post";
import restore from "../../../../server/api/declarations/publications/[id]/restore.post";

/** The endpoints behind an admin's decisions on a held page on
 * /admin/oswiadczenia. What each hands to server/utils/declarationDecisions.ts
 * and declarationPublish.ts, which are tested on their own: the gate in front
 * of it, the page, which cached answers it drops after it, and that the
 * person moves in the people count. */
const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  const state = { id: "kowalska", birthDate: "1979-07-15" as unknown };
  globalThis.getRouterParam = () => state.id;
  const setHeader = vi.fn();
  globalThis.setResponseHeader = setHeader;
  const clear = vi.fn();
  globalThis.useStorage = vi.fn(() => ({ clear }));
  return {
    state,
    setHeader,
    clear,
    requireAdmin: vi.fn(),
    recheckPublication: vi.fn(),
    declinePublication: vi.fn(),
    restorePublication: vi.fn(),
    readingsOfAnotherDay: vi.fn(),
    peopleById: vi.fn(),
    reviewRow: vi.fn(),
    restageDeclarationPeople: vi.fn(),
  };
});

const db = {
  collection: () => ({
    doc: () => ({
      get: async () => ({ get: () => mocks.state.birthDate }),
    }),
  }),
};

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => db }));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("../../../../server/utils/auth", async (original) => ({
  ...(await original<typeof import("../../../../server/utils/auth")>()),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("../../../../server/utils/declarationDecisions", async (original) => ({
  ...(await original<
    typeof import("../../../../server/utils/declarationDecisions")
  >()),
  declinePublication: mocks.declinePublication,
  restorePublication: mocks.restorePublication,
}));
vi.mock("../../../../server/utils/declarationPublish", () => ({
  recheckPublication: mocks.recheckPublication,
  readingsOfAnotherDay: mocks.readingsOfAnotherDay,
}));
vi.mock("../../../../server/utils/declarationOverview", () => ({
  peopleById: mocks.peopleById,
  reviewRow: mocks.reviewRow,
}));
vi.mock("../../../../server/utils/declarationPeopleCount", () => ({
  restageDeclarationPeople: mocks.restageDeclarationPeople,
}));

const event = {} as never;

async function failure(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    return error as { statusCode?: number; message: string };
  }
  throw new Error("expected the call to throw");
}

const headers = () =>
  Object.fromEntries(
    mocks.setHeader.mock.calls.map(([, name, value]) => [name, value]),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.id = "kowalska";
  mocks.state.birthDate = "1979-07-15";
  mocks.requireAdmin.mockResolvedValue({ uid: "admin-uid", admin: true });
  mocks.recheckPublication.mockResolvedValue({
    outcome: "held",
    reason: "two_places",
  });
  mocks.readingsOfAnotherDay.mockResolvedValue([]);
});

describe("the gate in front of every decision", () => {
  const endpoints = { recheck, decline, restore, crops };

  for (const [name, handler] of Object.entries(endpoints)) {
    it(`${name} reads nothing for somebody who is not an admin`, async () => {
      mocks.requireAdmin.mockRejectedValue(
        Object.assign(new Error("Tylko dla administratorów."), {
          statusCode: 403,
        }),
      );

      expect((await failure(handler(event))).statusCode).toBe(403);

      expect(mocks.recheckPublication).not.toHaveBeenCalled();
      expect(mocks.declinePublication).not.toHaveBeenCalled();
      expect(mocks.restorePublication).not.toHaveBeenCalled();
      expect(mocks.readingsOfAnotherDay).not.toHaveBeenCalled();
    });

    it(`${name} answers a 404 for what cannot be a page's id, never to be cached`, async () => {
      mocks.state.id = "../nodes/kowalska";

      expect((await failure(handler(event))).statusCode).toBe(404);

      expect(headers()["Cache-Control"]).toBe("private, no-store");
    });
  }
});

describe("api/declarations/publications/[id]/recheck", () => {
  it("asks the page again in the admin's name, and answers with what came of it", async () => {
    await expect(recheck(event)).resolves.toEqual({
      outcome: "held",
      reason: "two_places",
    });

    expect(mocks.recheckPublication).toHaveBeenCalledWith(
      db,
      "kowalska",
      "admin-uid",
    );
    expect(mocks.restageDeclarationPeople).toHaveBeenCalledWith(db, [
      "kowalska",
    ]);
    // Nothing went up, so the pages' answers stand.
    expect(mocks.clear).not.toHaveBeenCalledWith("nitro:handlers");
  });

  it("drops the pages' cached answers once somebody went up", async () => {
    mocks.recheckPublication.mockResolvedValue({ outcome: "published" });

    await recheck(event);

    expect(mocks.clear).toHaveBeenCalledWith("nitro:handlers");
    expect(mocks.restageDeclarationPeople).toHaveBeenCalled();
  });

  it("moves nobody when the night or an import stopped it", async () => {
    mocks.recheckPublication.mockResolvedValue({
      outcome: "skipped",
      skipped: "night",
    });

    await expect(recheck(event)).resolves.toMatchObject({
      outcome: "skipped",
    });

    expect(mocks.restageDeclarationPeople).not.toHaveBeenCalled();
  });
});

describe("api/declarations/publications/[id]/decline", () => {
  it("sets the page aside in the admin's name", async () => {
    await expect(decline(event)).resolves.toEqual({ id: "kowalska" });

    expect(mocks.declinePublication).toHaveBeenCalledWith(
      db,
      "kowalska",
      "admin-uid",
    );
    expect(mocks.restageDeclarationPeople).toHaveBeenCalledWith(db, [
      "kowalska",
    ]);
  });

  it("moves nobody when the decision was refused", async () => {
    mocks.declinePublication.mockRejectedValue(
      Object.assign(new Error("Już nie."), { statusCode: 409 }),
    );

    expect((await failure(decline(event))).statusCode).toBe(409);

    expect(mocks.restageDeclarationPeople).not.toHaveBeenCalled();
  });
});

describe("api/declarations/publications/[id]/restore", () => {
  it("puts the page back", async () => {
    await expect(restore(event)).resolves.toEqual({ id: "kowalska" });

    expect(mocks.restorePublication).toHaveBeenCalledWith(db, "kowalska");
    expect(mocks.restageDeclarationPeople).toHaveBeenCalledWith(db, [
      "kowalska",
    ]);
  });
});

describe("api/declarations/publications/[id]/crops", () => {
  it("answers with the crops that read another day, and which an admin can still decide", async () => {
    const waiting = {
      get: () => ["kowalska", "nowak"],
      data: () => ({ status: "agreed", pageMatch: "different" }),
    };
    // Another page's declaration, matched to that page already.
    const settled = {
      get: () => ["kowalska", "nowak"],
      data: () => ({ status: "agreed", pageMatch: "same" }),
    };
    const people = new Map();
    mocks.readingsOfAnotherDay.mockResolvedValue([waiting, settled]);
    mocks.peopleById.mockResolvedValue(people);
    mocks.reviewRow.mockReturnValue({ id: "crop" });

    await expect(crops(event)).resolves.toEqual([
      { id: "crop", decidable: true },
      { id: "crop", decidable: false },
    ]);

    expect(mocks.readingsOfAnotherDay).toHaveBeenCalledWith(
      db,
      "kowalska",
      "1979-07-15",
    );
    expect(mocks.peopleById).toHaveBeenCalledWith(db, [
      "kowalska",
      "nowak",
      "kowalska",
      "nowak",
    ]);
    expect(mocks.reviewRow).toHaveBeenCalledWith(waiting, people);
  });

  it("answers with nothing for a page without a date to contradict", async () => {
    mocks.state.birthDate = undefined;

    await expect(crops(event)).resolves.toEqual([]);

    expect(mocks.readingsOfAnotherDay).not.toHaveBeenCalled();
  });
});
