import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import type { User } from "firebase/auth";
import { sendConfirmationMail } from "../../app/composables/auth";
import { refuse } from "../serverRefusals";

const { mockSendEmailVerification } = vi.hoisted(() => ({
  mockSendEmailVerification: vi.fn(),
}));

vi.mock("firebase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/auth")>()),
  sendEmailVerification: mockSendEmailVerification,
}));

/** What the site's endpoint does with the next request. */
let answer: "queued" | 429 | 500 = "queued";
const seen: (string | undefined)[] = [];
registerEndpoint("/api/mail/confirm-address", {
  method: "POST",
  handler: (event) => {
    seen.push(event.headers.get("authorization") ?? undefined);
    if (answer === 429) {
      return refuse(event, {
        status: 429,
        message: "Link już wysłaliśmy. Sprawdź skrzynkę.",
      });
    }
    if (answer === 500) return refuse(event, { status: 500 });
    return { outcome: "queued" };
  },
});

const user = { getIdToken: async () => "token-a" } as unknown as User;

beforeEach(() => {
  answer = "queued";
  seen.length = 0;
  mockSendEmailVerification.mockReset();
  mockSendEmailVerification.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("sendConfirmationMail", () => {
  it("asks the site to send it, as the reader", async () => {
    await sendConfirmationMail(user);
    expect(seen).toEqual(["Bearer token-a"]);
    expect(mockSendEmailVerification).not.toHaveBeenCalled();
  });

  it("passes on the site's words when asked again too soon", async () => {
    answer = 429;
    const error = await sendConfirmationMail(user).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code?: string }).code).toBe(
      "auth/too-many-requests",
    );
    expect((error as Error).message).toBe(
      "Link już wysłaliśmy. Sprawdź skrzynkę.",
    );
    expect(mockSendEmailVerification).not.toHaveBeenCalled();
  });

  it("falls back to Firebase's own mail when the site cannot send it", async () => {
    answer = 500;
    await sendConfirmationMail(user);
    expect(mockSendEmailVerification).toHaveBeenCalledWith(user, {
      url: `${window.location.origin}/profil`,
    });
  });

  it("drops the way back where Firebase refuses the site's address", async () => {
    answer = 500;
    mockSendEmailVerification.mockRejectedValueOnce(
      Object.assign(new Error("domain"), {
        code: "auth/unauthorized-continue-uri",
      }),
    );
    await sendConfirmationMail(user);
    expect(mockSendEmailVerification).toHaveBeenLastCalledWith(user);
  });
});
