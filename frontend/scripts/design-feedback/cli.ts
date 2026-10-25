/** The agent's side of the design board. Run from frontend/:
 *
 *   npm run -s design-feedback -- <command> [options]
 *
 * publish <dir|png>...   make a round of screenshots and print its link
 *     --round <id> | --next <round>   a new id, or the round after one
 *     --title, --notes, --notes-file  what Szymon reads first
 *     --variants a,b | '*'            first directory level is the variant
 *     --skip <re>, --match <re>       filter the keys
 *     --question "text|option|option" (repeatable)
 *     --dpr <n>                       for screenshots without a census
 *     --add                           add to a round that exists
 * wait <round> [--timeout <min>]      block until Szymon sends it back, then
 *                                     print the digest (run it in the background)
 * read <round> [--all] [--peek]       the digest now; --all counts nothing as
 *                                     read before, --peek does not mark it read
 * reply <comment> <text> [--addressed --in <round> | --declined]
 * list                                rounds, newest first
 * serve [--detach] | stop | status    the board itself
 *
 * The board listens on predator's loopback only (port 4848, or
 * DESIGN_FEEDBACK_PORT): `ssh -L 4848:localhost:4848 predator` and open
 * http://localhost:4848. Run these on the host, not under devns - inside a
 * namespace the board's port is somebody else's loopback.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { digest } from "./digest";
import {
  collectShots,
  nextRoundId,
  parseQuestion,
  publish,
  takenIds,
} from "./publish";
import { startServer } from "./server";
import {
  addWaiter,
  agentActor,
  appendEvent,
  boardPort,
  boardUrl,
  checkRoundId,
  findComment,
  lastRead,
  listRounds,
  loadRound,
  newId,
  roundDir,
  roundState,
  roundUrl,
  storeHome,
  waitingOn,
  type Author,
} from "./store";

const here = dirname(fileURLToPath(import.meta.url));
const home = storeHome();
const port = boardPort();

const inNamespace = () => Boolean(process.env.DEVNS_RUN);

function author(): Author {
  const workspace = process.env.CLAUDE_PROJECT_DIR || null;
  let change: string | null = null;
  try {
    // --ignore-working-copy: reading the change must not snapshot scratch
    // files into it.
    change = execFileSync(
      "jj",
      [
        "log",
        "--ignore-working-copy",
        "--no-graph",
        "-r",
        "@",
        "-T",
        'change_id.short(8) ++ " " ++ commit_id.short(8)',
      ],
      {
        cwd: workspace ?? process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    // Not a jj workspace; the round just will not say which change it shows.
  }
  return {
    actor: agentActor(),
    session: process.env.CLAUDE_CODE_SESSION_ID ?? null,
    workspace,
    change,
  };
}

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Start the board unless it is up: detached, logging to server.log, so it
 * outlives this command and the session that ran it. */
async function ensureBoard(): Promise<boolean> {
  if (inNamespace()) {
    console.error(
      "Inside devns the board's port is the namespace's own; run `serve --detach` on the host to open it.",
    );
    return false;
  }
  if (await healthy()) return true;
  mkdirSync(home, { recursive: true });
  const log = openSync(join(home, "server.log"), "a");
  const tsx = resolve(here, "../../node_modules/.bin/tsx");
  spawn(tsx, [join(here, "server.ts")], {
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      DESIGN_FEEDBACK_HOME: home,
      DESIGN_FEEDBACK_PORT: String(port),
    },
  }).unref();
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (await healthy()) return true;
  }
  throw new Error(
    `The board did not come up on port ${port}; see ${join(home, "server.log")}`,
  );
}

function needRound(id: string | undefined) {
  if (!id) throw new Error("Which round?");
  const round = loadRound(checkRoundId(id), home);
  if (!round) throw new Error(`No round ${id} in ${home}`);
  return round;
}

const regex = (s: string | undefined) => (s ? new RegExp(s) : null);

async function cmdPublish(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      round: { type: "string" },
      next: { type: "string" },
      parent: { type: "string" },
      title: { type: "string" },
      notes: { type: "string" },
      "notes-file": { type: "string" },
      variants: { type: "string" },
      match: { type: "string" },
      skip: { type: "string" },
      question: { type: "string", multiple: true },
      dpr: { type: "string" },
      add: { type: "boolean" },
    },
  });
  if (!positionals.length)
    throw new Error("Name the screenshots: a directory or PNG files");
  const parent = values.next ?? values.parent ?? null;
  if (parent) needRound(parent);
  const id =
    values.round ??
    (values.next ? nextRoundId(values.next, takenIds(home)) : null);
  if (!id)
    throw new Error(
      "Give the round an id with --round, or follow one with --next",
    );
  checkRoundId(id);
  const shots = collectShots(positionals, {
    variants:
      values.variants === "*"
        ? "*"
        : values.variants
          ? values.variants.split(",").map((s) => s.trim())
          : null,
    match: regex(values.match),
    skip: regex(values.skip),
  });
  const notes = values["notes-file"]
    ? readFileSync(values["notes-file"], "utf8")
    : (values.notes ?? "");
  const round = await publish(
    {
      id,
      title: values.title ?? "",
      notes,
      parent,
      shots,
      questions: (values.question ?? []).map(parseQuestion),
      dpr: values.dpr ? Number(values.dpr) : null,
      add: Boolean(values.add),
      author: author(),
    },
    home,
  );
  const up = await ensureBoard();
  const keys = new Set(round.images.map((i) => i.key)).size;
  console.log(
    `Round ${round.id}: ${round.images.length} screenshots, ${keys} keys${round.variants.length ? `, variants ${round.variants.join(", ")}` : ""}.`,
  );
  console.log(`Board: ${roundUrl(round.id)}${up ? "" : " (not running yet)"}`);
  console.log(
    `For Szymon: ssh -L ${port}:localhost:${port} predator, then open the link.`,
  );
  console.log(
    `Then wait for his feedback in the background: npm run -s design-feedback -- wait ${round.id}`,
  );
}

