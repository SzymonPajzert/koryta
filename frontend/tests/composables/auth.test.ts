import { describe, it, expect, beforeEach } from "vitest";
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import { authRequest } from "../../app/composables/auth";
import { refuse, REFUSED } from "../serverRefusals";

/** How many times the endpoint below was asked. It turns every request down
 * with a 429, as a limit of the day does, in the server's own way. */
let asked = 0;
registerEndpoint("/api/test/limited", (event) => {
  asked += 1;
  return refuse(event, { status: 429, message: REFUSED.dailyLimit });
});

beforeEach(() => {
  asked = 0;
});

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
});
