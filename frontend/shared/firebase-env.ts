// Which Firebase project a build talks to.
//
// Production is `koryta-pl`. A preview deployment - a branch on a real URL, so
// a change can be looked at on a phone - is `koryta-pl-preview`, a project of
// its own. It began as a second database inside the production project, which
// works, but only for as long as every call site keeps taking its database id
// from configuration: one `getFirestore()` with a literal, one script run with
// the wrong flag, and a throwaway environment is writing to koryta.pl. A
// separate project needs no such vigilance. The preview backend runs as a
// service account with no grant on koryta-pl at all, so the isolation is the
// same thing that stops any other GCP project reading it.
//
// The price is that everything has to exist twice - Auth users, rules,
// functions, data - which is what scripts/setup-preview-env.sh builds and
// development.md explains. Auth users are synthetic (seed-preview-auth.ts):
// production's are not copied, so nothing anyone does on the preview site can
// change a real person's password or delete their account.
//
// Because the two projects are otherwise identical - same Firestore database
// ids, same rules, same trigger definitions - the project id is the *whole*
// difference between them. So the values below are per-project, and the checks
// are about which project a build believes it is in versus which one it is
// actually running in. See assertProjectMatchesEnv / assertRunningInProject.
export type KorytaEnv = "local" | "preview" | "prod";

export const KORYTA_ENVS: readonly KorytaEnv[] = ["local", "preview", "prod"];

export const PROD_PROJECT_ID = "koryta-pl";
export const PREVIEW_PROJECT_ID = "koryta-pl-preview";
/** The emulators' project. `demo-` prefixed, so the SDKs refuse to leave. */
export const LOCAL_PROJECT_ID = "demo-koryta-pl";

/**
 * The Firestore database holding everything the site reads.
 *
 * Named rather than `(default)` in production for historical reasons, and the
 * same name in the preview project on purpose: the export imports one-for-one,
 * firestore.rules deploys unchanged, and the triggers in functions/src - which
 * name `database: "koryta-pl"` - are deployable to either project as they are.
 */
export const FIRESTORE_DATABASE_ID = "koryta-pl";

/**
 * Where the `users` collection lives. Production keeps it in the unnamed
 * database - useFirestore(), which is what those call sites used, returns
 * "(default)" - and moving it would be a data migration, not a deployment
 * change. Preview mirrors that rather than tidying it, so the preview is a
 * faithful rehearsal of production and not of something nicer.
 */
export const USERS_DATABASE_ID = "(default)";

/** The Firebase project each environment belongs to. */
export const PROJECT_IDS: Record<KorytaEnv, string> = {
  local: LOCAL_PROJECT_ID,
  preview: PREVIEW_PROJECT_ID,
  prod: PROD_PROJECT_ID,
};

/**
 * The web app registration a build initialises the client SDKs with. Public
 * values - they identify the project, they do not authorise anything.
 */
export type FirebaseWebConfig = {
  projectId: string;
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
};

const PROD_WEB_CONFIG: FirebaseWebConfig = {
  projectId: PROD_PROJECT_ID,
  apiKey: "AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM",
  authDomain: `${PROD_PROJECT_ID}.firebaseapp.com`,
  // Spelled out rather than left to the SDK's <projectId>-default-rtdb guess,
  // because a preview build has to be able to name a different instance.
  databaseURL: `https://${PROD_PROJECT_ID}-default-rtdb.firebaseio.com`,
  appId: "1:735903577811:web:53e6461c641b947a4e8626",
  messagingSenderId: "735903577811",
  storageBucket: `${PROD_PROJECT_ID}.firebasestorage.app`,
};

/**
 * The emulated project. Everything is intercepted before it leaves the
 * machine, so only the ids that the emulator suite itself keys off matter;
 * storage and messaging are left unset the way they always were.
 */
export function localWebConfig(projectId: string): FirebaseWebConfig {
  const prodProject = projectId === PROD_PROJECT_ID;
  return {
    projectId,
    apiKey: PROD_WEB_CONFIG.apiKey,
    authDomain: `${projectId}.firebaseapp.com`,
    databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
    appId: PROD_WEB_CONFIG.appId,
    messagingSenderId: prodProject
      ? PROD_WEB_CONFIG.messagingSenderId
      : undefined,
    storageBucket: prodProject ? PROD_WEB_CONFIG.storageBucket : undefined,
  };
}

