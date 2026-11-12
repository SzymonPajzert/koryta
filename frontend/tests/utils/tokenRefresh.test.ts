import { describe, it, expect, vi, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import type { User } from "firebase/auth";
import {
  idTokenResultIfReachable,
  idTokenWhenOnline,
  ignoreNetworkFailure,
  isNetworkRequestFailed,
  retryOnceOnline,
} from "../../app/utils/tokenRefresh";
import {
  backOnline,
  goOffline,
  internalError,
  networkRequestFailed,
  restoreOnline,
} from "../networkFailure";

/** Whether `promise` has settled, without waiting for it to. */
async function settled(promise: Promise<unknown>) {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  await flushPromises();
  return done;
}

afterEach(restoreOnline);

describe("isNetworkRequestFailed", () => {
  it("tells Firebase failing to reach its servers from everything else", () => {
    expect(isNetworkRequestFailed(networkRequestFailed())).toBe(true);
    expect(isNetworkRequestFailed(internalError())).toBe(false);
    expect(isNetworkRequestFailed(new TypeError("Failed to fetch"))).toBe(
      false,
    );
    expect(isNetworkRequestFailed(null)).toBe(false);
    expect(isNetworkRequestFailed("auth/network-request-failed")).toBe(false);
  });
});

describe("retryOnceOnline", () => {
  it("reads once when the first read works", async () => {
    const read = vi.fn().mockResolvedValue("token");
    await expect(retryOnceOnline(read)).resolves.toBe("token");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("waits for the browser to be back online, then reads once more", async () => {
    goOffline();
    const read = vi
      .fn()
      .mockRejectedValueOnce(networkRequestFailed())
      .mockResolvedValueOnce("token");

    const token = retryOnceOnline(read);
    expect(await settled(token)).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);

    backOnline();
    await expect(token).resolves.toBe("token");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads once more at once in a browser that says it is online", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(networkRequestFailed())
      .mockResolvedValueOnce("token");
    await expect(retryOnceOnline(read)).resolves.toBe("token");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("hands a second network failure to the caller", async () => {
    const read = vi.fn().mockRejectedValue(networkRequestFailed());
    await expect(retryOnceOnline(read)).rejects.toMatchObject({
      code: "auth/network-request-failed",
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not read again after any other error", async () => {
    goOffline();
    const read = vi.fn().mockRejectedValue(internalError());
    await expect(retryOnceOnline(read)).rejects.toMatchObject({
      code: "auth/internal-error",
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("idTokenWhenOnline", () => {
  it("is the user's token, read once more once the browser is back", async () => {
    goOffline();
    const getIdToken = vi
      .fn()
      .mockRejectedValueOnce(networkRequestFailed())
      .mockResolvedValueOnce("token");

    const token = idTokenWhenOnline({ getIdToken } as unknown as User);
    expect(await settled(token)).toBe(false);

    backOnline();
    await expect(token).resolves.toBe("token");
    expect(getIdToken).toHaveBeenCalledTimes(2);
  });
});

describe("idTokenResultIfReachable", () => {
  const userReading = (getIdTokenResult: () => Promise<unknown>) =>
    ({ getIdTokenResult }) as unknown as User;

  it("is the token's result when Firebase answers", async () => {
    const result = { claims: { admin: true } };
    await expect(
      idTokenResultIfReachable(userReading(async () => result)),
    ).resolves.toBe(result);
  });

  it("is null when Firebase cannot be reached on the second try either", async () => {
    const getIdTokenResult = vi.fn().mockRejectedValue(networkRequestFailed());
    await expect(
      idTokenResultIfReachable(userReading(getIdTokenResult)),
    ).resolves.toBeNull();
    expect(getIdTokenResult).toHaveBeenCalledTimes(2);
  });

  it("throws any other error on", async () => {
    await expect(
      idTokenResultIfReachable(
        userReading(() => Promise.reject(internalError())),
      ),
    ).rejects.toMatchObject({ code: "auth/internal-error" });
  });
});

describe("ignoreNetworkFailure", () => {
  it("lets a network failure go and throws anything else on", () => {
    expect(() => ignoreNetworkFailure(networkRequestFailed())).not.toThrow();
    const other = internalError();
    expect(() => ignoreNetworkFailure(other)).toThrow(other);
  });
});
