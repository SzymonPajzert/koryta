import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireOwner } from "../../../server/utils/auth";

const { mockVerifyIdToken } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  globals.getRequestHeader = (
    event: { headers: Record<string, string> },
    name: string,
  ) => event.headers[name];
  return { mockVerifyIdToken: vi.fn() };
});

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

const event = { headers: { Authorization: "Bearer token" } };

describe("requireOwner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets the owner through", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "o", admin: true, owner: true });
    await expect(requireOwner(event as never)).resolves.toMatchObject({
      uid: "o",
    });
  });

  it("refuses an administrator who is not the owner", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "a", admin: true });
    await expect(requireOwner(event as never)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