/**
 * Where a preview build gets the ids of its own project.
 *
 * Not from this file: a web app registration is created with the project, so
 * its api key and app id are not knowable when this is written. App Hosting
 * puts them in FIREBASE_WEBAPP_CONFIG during a build, for the project the
 * backend lives in - which is precisely the answer wanted here, and one no
 * environment variable can get wrong. The overrides exist for a build outside
 * App Hosting, and are printed by `npm run preview:setup`.
 */
export type PreviewConfigSources = {
  /** FIREBASE_WEBAPP_CONFIG, as App Hosting sets it: a JSON object. */
  injected?: string;
  /** NUXT_PUBLIC_FIREBASE_* / NUXT_PUBLIC_DATABASE_URL, if any are set. */
  overrides?: Partial<FirebaseWebConfig>;
};

export function previewWebConfig({
  injected,
  overrides,
}: PreviewConfigSources = {}): FirebaseWebConfig {
  const fromInjected = parseInjectedConfig(injected);
  const merged: Partial<FirebaseWebConfig> = {
    ...fromInjected,
    ...definedOnly(overrides ?? {}),
  };

  // A missing api key would otherwise surface as a browser error on a page
  // that already rendered, long after the build that could have said so.
  const missing = (["apiKey", "appId"] as const).filter((key) => !merged[key]);
  if (missing.length > 0) {
    throw new Error(
      `Cannot build for KORYTA_ENV=preview: ${missing.join(" and ")} unknown. ` +
        "App Hosting supplies FIREBASE_WEBAPP_CONFIG when the backend has a " +
        "web app linked; outside it, set NUXT_PUBLIC_FIREBASE_API_KEY and " +
        "NUXT_PUBLIC_FIREBASE_APP_ID (`npm run preview:setup` prints them).",
    );
  }

  const projectId = merged.projectId ?? PREVIEW_PROJECT_ID;
  if (projectId === PROD_PROJECT_ID) {
    throw new Error(
      "Refusing to build: KORYTA_ENV=preview but the Firebase web app " +
        `belongs to ${PROD_PROJECT_ID}. A preview backend must live in ` +
        `${PREVIEW_PROJECT_ID}.`,
    );
  }

  return {
    projectId,
    apiKey: merged.apiKey!,
    appId: merged.appId!,
    authDomain: merged.authDomain ?? `${projectId}.firebaseapp.com`,
    // The default instance of a project created in us-central1. Everywhere
    // else it is <id>.<region>.firebasedatabase.app, which is why this is only
    // a fallback: the injected config carries the real one.
    databaseURL:
      merged.databaseURL ?? `https://${projectId}-default-rtdb.firebaseio.com`,
    messagingSenderId: merged.messagingSenderId,
    storageBucket: merged.storageBucket ?? `${projectId}.firebasestorage.app`,
  };
}

/**
 * The web config for an environment, given the project it resolves to.
 * `sources` is only consulted for preview; the other two are known here.
 */
export function resolveWebConfig(
  env: KorytaEnv,
  projectId: string,
  sources?: PreviewConfigSources,
): FirebaseWebConfig {
  if (env === "local") return localWebConfig(projectId);
  if (env === "preview") return previewWebConfig(sources);
  return PROD_WEB_CONFIG;
}

function parseInjectedConfig(
  injected: string | undefined,
): Partial<FirebaseWebConfig> {
  if (!injected) return {};
  try {
    const parsed = JSON.parse(injected) as Partial<FirebaseWebConfig>;
    return definedOnly(parsed);
  } catch (error) {
    // Guessing past this would mean building against whatever the fallbacks
    // happen to be, which for a truncated config is production's api key.
    throw new Error(
      `FIREBASE_WEBAPP_CONFIG is not valid JSON: ${(error as Error).message}`,
    );
  }
}

