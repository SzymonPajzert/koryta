import { getFirestore } from "firebase-admin/firestore";

/** What is running here, and can it reach its data.
 *
 * Two jobs. It answers "which build is live" - the App Hosting console shows a
 * rollout, not what the container actually serves - and it gives the
 * post-deploy smoke a way to wait for a new build to take over before it
 * starts asserting: buildTime moves forward on every rollout even when the
 * build environment exposes no commit sha.
 *
 * The Firestore probe is here because SSR is useless without it, and an
 * unreachable database is the failure the emulator suites can never catch.
 * Deliberately uncached, and 503 on failure so an uptime check sees it.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const { appEnv, release, commit, buildTime } = config.public.buildInfo;

  let firestore: "ok" | "unreachable" = "ok";
  let firestoreError: string | undefined;

  try {
    // The cheapest read that still proves credentials, network and database
    // name are all right: one document, no index needed.
    await getFirestore("koryta-pl").collection("nodes").limit(1).get();
  } catch (error) {
    firestore = "unreachable";
    firestoreError = error instanceof Error ? error.message : String(error);
  }

  setResponseHeader(event, "Cache-Control", "no-store");
  if (firestore !== "ok") setResponseStatus(event, 503);

  return {
    status: firestore === "ok" ? "ok" : "degraded",
    appEnv,
    release,
    commit,
    buildTime,
    // True on a deployed backend means the build thought it was a dev machine
    // and wired itself to emulators on localhost. Cheap to report, and the
    // smoke suite refuses a deployment that admits to it.
    isLocal: config.public.isLocal,
    firestore,
    firestoreError,
  };
});
