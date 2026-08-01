import { test, expect } from "@playwright/test";

/** Is the right build live, and can it reach its data.
 *
 * The first thing to know after a rollout, and the cheapest: if this fails
 * there is no point reading the rest of the run.
 */
test.describe("health", () => {
  test("reports a healthy build of the expected environment", async ({
    request,
  }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const health = await response.json();

    expect(health.status).toBe("ok");
    expect(health.firestore, health.firestoreError ?? "").toBe("ok");

    // A deployed backend that believes it is local points its Firestore and
    // Auth clients at 127.0.0.1 and silently serves nothing.
    expect(health.isLocal).toBe(false);

    // "unknown" means the backend has no Environment name set in the App
    // Hosting console, so its Sentry issues land unlabelled.
    expect(health.appEnv).not.toBe("unknown");
    if (process.env.SMOKE_EXPECT_ENV) {
      expect(health.appEnv).toBe(process.env.SMOKE_EXPECT_ENV);
    }

    expect(health.buildTime).toBeTruthy();
    console.log(
      `smoking ${health.appEnv} release=${health.release} built=${health.buildTime}`,
    );
  });
});