async function printDigest(id: string, since: string | null, ack: boolean) {
  const d = await digest(id, home, { since });
  writeFileSync(join(roundDir(id, home), "digest.md"), d.markdown + "\n");
  console.log(d.markdown);
  if (ack)
    appendEvent(
      id,
      { type: "ack", at: new Date().toISOString(), by: agentActor() },
      home,
    );
}

async function cmdWait(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { timeout: { type: "string" } },
  });
  if (inNamespace()) throw new Error("Run wait on the host, not under devns");
  const round = needRound(positionals[0]);
  await ensureBoard();
  const minutes = Number(values.timeout ?? 24 * 60);
  const deadline = minutes > 0 ? Date.now() + minutes * 60_000 : Infinity;
  const remove = addWaiter(
    round.id,
    {
      pid: process.pid,
      actor: agentActor(),
      session: process.env.CLAUDE_CODE_SESSION_ID ?? null,
      since: new Date().toISOString(),
    },
    home,
  );
  const quit = () => {
    remove();
    process.exit(130);
  };
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
  console.error(
    `Waiting for Szymon to send ${round.id} back: ${roundUrl(round.id)}`,
  );
  try {
    for (;;) {
      const state = roundState(round.id, home);
      const sent = state.submits.at(-1);
      if (sent && (state.lastAck === null || sent.at > state.lastAck)) {
        await printDigest(round.id, lastRead(round, home), true);
        return;
      }
      if (Date.now() > deadline) {
        console.log(
          `No feedback on ${round.id} after ${minutes} minutes. Wait again, or read what is there with read --peek.`,
        );
        process.exitCode = 3;
        return;
      }
      await sleep(2000);
    }
  } finally {
    remove();
  }
}

async function cmdRead(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { all: { type: "boolean" }, peek: { type: "boolean" } },
  });
  const round = needRound(positionals[0]);
  const since = values.all ? null : lastRead(round, home);
  await printDigest(round.id, since, !values.peek);
}

function cmdReply(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      addressed: { type: "boolean" },
      declined: { type: "boolean" },
      in: { type: "string" },
    },
  });
  const [commentId, ...words] = positionals;
  const text = words.join(" ").trim();
  if (!commentId || !text) throw new Error('reply <comment id> "<text>"');
  if (values.addressed && values.declined)
    throw new Error("Addressed or declined, not both");
  if (values.in) needRound(values.in);
  const found = findComment(commentId, home);
  if (!found) throw new Error(`No comment ${commentId}`);
  appendEvent(
    found.round.id,
    {
      type: "reply",
      at: new Date().toISOString(),
      by: agentActor(),
      id: newId("r"),
      to: commentId,
      text,
      status: values.addressed
        ? "addressed"
        : values.declined
          ? "declined"
          : null,
      round: values.in ?? null,
    },
    home,
  );
  console.log(`Replied to ${commentId} in ${found.round.id}.`);
}

function cmdList() {
  const rounds = listRounds(home);
  if (!rounds.length) {
    console.log(`No rounds in ${home}`);
    return;
  }
  for (const r of rounds.slice(0, 40)) {
    const state = roundState(r.id, home);
    const sent = state.submits.at(-1);
    const forAgent = state.comments.filter(
      (c) => waitingOn(c) === "agent",
    ).length;
    console.log(
      [
        r.id.padEnd(36),
        r.createdAt.slice(0, 16).replace("T", " "),
        `${String(r.images.length).padStart(3)} shots`,
        `${String(state.comments.length).padStart(3)} comments`,
        `${forAgent} to do`,
        sent
          ? `${sent.verdict === "approve" ? "approved" : "sent back"} ${sent.at.slice(5, 16).replace("T", " ")}`
          : "not sent",
        r.title,
      ].join("  "),
    );
  }
}

async function cmdServe(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { detach: { type: "boolean" } },
  });
  if (inNamespace())
    throw new Error("Run the board on the host, not under devns");
  if (values.detach) {
    await ensureBoard();
    console.log(`Board: ${boardUrl()}`);
    return;
  }
  if (await healthy()) throw new Error(`A board is already on port ${port}`);
  await startServer(home, port);
}

function cmdStop() {
  const file = join(home, "server.pid");
  try {
    const { pid } = JSON.parse(readFileSync(file, "utf8")) as { pid: number };
    process.kill(pid, "SIGTERM");
    console.log(`Stopped the board (pid ${pid}).`);
  } catch {
    console.log("No board running.");
  }
  rmSync(file, { force: true });
}

async function cmdStatus() {
  const up = await healthy();
  console.log(
    `Board: ${up ? "up" : "down"} on ${boardUrl()}; store ${home}; ${listRounds(home).length} rounds.`,
  );
}

const COMMANDS: Record<string, (args: string[]) => unknown> = {
  publish: cmdPublish,
  wait: cmdWait,
  read: cmdRead,
  reply: cmdReply,
  list: cmdList,
  serve: cmdServe,
  stop: cmdStop,
  status: cmdStatus,
  url: (args) => {
    console.log(args[0] ? roundUrl(needRound(args[0]).id) : boardUrl());
  },
};

const [command, ...rest] = process.argv.slice(2);
const run = command ? COMMANDS[command] : undefined;
if (!run) {
  const head =
    readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0] ?? "";
  console.log(head.replace(/^\/\*\* ?|^ \* ?/gm, ""));
  process.exitCode = command ? 1 : 0;
} else {
  Promise.resolve(run(rest)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
