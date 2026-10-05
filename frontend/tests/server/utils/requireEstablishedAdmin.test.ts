import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireEstablishedAdmin } from "../../../server/utils/auth";

/** The gate in front of /api/admin/users/**: an administrator not on trial,
 * decided by the account as it is now rather than by the token the caller
 * holds. The token can be up to an hour old, and the routes behind this hand
 * out every account's address and moderate profiles with no confirmation, so
 * a trial, a demotion, a disabled account and a revoked session all have to
 * apply at the next request. */

const { mockVerifyIdToken, mockGetUser } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  globals.getRequestHeader = (
    event: { headers: Record<string, string> },
    name: string,
  ) => event.headers[name];
  return { mockVerifyIdToken: vi.fn(), mockGetUser: vi.fn() };
});

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken, getUser: mockGetUser }),
}));

const event = { headers: { Authorization: "Bearer token" } };

const ADMIN = { trusted: true, datascience: true, admin: true };

/** Signed in at 10:00, as a token's `auth_time` (seconds). */
const SIGNED_IN = Date.parse("2026-10-05T10:00:00Z") / 1000;

/** A decoded ID token for `uid`, as `verifyIdToken` hands it over. */
function token(claims: Record<string, unknown>) {
  return { uid: "a", sub: "a", auth_time: SIGNED_IN, ...claims };
}

/** The caller's account, shaped like the admin SDK's `UserRecord`. */
function account(
  fields: {
    customClaims?: Record<string, unknown>;
    disabled?: boolean;
    tokensValidAfterTime?: string;
  } = {},
) {
  return {
    uid: "a",
    disabled: false,
    customClaims: ADMIN,
    // A revocation time well before this sign-in: nothing has been revoked
    // since the session began.
    tokensValidAfterTime: "Mon, 01 Sep 2025 08:00:00 GMT",
    ...fields,
  };
}

describe("requireEstablishedAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets an established administrator through, reading the account once", async () => {
    mockVerifyIdToken.mockResolvedValue(token(ADMIN));
    mockGetUser.mockResolvedValue(account());

    await expect(
      requireEstablishedAdmin(event as never),
    ).resolves.toMatchObject({ uid: "a" });
    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(mockGetUser).toHaveBeenCalledWith("a");
    // The live read is made here; the token is not verified a second time
    // with `checkRevoked`, which would read the same account again.
    expect(mockVerifyIdToken).toHaveBeenCalledWith("token");
  });

  it("refuses a caller whose token has no admin without asking the account", async () => {
    mockVerifyIdToken.mockResolvedValue(token({ datascience: true }));

    await expect(requireEstablishedAdmin(event as never)).rejects.toMatchObject(
      { statusCode: 403 },
    );
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("refuses an administrator put on trial after their token was issued", async () => {
    mockVerifyIdToken.mockResolvedValue(token(ADMIN));
    mockGetUser.mockResolvedValue(
      account({ customClaims: { ...ADMIN, newAdmin: true } }),
    );

    await expect(requireEstablishedAdmin(event as never)).rejects.toMatchObject(
      { statusCode: 403 },
    );
  });

  it("refuses an administrator demoted after their token was issued", async () => {
    mockVerifyIdToken.mockResolvedValue(token(ADMIN));
    mockGetUser.mockResolvedValue(
      account({ customClaims: { trusted: true, datascience: true } }),
    );

    await expect(requireEstablishedAdmin(event as never)).rejects.toMatchObject(
      { statusCode: 403 },
    );
  });

  it("refuses a token whose account no longer exists", async () => {
    mockVerifyIdToken.mockResolvedValue(token(ADMIN));
    mockGetUser.mockRejectedValue(
      Object.assign(new Error("no user"), { code: "auth/user-not-found" }),
    );

    await expect(requireEstablishedAdmin(event as never)).rejects.toMatchObject(
      { statusCode: 403 },
    );
  });

  it("passes on a failure to read the account rather than calling it a refusal", async () => {
    mockVerifyIdToken.mockResolvedValue(token(ADMIN));
    const outage = Object.assign(new Error("unavailable"), {
      code: "auth/internal-error",
    });
    mockGetUser.mockRejectedValue(outage);

    await expect(requireEstablishedAdmin(event as never)).rejects.toBe(outage);
  });

  // The owner disables a compromised account in the console and touches
  // nothing else: its claims still say established administrator, and the
  // token the attacker holds verifies for the rest of its hour.
  it("refuses a disabled account, whatever its claims", async () => {
    mockVerifyIdToken.mockResolvedValue(token(ADMIN));
    mockGetUser.mockResolvedValue(account({ disabled: true }));

    await expect(requireEstablishedAdmin(event as never)).rejects.toMatchObject(
      { statusCode: 401 },
    );
  });

  it("refuses a session signed in before the account's sessions were revoked", async () => {
    mockVerifyIdToken.mockResolvedValue(token(ADMIN));
    mockGetUser.mockResolvedValue(
      account({ tokensValidAfterTime: "Mon, 05 Oct 2026 10:00:01 GMT" }),
    );

    await expect(requireEstablishedAdmin(event as never)).rejects.toMatchObject(
      { statusCode: 401 },
    );
  });

  it("lets through a session signed in again after the revocation", async () => {
    // Revoked at 10:00:00 and signed in again in that same second: Firebase's
    // own check (`verifyIdToken(token, true)`) accepts it too.
    mockVerifyIdToken.mockResolvedValue(token(ADMIN));
    mockGetUser.mockResolvedValue(
      account({ tokensValidAfterTime: "Mon, 05 Oct 2026 10:00:00 GMT" }),
    );

    await expect(
      requireEstablishedAdmin(event as never),
    ).resolves.toMatchObject({ uid: "a" });
  });

  it("refuses a token with no sign-in time when the account has a revocation time", async () => {
    // Every real ID token carries `auth_time`; one without it cannot be
    // shown to postdate the revocation, so this gate does not take it.
    const { auth_time: _, ...unsigned } = token(ADMIN);
    mockVerifyIdToken.mockResolvedValue(unsigned);
    mockGetUser.mockResolvedValue(account());

    await expect(requireEstablishedAdmin(event as never)).rejects.toMatchObject(
      { statusCode: 401 },
    );
  });

  it("takes an account that was never revoked", async () => {
    mockVerifyIdToken.mockResolvedValue(token(ADMIN));
    mockGetUser.mockResolvedValue(account({ tokensValidAfterTime: undefined }));

    await expect(
      requireEstablishedAdmin(event as never),
    ).resolves.toMatchObject({ uid: "a" });
  });
});