function definedOnly(
  config: Partial<FirebaseWebConfig>,
): Partial<FirebaseWebConfig> {
  // Empty counts as absent: an App Hosting variable that was declared and
  // never given a value arrives as "", and would otherwise shadow the
  // injected config with nothing.
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => !!value),
  ) as Partial<FirebaseWebConfig>;
}

/**
 * The Firestore database id for the one-off scripts under scripts/ and the e2e
 * specs, which build their own admin app instead of going through Nuxt. The
 * name is the same in every project; which project is selected by the
 * credentials the script runs with.
 */
export function firestoreDatabaseFromEnv(): string {
  return process.env.NUXT_PUBLIC_FIRESTORE_DATABASE || FIRESTORE_DATABASE_ID;
}

/**
 * The project the scripts under scripts/migrate/ run against.
 *
 * Production unless told otherwise, because that is what a migration is for.
 * Naming the preview project instead is how one is rehearsed on real-shaped
 * data without being able to damage any: the databases are named the same in
 * both, so the project is the whole of the choice.
 */
export function adminProjectFromEnv(): string {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    PROD_PROJECT_ID
  );
}

export function isKorytaEnv(value: unknown): value is KorytaEnv {
  return KORYTA_ENVS.includes(value as KorytaEnv);
}

/**
 * Reads KORYTA_ENV, falling back to whether the caller looks local.
 *
 * An unrecognised value is an error rather than a fallback: "prod" spelled
 * wrong must not quietly select production.
 */
export function resolveKorytaEnv(
  raw: string | undefined,
  isLocal: boolean,
): KorytaEnv {
  if (raw === undefined || raw === "") return isLocal ? "local" : "prod";
  if (!isKorytaEnv(raw)) {
    throw new Error(
      `Unknown KORYTA_ENV ${JSON.stringify(raw)}; expected one of ${KORYTA_ENVS.join(", ")}`,
    );
  }
  return raw;
}

/**
 * Refuses a build that claims an environment but names another's project.
 *
 * Local is exempt: it runs against the emulators as either `demo-koryta-pl` or
 * `koryta-pl` (USE_PROD_PROJECT, for the prod-data export), and neither one
 * reaches a real project.
 */
export function assertProjectMatchesEnv(
  env: KorytaEnv,
  projectId: string,
): void {
  if (env === "local") return;
  if (projectId !== PROJECT_IDS[env]) {
    throw new Error(
      `Refusing to start: KORYTA_ENV=${env} but the Firebase project is ` +
        `${projectId}, and ${env} is ${PROJECT_IDS[env]}.`,
    );
  }
}

/**
 * Refuses a build running somewhere other than the project it was built for.
 *
 * This is the check that does not depend on anything arriving. A preview
 * backend whose environment variables went missing builds as production -
 * KORYTA_ENV is gone too, so nothing above notices - and would come up in the
 * preview project holding production's project id and credentials it does not
 * have. Cloud Run tells the container which project it is in; if that
 * disagrees with what was built in, the rollout fails instead of serving.
 *
 * `host` is undefined outside Cloud Run (a laptop, a test), where there is no
 * second opinion to be had and this passes.
 */
export function assertRunningInProject(
  projectId: string,
  host: string | undefined,
): void {
  if (!host || host === projectId) return;
  throw new Error(
    `Refusing to start: built for Firebase project ${projectId} but running ` +
      `in ${host}. A deployment that lost its environment configuration comes ` +
      "up like this; redeploy with the right apphosting.<env>.yaml.",
  );
}

/**
 * Which project the running container belongs to, according to the platform
 * rather than the build. App Hosting sets FIREBASE_CONFIG at runtime;
 * GCLOUD_PROJECT and friends come from the Cloud Run container contract.
 */
export function hostProjectId(
  env: Record<string, string | undefined>,
): string | undefined {
  if (env.FIREBASE_CONFIG) {
    try {
      const parsed = JSON.parse(env.FIREBASE_CONFIG) as { projectId?: string };
      if (parsed.projectId) return parsed.projectId;
    } catch {
      // Malformed is no evidence either way; fall through to the plain vars.
    }
  }
  return env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || env.PROJECT_ID;
}
