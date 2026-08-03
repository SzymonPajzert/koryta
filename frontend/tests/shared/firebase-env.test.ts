import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  assertProjectMatchesEnv,
  assertRunningInProject,
  hostProjectId,
  PREVIEW_PROJECT_ID,
  previewWebConfig,
  PROD_PROJECT_ID,
  PROJECT_IDS,
  resolveKorytaEnv,
  resolveWebConfig,
} from "../../shared/firebase-env";

describe("resolveKorytaEnv", () => {
  it("falls back to how the caller was built", () => {
    expect(resolveKorytaEnv(undefined, true)).toBe("local");
    expect(resolveKorytaEnv(undefined, false)).toBe("prod");
    expect(resolveKorytaEnv("", false)).toBe("prod");
  });

  it("takes an explicit environment over the fallback", () => {
    expect(resolveKorytaEnv("preview", false)).toBe("preview");
    expect(resolveKorytaEnv("prod", true)).toBe("prod");
  });

  it("rejects a value it does not recognise rather than guessing", () => {
    expect(() => resolveKorytaEnv("production", false)).toThrow(/Unknown/);
    expect(() => resolveKorytaEnv("Preview", false)).toThrow(/Unknown/);
  });
});

describe("previewWebConfig", () => {
  const injected = JSON.stringify({
    projectId: PREVIEW_PROJECT_ID,
    apiKey: "preview-api-key",
    appId: "1:1:web:preview",
    authDomain: "koryta-pl-preview.firebaseapp.com",
    databaseURL: "https://koryta-pl-preview-default-rtdb.firebaseio.com",
    messagingSenderId: "1",
    storageBucket: "koryta-pl-preview.firebasestorage.app",
  });

  it("takes the project's own registration from App Hosting", () => {
    const config = previewWebConfig({ injected });
    expect(config.projectId).toBe(PREVIEW_PROJECT_ID);
    expect(config.apiKey).toBe("preview-api-key");
    expect(config.databaseURL).toContain(PREVIEW_PROJECT_ID);
  });

  it("lets an explicit override win, for a build outside App Hosting", () => {
    const config = previewWebConfig({
      injected,
      overrides: { apiKey: "pasted-key" },
    });
    expect(config.apiKey).toBe("pasted-key");
  });

  // Empty strings are what an unset App Hosting variable arrives as, and they
  // would otherwise pass the "is it there" check and fail in the browser.
  it("ignores empty values on both sides", () => {
    expect(
      previewWebConfig({ injected, overrides: { apiKey: "" } }).apiKey,
    ).toBe("preview-api-key");
    expect(() =>
      previewWebConfig({ injected: JSON.stringify({ apiKey: "" }) }),
    ).toThrow(/apiKey/);
  });

  it("says what to do when nothing supplied the ids", () => {
    expect(() => previewWebConfig()).toThrow(/FIREBASE_WEBAPP_CONFIG/);
    expect(() => previewWebConfig({ injected: "{oops" })).toThrow(
      /not valid JSON/,
    );
  });

  // The failure this exists for: a preview backend created in the production
  // project would be handed production's web app, and the build would come up
  // looking like a preview and writing to koryta.pl.
  it("refuses a web app that belongs to production", () => {
    expect(() =>
      previewWebConfig({
        injected: JSON.stringify({
          projectId: PROD_PROJECT_ID,
          apiKey: "k",
          appId: "a",
        }),
      }),
    ).toThrow(/must live in/);
  });
});

describe("resolveWebConfig", () => {
  it("gives production its own registration", () => {
    const config = resolveWebConfig("prod", PROD_PROJECT_ID);
    expect(config.projectId).toBe(PROD_PROJECT_ID);
    expect(config.databaseURL).toBe(
      "https://koryta-pl-default-rtdb.firebaseio.com",
    );
  });

  it("keeps the emulated project off production's storage", () => {
    const local = resolveWebConfig("local", "demo-koryta-pl");
    expect(local.projectId).toBe("demo-koryta-pl");
    expect(local.storageBucket).toBeUndefined();
    expect(local.databaseURL).toContain("demo-koryta-pl");
  });
});

