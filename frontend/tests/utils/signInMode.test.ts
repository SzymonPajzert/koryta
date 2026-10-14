import { describe, it, expect } from "vitest";
import { signInMode } from "../../app/utils/signInMode";

describe("signInMode", () => {
  it("calls a sign-in that made the account a sign-up", () => {
    // Firebase writes both times when it creates the account.
    expect(
      signInMode({
        creationTime: "Tue, 14 Oct 2026 10:00:00 GMT",
        lastSignInTime: "Tue, 14 Oct 2026 10:00:00 GMT",
      }),
    ).toBe("signup");
  });

  it("calls signing into an older account a login", () => {
    expect(
      signInMode({
        creationTime: "Mon, 01 Sep 2026 10:00:00 GMT",
        lastSignInTime: "Tue, 14 Oct 2026 10:00:00 GMT",
      }),
    ).toBe("login");
  });

  it("calls it a login when the times are missing", () => {
    expect(signInMode({})).toBe("login");
  });
});
