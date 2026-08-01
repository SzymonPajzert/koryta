import { execSync } from "node:child_process";

/** Who this build is, resolved once at build time and baked into the bundle.
 *
 * Every deployed artifact has to be able to say which environment it is
 * serving and which code it was built from - without that, a Sentry issue
 * cannot be attributed to a deploy and the smoke suite cannot tell a fresh
 * rollout from the one it replaced.
 *
 * App Hosting publishes no commit sha of its own (only FIREBASE_CONFIG,
 * FIREBASE_WEBAPP_CONFIG and the Cloud Run contract variables), so `commit` is
 * best effort: an explicit APP_RELEASE, then CI's sha, then git if the build
 * happens to run in a checkout. `buildTime` is the fallback that always works,
 * and it is what the post-deploy smoke waits on.
 */
export interface BuildInfo {
  /** "local", "autopush", "prod", or "unknown" when a backend is untagged. */
  appEnv: string;
  /** Sentry release. A sha when we know it, otherwise the build timestamp. */
  release: string;
  /** Full commit sha, or "" when the build environment does not expose one. */
  commit: string;
  /** ISO timestamp of the build, monotonic across rollouts. */
  buildTime: string;
}

function detectCommit(): string {
  const fromEnv = process.env.APP_RELEASE || process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv;

  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Source snapshots and archive-based builds have no .git. buildTime carries
    // the identity from here.
    return "";
  }
}

export function resolveBuildInfo(isLocal: boolean): BuildInfo {
  // A build stamp that moved every run would churn the snapshots.
  if (process.env.VITEST) {
    return {
      appEnv: "test",
      release: "test",
      commit: "",
      buildTime: "1970-01-01T00:00:00.000Z",
    };
  }

  const buildTime = new Date().toISOString();
  const commit = isLocal ? "" : detectCommit();

  return {
    // Set per backend in apphosting.<environment>.yaml. An untagged backend
    // reports "unknown" rather than borrowing a neighbour's name, so a
    // mislabelled environment shows up instead of hiding.
    appEnv: process.env.APP_ENV || (isLocal ? "local" : "unknown"),
    release: commit ? commit.slice(0, 7) : `build-${buildTime}`,
    commit,
    buildTime,
  };
}
