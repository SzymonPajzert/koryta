import { initializeApp, getApps } from "firebase-admin/app";
import {
  assertProjectMatchesEnv,
  assertRunningInProject,
  hostProjectId,
  isKorytaEnv,
} from "~~/shared/firebase-env";

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig();
  const { korytaEnv, databaseURL } = config.public;
  const projectId = config.public.vuefire.config.projectId;

  // Runtime overrides arrive as strings from the environment, so this is the
  // first place that can tell "preview" from a typo. Throwing here fails the
  // rollout instead of serving a page that writes to the wrong project.
  if (!isKorytaEnv(korytaEnv)) {
    throw new Error(
      `Refusing to start: unknown KORYTA_ENV ${JSON.stringify(korytaEnv)}`,
    );
  }
  assertProjectMatchesEnv(korytaEnv, projectId);
  // And the check that needs nothing to have arrived: Cloud Run knows which
  // project the container is in. A preview backend whose configuration went
  // missing built itself as production, and this is where it stops.
  if (korytaEnv !== "local") {
    assertRunningInProject(projectId, hostProjectId(process.env));
  }

  // Make sure we're not re-initializing the app on every hot-reload
  if (getApps().length === 0) {
    // See: https://firebase.google.com/docs/admin/setup#initialize-sdk
    if (config.public.isLocal) {
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
      process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    }

    initializeApp({
      projectId,
      // Without this the admin SDK has nothing to resolve - it throws "Can't
      // determine Firebase Database URL" rather than guessing the way the
      // client SDK does.
      databaseURL,
    });
  }
});
