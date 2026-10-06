import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readRemaining, type Remaining } from "./remaining";

/**
 * Dry-run every migration in `archive/` against a Firestore emulator holding a
 * production export, and fail unless each one still finds nothing to change.
 *
 * A migration is archived once it has run against production and its dry run
 * reports zero (see README.md). What keeps it at zero is the code fix that
 * stopped the bad documents being written, so a count coming back means
 * something writes the old shape again - the fix regressed, or a new path goes
 * around it - and the archived script is both what noticed and, with
 * `--commit`, the repair. The harmless reading is an export taken before the
 * production run, which is what the day a script is archived looks like.
 *
 *   npm run db:pull                            # the newest export
 *   devns npm run check:archived-migrations    # an emulator with it, then this
 *
 * Or against an emulator that is already up, such as dev:prod-data's:
 *   npx tsx scripts/migrate/check-archive.ts
 *
 * Never production. Each script runs in a process of its own exactly as a
 * person would run its dry run - no `--prod`, no `--commit` - with
 * FIRESTORE_EMULATOR_HOST set, which sends every Firestore call to the
 * emulator whatever credentials are lying around. And with
 * GOOGLE_APPLICATION_CREDENTIALS unset, so that a script reaching for some
 * other Google API with them fails here rather than quietly working.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..", "..");
export const ARCHIVE = join(HERE, "archive");
const EXPORT = join(FRONTEND, ".firebase", "firestore_export");
const TSX = join(FRONTEND, "node_modules", ".bin", "tsx");
// `merge-duplicate-people.ts` reaches the server code through `~~/`, which only
// Nuxt's generated tsconfig resolves. Every script gets it, so archiving one
// like that needs nothing here; a plain script runs the same under it.
const TSCONFIG = join(FRONTEND, ".nuxt", "tsconfig.server.json");
// Far longer than any dry run takes. It is here so that one script hanging
// cannot keep the others from reporting.
const TIMEOUT_MINUTES = 20;

export function archivedScripts(dir = ARCHIVE): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

type Run = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  timedOut?: boolean;
};

export type Verdict =
  | { status: "done"; counts: Remaining }
  | { status: "remaining"; counts: Remaining }
  | { status: "failed"; reason: string };

export function judge(run: Run): Verdict {
  if (run.timedOut) {
    return {
      status: "failed",
      reason: `timed out after ${TIMEOUT_MINUTES} minutes`,
    };
  }
  if (run.signal) {
    return { status: "failed", reason: `killed by ${run.signal}` };
  }
  if (run.code !== 0) {
    return { status: "failed", reason: `exited with code ${run.code}` };
  }
  const read = readRemaining(run.stdout);
  if ("error" in read) return { status: "failed", reason: read.error };
  const left = Object.values(read.counts).some((count) => count > 0);
  return { status: left ? "remaining" : "done", counts: read.counts };
}

/** The script's own output goes straight through, so a count above zero comes
 * with whatever the script says about it. */
function dryRun(script: string, env: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, ["--tsconfig", TSCONFIG, join(ARCHIVE, script)], {
      cwd: FRONTEND,
      env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      chunks.push(chunk);
    });
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGTERM");
      },
      TIMEOUT_MINUTES * 60 * 1000,
    );
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks).toString("utf8");
      resolve({ code, signal, stdout, timedOut });
    });
  });
}

/** How much is in the emulator. An empty one is the failure to catch: every
 * migration reports zero against it. */
async function census(): Promise<Record<string, number>> {
  const app = initializeApp({ projectId: "koryta-pl" }, "census");
  try {
    const db = getFirestore(app, "koryta-pl");
    const counts: Record<string, number> = {};
    for (const name of ["nodes", "edges", "revisions"]) {
      counts[name] = (await db.collection(name).count().get()).data().count;
    }
    return counts;
  } finally {
    await deleteApp(app);
  }
}

/** The export `db:pull` left on disk, by the date its metadata file is named
 * after - what `check:archived-migrations` loads into the emulator. */
function exportOnDisk(): string {
  const metadata = existsSync(EXPORT)
    ? readdirSync(EXPORT).find((name) =>
        name.endsWith(".overall_export_metadata"),
      )
    : undefined;
  return metadata?.replace(/\.overall_export_metadata$/, "") ?? "unknown";
}

const LABEL: Record<Verdict["status"], string> = {
  done: "ok",
  remaining: "LEFT",
  failed: "FAILED",
};

async function main() {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  // Without them google-auth goes looking for a GCE metadata server, and warns
  // in every process when there is none. There is none to find.
  process.env.METADATA_SERVER_DETECTION = "none";

  if (!existsSync(TSCONFIG)) {
    console.error(`${TSCONFIG} is missing: run \`npx nuxt prepare\` first.`);
    process.exit(1);
  }

  const counts = await census();
  console.log(
    `Emulator ${process.env.FIRESTORE_EMULATOR_HOST}, export ` +
      `${exportOnDisk()}: ` +
      Object.entries(counts)
        .map(([name, count]) => `${count} ${name}`)
        .join(", "),
  );
  if (counts.nodes === 0) {
    console.error(
      "The emulator holds no nodes, and against an empty database every " +
        "migration reports zero. Load an export first (npm run db:pull).",
    );
    process.exit(1);
  }

  const scripts = archivedScripts();
  const results: { script: string; verdict: Verdict }[] = [];
  for (const script of scripts) {
    console.log(`\n=== archive/${script}`);
    results.push({ script, verdict: judge(await dryRun(script, process.env)) });
  }

  const width = Math.max(0, ...scripts.map((script) => script.length));
  console.log(`\nArchived migrations, dry run (${scripts.length}):`);
  for (const { script, verdict } of results) {
    const detail =
      verdict.status === "failed"
        ? verdict.reason
        : JSON.stringify(verdict.counts);
    console.log(
      `  ${LABEL[verdict.status].padEnd(6)}  ${script.padEnd(width)}  ${detail}`,
    );
  }

  const statuses = new Set(results.map(({ verdict }) => verdict.status));
  if (statuses.has("remaining")) {
    console.log(
      "\nLEFT: a finished migration found work again. Either something " +
        "writes the old shape again, or this export predates the script's " +
        "production run. The script is also the repair - see " +
        "scripts/migrate/README.md.",
    );
  }
  if (statuses.has("failed")) {
    console.log(
      "\nFAILED: the dry run did not get as far as saying what is left; its " +
        "own output is above.",
    );
  }
  if (statuses.has("remaining") || statuses.has("failed")) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("check-archive.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
