import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRuntimeConfig } from "#app";
import images from "../../../../server/api/declarations/[id]/images.get";
import settle from "../../../../server/api/declarations/[id]/settle.post";
import withdraw from "../../../../server/api/declarations/[id]/withdraw.post";
import publishQueued from "../../../../server/api/declarations/publish-queued.post";

/** The three endpoints behind an admin's decisions on /admin/oswiadczenia, and
 * the overview's cached answer the publish button drops. What they hand to
 * server/utils/declarationDecisions.ts, which is tested on its own: the gate
 * in front of each, the crop, the decision, the configured limit, and which
 * cached answers they drop after it. */
const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  const state = { id: `${"a".repeat(64)}-p0`, body: {} as unknown };
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
    decideExtract: vi.fn(),
    cropImages: vi.fn(),
    linkedOnAPage: vi.fn(),
    matchAndDrain: vi.fn(),
    drainPublications: vi.fn(),
    readBody: vi.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).readValidatedBody = async (_event: unknown, parse: any) => {
  mocks.readBody();
  return parse(mocks.state.body);
};

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("../../../../server/utils/auth", async (original) => ({
  ...(await original<typeof import("../../../../server/utils/auth")>()),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("../../../../server/utils/declarationDecisions", async (original) => ({
  ...(await original<
    typeof import("../../../../server/utils/declarationDecisions")
  >()),
  decideExtract: mocks.decideExtract,
  cropImages: mocks.cropImages,
  linkedOnAPage: mocks.linkedOnAPage,
}));
vi.mock("../../../../server/utils/declarationPublish", () => ({
  matchAndDrain: mocks.matchAndDrain,
  drainPublications: mocks.drainPublications,
}));

const ID = `${"a".repeat(64)}-p0`;
const OVERVIEW = "nitro:functions:declarationOverview";
const event = {} as never;

const refused = () =>
  Object.assign(
    new Error("Ta operacja jest dostępna tylko dla administratorów."),
    { statusCode: 403 },
  );

/** What a call threw, for the cases that must throw. */
async function failure(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    return error as { statusCode?: number; message: string };
  }
  throw new Error("expected the call to throw");
}

/** The headers the handler set, by name. */
const headers = () =>
  Object.fromEntries(
    mocks.setHeader.mock.calls.map(([, name, value]) => [name, value]),
  );

function configure(limit: unknown) {
  const config = useRuntimeConfig() as Record<string, unknown>;
  config.declarationsDailyPublishLimit = limit;
}

beforeEach(() => {
  vi.clearAllMocks();
  configure(4);
  mocks.state.id = ID;
  mocks.state.body = {};
  mocks.requireAdmin.mockResolvedValue({ uid: "admin-uid", admin: true });
  mocks.decideExtract.mockImplementation(
    async (_db, args: { decision: { verdict: string; value?: string } }) => ({
      id: ID,
      status:
        args.decision.verdict === "date"
          ? "agreed"
          : args.decision.verdict === "unreadable"
            ? "unreadable"
            : "withdrawn",
      compare:
        args.decision.verdict === "date" && args.decision.value?.length === 10,
    }),
  );
  mocks.matchAndDrain.mockResolvedValue({
    matched: [],
    drain: { published: [] },
  });
  // Most crops an admin decides were never linked on a page.
  mocks.linkedOnAPage.mockResolvedValue(false);
});

describe("api/declarations/[id]/images", () => {
  it("answers an admin with the crop, never to be cached", async () => {
    const crop = { date: "data:image/png;base64,AAAA", name: null };
    mocks.cropImages.mockResolvedValue(crop);

    await expect(images(event)).resolves.toEqual(crop);
    expect(mocks.cropImages).toHaveBeenCalledWith(expect.anything(), ID);
    expect(headers()["Cache-Control"]).toBe("private, no-store");
  });

  it("reads nothing for somebody who is not an admin", async () => {
    mocks.requireAdmin.mockRejectedValue(refused());

    expect((await failure(images(event))).statusCode).toBe(403);
    expect(mocks.cropImages).not.toHaveBeenCalled();
  });

  it("is a 404 for an id that is no crop's, and for a crop that is gone", async () => {
    mocks.state.id = "../overview";
    expect((await failure(images(event))).statusCode).toBe(404);
    expect(mocks.cropImages).not.toHaveBeenCalled();

    mocks.state.id = ID;
    mocks.cropImages.mockResolvedValue(null);
    const gone = await failure(images(event));
    expect(gone).toMatchObject({
      statusCode: 404,
      message: "Nie ma takiego wycinka.",
    });
  });
});

describe("api/declarations/[id]/settle", () => {
  it("settles on the admin's date, read again here, and compares it with its pages", async () => {
    mocks.state.body = { verdict: "date", value: "21.05.1966" };

    await expect(settle(event)).resolves.toEqual({
      id: ID,
      status: "agreed",
      compare: true,
    });

    const [, args] = mocks.decideExtract.mock.calls[0]!;
    expect(args).toEqual({
      extractId: ID,
      uid: "admin-uid",
      decision: { verdict: "date", value: "1966-05-21" },
    });
    const [, ids, , limit, options] = mocks.matchAndDrain.mock.calls[0]!;
    expect(ids).toEqual([ID]);
    expect(limit).toBe(4);
    expect(options).toEqual({ maxPages: 1 });
    // The reload after it reads the overview again; no page showed the crop,
    // and the pass published nobody, so the pages' answers stand.
    expect(mocks.clear).toHaveBeenCalledWith(OVERVIEW);
    expect(mocks.clear).not.toHaveBeenCalledWith("nitro:handlers");
    expect(mocks.linkedOnAPage).toHaveBeenCalledWith(expect.anything(), ID);
    expect(headers()["Cache-Control"]).toBe("private, no-store");
  });

  it("drops the cached pages when a public page linked the crop", async () => {
    // Settled again, or unreadable, it confirms no page any more, and the
    // page's cached answer would go on vouching for it for hours.
    mocks.linkedOnAPage.mockResolvedValue(true);
    for (const body of [
      { verdict: "date", value: "1966-05-21" },
      { verdict: "unreadable" },
    ]) {
      mocks.clear.mockClear();
      mocks.state.body = body;

      await settle(event);

      expect(mocks.clear).toHaveBeenCalledWith("nitro:handlers");
      expect(mocks.clear).toHaveBeenCalledWith(OVERVIEW);
    }
  });

  it("compares nothing for a year or for an unreadable crop", async () => {
    mocks.state.body = { verdict: "date", value: "1966" };
    await settle(event);
    mocks.state.body = { verdict: "unreadable" };
    await expect(settle(event)).resolves.toMatchObject({
      status: "unreadable",
    });

    expect(
      mocks.decideExtract.mock.calls.map(([, args]) => args.decision),
    ).toEqual([{ verdict: "date", value: "1966" }, { verdict: "unreadable" }]);
    expect(mocks.matchAndDrain).not.toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalledWith(OVERVIEW);
  });

  it("decides nothing for somebody who is not an admin, nor reads what they sent", async () => {
    mocks.requireAdmin.mockRejectedValue(refused());
    mocks.state.body = { verdict: "unreadable" };

    expect((await failure(settle(event))).statusCode).toBe(403);
    expect(mocks.readBody).not.toHaveBeenCalled();
    expect(mocks.decideExtract).not.toHaveBeenCalled();
  });

  it("refuses a verdict or a date it does not know", async () => {
    for (const body of [
      { verdict: "withdraw" },
      { verdict: "date" },
      { verdict: "date", value: "wczoraj" },
      { verdict: "date", value: "31.02.1966" },
    ]) {
      mocks.state.body = body;
      await expect(settle(event)).rejects.toThrow();
    }
    expect(mocks.decideExtract).not.toHaveBeenCalled();
  });

  it("passes on the refusal of a crop somebody settled meanwhile", async () => {
    mocks.state.body = { verdict: "unreadable" };
    mocks.decideExtract.mockRejectedValue(
      Object.assign(new Error("Ten wycinek ktoś już rozstrzygnął."), {
        statusCode: 409,
      }),
    );

    expect(await failure(settle(event))).toMatchObject({
      statusCode: 409,
      message: "Ten wycinek ktoś już rozstrzygnął.",
    });
    expect(mocks.matchAndDrain).not.toHaveBeenCalled();
  });

  it("keeps the decision when comparing it fails, for the sweep to finish", async () => {
    mocks.state.body = { verdict: "date", value: "1966-05-21" };
    mocks.matchAndDrain.mockRejectedValue(new Error("deadline exceeded"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(settle(event)).resolves.toMatchObject({ status: "agreed" });
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("drops the cached pages when the comparison published somebody", async () => {
    mocks.state.body = { verdict: "date", value: "1966-05-21" };
    mocks.matchAndDrain.mockResolvedValue({
      matched: [],
      drain: { published: ["fx0001"] },
    });

    await settle(event);
    expect(mocks.clear).toHaveBeenCalledWith("nitro:handlers");
    expect(mocks.clear).toHaveBeenCalledWith(OVERVIEW);
  });
});

describe("api/declarations/[id]/withdraw", () => {
  it("withdraws the crop as the admin's decision", async () => {
    await expect(withdraw(event)).resolves.toEqual({
      id: ID,
      status: "withdrawn",
      compare: false,
    });
    const [, args] = mocks.decideExtract.mock.calls[0]!;
    expect(args).toEqual({
      extractId: ID,
      uid: "admin-uid",
      decision: { verdict: "withdraw" },
    });
    expect(mocks.matchAndDrain).not.toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalledWith(OVERVIEW);
    expect(mocks.clear).not.toHaveBeenCalledWith("nitro:handlers");
    expect(headers()["Cache-Control"]).toBe("private, no-store");
  });

  it("drops the cached pages when a public page linked the crop", async () => {
    mocks.linkedOnAPage.mockResolvedValue(true);

    await withdraw(event);

    expect(mocks.linkedOnAPage).toHaveBeenCalledWith(expect.anything(), ID);
    expect(mocks.clear).toHaveBeenCalledWith("nitro:handlers");
    expect(mocks.clear).toHaveBeenCalledWith(OVERVIEW);
  });

  it("withdraws nothing for somebody who is not an admin", async () => {
    mocks.requireAdmin.mockRejectedValue(refused());

    expect((await failure(withdraw(event))).statusCode).toBe(403);
    expect(mocks.decideExtract).not.toHaveBeenCalled();
  });

  it("is a 404 for an id that is no crop's", async () => {
    mocks.state.id = "nie-wycinek";
    expect((await failure(withdraw(event))).statusCode).toBe(404);
    expect(mocks.decideExtract).not.toHaveBeenCalled();
  });
});

describe("api/declarations/publish-queued", () => {
  it("drops the overview's cached answer after a pass, whatever it published", async () => {
    mocks.drainPublications.mockResolvedValue({
      day: "2026-10-29",
      limit: 4,
      skipped: null,
      published: [],
      held: [{ personId: "fx0002", reason: "pending_proposal" }],
      confirmed: [],
      failed: [],
      capReached: false,
    });

    await publishQueued(event);
    expect(mocks.clear).toHaveBeenCalledWith(OVERVIEW);
    expect(mocks.clear).not.toHaveBeenCalledWith("nitro:handlers");
  });
});
