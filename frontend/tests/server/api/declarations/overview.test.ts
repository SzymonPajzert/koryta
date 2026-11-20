import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/declarations/overview.get";
import type { DeclarationPublicationRow } from "../../../../shared/declarations";

/** GET /api/declarations/overview: the counts are cached, the lists an admin
 * decides on are read on every request, so a decision made anywhere shows on
 * the next load. */
const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).setResponseHeader = () => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).useRuntimeConfig = () => ({
    declarationsDailyPublishLimit: 200,
  });
  // Keeps its first answer, as Nitro does for the two minutes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).defineCachedFunction = (fn: any) => {
    let cached: unknown;
    return async (...args: unknown[]) => (cached ??= await fn(...args));
  };
  return {
    requireAdmin: vi.fn(),
    countTotals: vi.fn(),
    reviewLists: vi.fn(),
  };
});

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("../../../../server/utils/declarationOverview", async (original) => ({
  ...(await original<
    typeof import("../../../../server/utils/declarationOverview")
  >()),
  countTotals: mocks.countTotals,
  reviewLists: mocks.reviewLists,
}));

const row = (
  personId: string,
  fields: Partial<DeclarationPublicationRow> = {},
): DeclarationPublicationRow => ({
  personId,
  name: personId,
  status: "held",
  reason: "two_places",
  pagePublic: false,
  paidPost: true,
  at: "2026-11-18T10:00:00.000Z",
  unit: "",
  documentUrl: "",
  edges: { published: 0, held: 0 },
  pressed: false,
  ...fields,
});

const lists = (held: DeclarationPublicationRow[]) => ({
  disputed: [],
  different: [],
  held,
  setAside: [row("aside", { paidPost: false, reason: "no_public_post" })],
  recent: [],
});

const totals = {
  at: "2026-11-18T09:58:00.000Z",
  dailyLimit: 200,
  publications: { queued: 3, published: 10, today: 1 },
};

describe("api/declarations/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ uid: "admin", admin: true });
    mocks.countTotals.mockResolvedValue(totals);
  });

  it("reads the lists on every request and counts them, the totals once", async () => {
    mocks.reviewLists
      .mockResolvedValueOnce(lists([row("a"), row("b")]))
      .mockResolvedValueOnce(lists([row("b")]));

    await handler({} as never);
    const second = await handler({} as never);

    expect(mocks.countTotals).toHaveBeenCalledTimes(1);
    expect(mocks.reviewLists).toHaveBeenCalledTimes(2);
    expect(second.lists.held.map((r) => r.personId)).toEqual(["b"]);
    expect(second.publications).toMatchObject({
      queued: 3,
      published: 10,
      held: 1,
      setAside: 1,
      heldBy: [{ reason: "two_places", count: 1 }],
    });
    // As of the lists, which are what an admin decides on.
    expect(Date.parse(second.at)).toBeGreaterThan(Date.parse(totals.at));
  });

  it("counts as published who went up since the counts were taken", async () => {
    // Off the held list already, so the chain would lose them meanwhile.
    mocks.reviewLists.mockResolvedValue({
      ...lists([row("b")]),
      recent: [
        row("a", { status: "published", at: "2026-11-18T10:01:00.000Z" }),
        row("old", { status: "published", at: "2026-11-18T09:30:00.000Z" }),
      ],
    });

    const answer = await handler({} as never);

    expect(answer.publications.published).toBe(11);
  });

  it("reads nothing for somebody who is not an admin", async () => {
    mocks.requireAdmin.mockRejectedValue(
      Object.assign(new Error("Tylko dla administratorów."), {
        statusCode: 403,
      }),
    );

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.countTotals).not.toHaveBeenCalled();
    expect(mocks.reviewLists).not.toHaveBeenCalled();
  });
});
