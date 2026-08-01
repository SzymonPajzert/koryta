/** Blocks until a backend serves the build we are about to check.
 *
 * A post-deploy check that starts too early tests the build it was meant to
 * replace and passes, which is worse than not running at all: it reports the
 * new commit as verified.
 *
 * Two ways to recognise the new build, because App Hosting publishes no commit
 * sha of its own. When the build ran in a checkout, /api/health reports the sha
 * and matching it is exact. When it does not, the build timestamp is all the
 * identity there is, and anything built after we started is the rollout we
 * triggered.
 *
 *   npx tsx scripts/wait-for-rollout.ts <baseUrl> --sha <sha> --since <iso>
 *                                       [--timeout <seconds>]
 *
 * Exits 0 once the new build answers, 1 on timeout.
 */
const [baseUrl, ...rest] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const at = rest.indexOf(`--${name}`);
  return at === -1 ? undefined : rest[at + 1];
}

const sha = flag("sha");
const since = flag("since");
const timeoutMs = Number(flag("timeout") ?? 900) * 1_000;

if (!baseUrl || !since) {
  console.error(
    "usage: wait-for-rollout.ts <baseUrl> --sha <sha> --since <iso> [--timeout <seconds>]",
  );
  process.exit(2);
}

const sinceMs = Date.parse(since);
if (Number.isNaN(sinceMs)) {
  console.error(`not an ISO timestamp: ${since}`);
  process.exit(2);
}

const health = new URL("/api/health", baseUrl).toString();
const deadline = Date.now() + timeoutMs;

let lastReported = "";

while (Date.now() < deadline) {
  try {
    const response = await fetch(health, {
      headers: { "cache-control": "no-cache" },
    });
    const body = await response.json();

    const seen = `${body.release}@${body.buildTime}`;
    if (seen !== lastReported) {
      lastReported = seen;
      console.log(`serving release=${body.release} built=${body.buildTime}`);
    }

    if (body.commit) {
      // The deployment knows what it was built from, so nothing else matters.
      if (sha && body.commit === sha) {
        console.log(`rollout live: ${body.commit}`);
        process.exit(0);
      }
    } else {
      const buildTime = Date.parse(body.buildTime);
      if (!Number.isNaN(buildTime) && buildTime > sinceMs) {
        console.log(
          `rollout live: built ${body.buildTime}, after ${since} (no sha reported by this build)`,
        );
        process.exit(0);
      }
    }
  } catch (error) {
    // A rollout swaps the Cloud Run revision underneath us, so refused
    // connections and half-written responses are the expected middle of this
    // loop rather than a reason to stop.
    console.log(
      `no answer yet: ${error instanceof Error ? error.message : error}`,
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 15_000));
}

console.error(
  `timed out after ${timeoutMs / 1_000}s waiting for ${sha ?? `a build after ${since}`}; last seen ${lastReported || "nothing"}`,
);
process.exit(1);
