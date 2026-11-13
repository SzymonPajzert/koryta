import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { useCurrentUser } from "vuefire";
import type { User } from "firebase/auth";
import { authHeaders, authRequest } from "../../app/composables/auth";
import { refuse, REFUSED } from "../serverRefusals";
import {
  backOnline,
  goOffline,
  networkRequestFailed,
  restoreOnline,
} from "../networkFailure";

/** How many times the endpoint below was asked. It turns every request down
 * with a 429, as a limit of the day does, in the server's own way. */
let asked = 0;
registerEndpoint("/api/test/limited", (event) => {
  asked += 1;
  return refuse(event, { status: 429, message: REFUSED.dailyLimit });
});

/** How many times the endpoint below was asked; it answers every time. */
let answered = 0;
registerEndpoint("/api/test/answers", () => {
  answered += 1;
  return { ok: true };
});

beforeEach(() => {
  asked = 0;
  answered = 0;
});

afterEach(() => {
  restoreOnline();
  vi.useRealTimers();
});

/** Somebody signed in whose token could not be refreshed for want of a
 * network the first time, and could the second. */
function wokenWithNoNetwork() {
  const getIdToken = vi
    .fn()
    .mockRejectedValueOnce(networkRequestFailed())
    .mockResolvedValueOnce("fresh-token");
  return { user: { getIdToken } as unknown as User, getIdToken };
}

/** `authRequest` sends a GET that failed with a status on ofetch's list once
 * more by itself, 429 among them. A limit turns the second try down too, and
 * takes it from what it allows: /oswiadczenia asks with a list of its own
 * (`RETRY_STATUS_CODES` in app/composables/declarationQueue.ts). */
describe("authRequest", () => {
  it("sends a GET a limit turned down once more, on ofetch's own list", async () => {
    await expect(
      authRequest("/api/test/limited", { method: "GET" }),
    ).rejects.toMatchObject({ statusCode: 429 });

    expect(asked).toBe(2);
  });

  it("sends a GET again only after the statuses it is given", async () => {
    await expect(
      authRequest("/api/test/limited", {
        method: "GET",
        retryStatusCodes: [500, 503],
      }),
    ).rejects.toMatchObject({ statusCode: 429 });

    expect(asked).toBe(1);
  });

  // A device woken with no network holds an expired token, and the refresh
  // fails before the request could have gone anywhere either. The header it
  // goes out with is `authHeaders`' test below: the stub server here never
  // sees the `Headers` this one builds.
  it("holds a request whose token could not be refreshed offline until the browser is back online", async () => {
    goOffline();
    const { user, getIdToken } = wokenWithNoNetwork();
    vi.mocked(useCurrentUser).mockReturnValueOnce(ref(user));

    const answer = authRequest("/api/test/answers", { method: "GET" });
    await flushPromises();
    expect(answered).toBe(0);

    backOnline();
    await expect(answer).resolves.toEqual({ ok: true });
    expect(answered).toBe(1);
    expect(getIdToken).toHaveBeenCalledTimes(2);
  });

  // The wait counts against the request's `timeout`. With no end to it,
  // /admin/procesy said it was loading for as long as the browser was
  // offline; at the timeout the request fails as it did before it waited,
  // and the page says the refresh failed.
  it("fails a request still offline at its timeout with the token's error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    goOffline();
    const failure = networkRequestFailed();
    const getIdToken = vi.fn().mockRejectedValue(failure);
    vi.mocked(useCurrentUser).mockReturnValueOnce(
      ref({ getIdToken } as unknown as User),
    );

    let outcome: unknown = "pending";
    authRequest("/api/test/answers", { method: "GET", timeout: 5_000 }).then(
      (value) => (outcome = value),
      (error) => (outcome = error),
    );
    await vi.advanceTimersByTimeAsync(4_999);
    await flushPromises();
    expect(outcome).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(outcome).toBe(failure);
    expect(answered).toBe(0);
    expect(getIdToken).toHaveBeenCalledTimes(1);
  });
});

describe("authHeaders", () => {
  it("carries the token refreshed once the browser is back online", async () => {
    goOffline();
    const { user, getIdToken } = wokenWithNoNetwork();

    let headers: Record<string, string> | undefined;
    const pending = authHeaders(user).then((value) => (headers = value));
    await flushPromises();
    expect(headers).toBeUndefined();

    backOnline();
    await pending;
    expect(headers).toEqual({ Authorization: "Bearer fresh-token" });
    expect(getIdToken).toHaveBeenCalledTimes(2);
  });
});