describe("which project a build is in", () => {
  it("pairs each environment with its project", () => {
    for (const env of ["preview", "prod"] as const) {
      expect(() =>
        assertProjectMatchesEnv(env, PROJECT_IDS[env]),
      ).not.toThrow();
    }
    expect(() => assertProjectMatchesEnv("preview", PROD_PROJECT_ID)).toThrow(
      /KORYTA_ENV=preview/,
    );
    expect(() => assertProjectMatchesEnv("prod", PREVIEW_PROJECT_ID)).toThrow(
      /KORYTA_ENV=prod/,
    );
  });

  // Local runs against the emulators as demo-koryta-pl, or as koryta-pl when
  // replaying the production export; neither reaches a real project.
  it("leaves local alone", () => {
    expect(() =>
      assertProjectMatchesEnv("local", PROD_PROJECT_ID),
    ).not.toThrow();
  });

  // The check that survives losing every environment variable: a preview
  // backend that built itself as production is still running in the preview
  // project, and Cloud Run says so.
  it("refuses a build running in a project it was not built for", () => {
    expect(() =>
      assertRunningInProject(PROD_PROJECT_ID, PREVIEW_PROJECT_ID),
    ).toThrow(/built for Firebase project koryta-pl but running/);
    expect(() =>
      assertRunningInProject(PROD_PROJECT_ID, PROD_PROJECT_ID),
    ).not.toThrow();
  });

  it("passes where nothing can say which project this is", () => {
    expect(() =>
      assertRunningInProject(PROD_PROJECT_ID, undefined),
    ).not.toThrow();
    expect(hostProjectId({})).toBeUndefined();
  });

  it("reads the project from what the platform sets", () => {
    expect(
      hostProjectId({
        FIREBASE_CONFIG: JSON.stringify({ projectId: PREVIEW_PROJECT_ID }),
        GCLOUD_PROJECT: PROD_PROJECT_ID,
      }),
    ).toBe(PREVIEW_PROJECT_ID);
    expect(hostProjectId({ GCLOUD_PROJECT: PREVIEW_PROJECT_ID })).toBe(
      PREVIEW_PROJECT_ID,
    );
    expect(
      hostProjectId({ FIREBASE_CONFIG: "{", GOOGLE_CLOUD_PROJECT: "x" }),
    ).toBe("x");
  });
});

describe("apphosting.preview.yaml", () => {
  // The deployment only ever sees the yaml. Everything else about the preview
  // project now arrives from the project itself, so this is the whole of what
  // has to be declared - and all of it has to be right.
  const yaml = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../apphosting.preview.yaml",
    ),
    "utf8",
  );

  const envVar = (name: string) =>
    yaml.match(
      new RegExp(`- variable: ${name}\\s*\\n\\s*value: "?([^"\\n]+)"?`),
    )?.[1];

  it("declares itself a preview to the build and to the runtime", () => {
    expect(envVar("KORYTA_ENV")).toBe("preview");
    expect(envVar("NUXT_PUBLIC_KORYTA_ENV")).toBe("preview");
  });

  it("names no database or project id", () => {
    // Those come from the project the backend lives in. A copy pinned here
    // would be one more thing to keep in step, and the thing it would be
    // pinning is the one that must not be pinned wrong.
    expect(yaml).not.toContain("NUXT_PUBLIC_FIRESTORE_DATABASE");
    expect(yaml).not.toContain("NUXT_PUBLIC_FIREBASE_API_KEY");
  });

  it("keeps the preview out of search results", () => {
    expect(envVar("NUXT_PUBLIC_SITE_INDEXABLE")).toBe("false");
  });
});

describe("no hardcoded database ids", () => {
  const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

  // The two databases are not interchangeable - `users` is in the unnamed one
  // and everything else is not - so a call site that names one itself is a
  // call site that reads an empty collection the day the layout changes.
  // Everything goes through appFirestore/appUsersFirestore/appDatabase.
  it("routes every Firestore and RTDB handle through the helpers", () => {
    const hits = grep(
      String.raw`getFirestore\([^)]*"(koryta-pl|\(default\))"|useDatabase\(\)|useFirestore\(\)`,
      ["app", "server", "scripts", "tests"],
    ).filter(
      (line) =>
        // The helpers themselves, the module that defines the ids, and the
        // mocks in unit tests are where the names are allowed to appear.
        !line.startsWith("app/utils/firebase.ts") &&
        !line.startsWith("server/utils/firebase.ts") &&
        !line.startsWith("shared/firebase-env.ts") &&
        !line.includes(".test.ts"),
    );
    expect(hits).toEqual([]);
  });

  function grep(pattern: string, dirs: string[]): string[] {
    try {
      return execFileSync(
        "grep",
        ["-rnE", pattern, "--include=*.ts", "--include=*.vue", ...dirs],
        { cwd: frontend, encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
    } catch (error) {
      // grep exits 1 when it matches nothing, which is the passing case.
      if ((error as { status?: number }).status === 1) return [];
      throw error;
    }
  }
});
