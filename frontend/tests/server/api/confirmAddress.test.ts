import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/mail/confirm-address.post";
import { getUser } from "../../../server/utils/auth";
import { queueAddressConfirmation } from "../../../server/utils/confirmAddress";

const { mockGetUser } = vi.hoisted(() => ({ mockGetUser: vi.fn() }));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return { ...actual, defineEventHandler: (fn: unknown) => fn };
});
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUser: mockGetUser }),
}));
vi.mock("~~/server/utils/auth", () => ({ getUser: vi.fn() }));
vi.mock("~~/server/utils/confirmAddress", () => ({
  queueAddressConfirmation: vi.fn(),
}));

type Handler = (event: unknown) => Promise<unknown>;
const call = () => (handler as unknown as Handler)({});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(getUser).mockResolvedValue({ uid: "a" } as never);
  mockGetUser.mockResolvedValue({
    uid: "a",
    email: "a@example.com",
    emailVerified: false,
  });
  vi.mocked(queueAddressConfirmation).mockResolvedValue("queued");
});

describe("POST /api/mail/confirm-address", () => {
  it("turns away a request with no signed-in reader", async () => {
    vi.mocked(getUser).mockRejectedValue(
      Object.assign(new Error("no token"), { statusCode: 401 }),
    );
    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
    expect(queueAddressConfirmation).not.toHaveBeenCalled();
  });

  it("sends the confirmation for the account as the auth service has it now", async () => {
    expect(await call()).toEqual({ outcome: "queued" });
    expect(queueAddressConfirmation).toHaveBeenCalledWith(
      expect.anything(),
      { uid: "a", email: "a@example.com", emailVerified: false },
      { siteUrl: expect.stringMatching(/^https?:\/\//), now: expect.any(Date) },
    );
  });

  it("says when the link went out a moment ago, or too often today", async () => {
    for (const outcome of ["tooSoon", "dailyLimit"] as const) {
      vi.mocked(queueAddressConfirmation).mockResolvedValueOnce(outcome);
      await expect(call()).rejects.toMatchObject({
        statusCode: 429,
        message: expect.stringContaining("Link już wysłaliśmy"),
      });
    }
  });

  it("refuses an account with no address", async () => {
    mockGetUser.mockResolvedValue({ uid: "a", emailVerified: false });
    vi.mocked(queueAddressConfirmation).mockResolvedValue("noAddress");
    await expect(call()).rejects.toMatchObject({ statusCode: 400 });
    expect(vi.mocked(queueAddressConfirmation).mock.calls[0]![1]).toEqual({
      uid: "a",
      email: null,
      emailVerified: false,
    });
  });

  it("answers a confirmed account without sending anything", async () => {
    vi.mocked(queueAddressConfirmation).mockResolvedValue("confirmed");
    expect(await call()).toEqual({ outcome: "confirmed" });
  });
});
