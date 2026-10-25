/** Design rounds for Szymon to comment on, and what he said about them.
 *
 * An agent working on the look of a page publishes its screenshots as a
 * round. Szymon opens the board (server.ts, over `ssh -L`), draws a box on the
 * part he means, says what is wrong with it, and sends the lot back. The agent
 * reads it as a digest (digest.ts) with a crop of every box, so a comment
 * arrives pinned to the pixels it is about instead of described in chat
 * ("the dates in the second card, on the phone").
 *
 * Everything lives in files under one directory that every workspace on the
 * machine shares, ~/.cache/koryta/design-feedback unless DESIGN_FEEDBACK_HOME
 * names another:
 *
 *   rounds/<id>/round.json     what the agent published: screenshots, notes, questions
 *   rounds/<id>/images/…       the screenshots, copied rather than linked, since
 *                              a re-render writes into the same inode
 *   rounds/<id>/events.jsonl   every comment, reply, pick and send, appended
 *
 * The log is append-only, one event a line, so the board and any number of
 * agents can write to it at once without a lock, and an edited comment keeps
 * what it said before. A round's state is its log folded up (`foldRound`).
 */
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const storeHome = (env: NodeJS.ProcessEnv = process.env): string =>
  env.DESIGN_FEEDBACK_HOME ||
  join(homedir(), ".cache", "koryta", "design-feedback");

/** The board's port on predator's loopback, the one `ssh -L` forwards. */
export const boardPort = (env: NodeJS.ProcessEnv = process.env): number =>
  Number(env.DESIGN_FEEDBACK_PORT || 4848);

export const boardUrl = (path = "", env: NodeJS.ProcessEnv = process.env) =>
  `http://localhost:${boardPort(env)}/${path}`;

export const roundUrl = (id: string, env: NodeJS.ProcessEnv = process.env) =>
  boardUrl(`#/r/${encodeURIComponent(id)}`, env);

const ROUND_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

export function checkRoundId(id: string): string {
  if (!ROUND_ID.test(id)) {
    throw new Error(
      `Bad round id ${JSON.stringify(id)}: up to 80 letters, digits, ".", "_" ` +
        `and "-", starting with a letter or a digit`,
    );
  }
  return id;
}

export const roundsDir = (home: string) => join(home, "rounds");
export const roundDir = (id: string, home: string) =>
  join(roundsDir(home), checkRoundId(id));

/** A box on a screenshot, in the image's own pixels (a 2x phone shot of a
 * 375px page is 750 wide). A click with nothing under it to snap to is a box
 * of no size. */
export type Region = { x: number; y: number; w: number; h: number };

/** What a comment asks for. `keep` and `rule` ask for nothing to be fixed:
 * `keep` protects something the next round must not lose, and `rule` is
 * something Szymon wants everywhere, which the agent proposes for
 * `.interface-design/system.md` (as a task - only he writes that file). */
export const COMMENT_KINDS = ["fix", "keep", "question", "rule"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

/** `addressed`: done, Szymon to check it in the next round. `declined`: not
 * done, and the reply says why. */
export const REPLY_STATUSES = ["addressed", "declined"] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

export const VERDICTS = ["iterate", "approve"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** The element a click snapped to, as the board saw it in the screenshot's
 * DOM census - kept on the comment, so the digest can name it without the
 * census at hand. */
export type Anchor = { path: string; text: string };

export type FeedbackEvent = { at: string; by: string } & (
  | {
      type: "comment";
      id: string;
      image: string | null;
      key: string | null;
      variant: string | null;
      region: Region | null;
      anchor: Anchor | null;
      kind: CommentKind;
      text: string;
    }
  | {
      type: "edit";
      id: string;
      text?: string;
      kind?: CommentKind;
      region?: Region | null;
    }
  | { type: "delete"; id: string }
  | {
      type: "reply";
      id: string;
      to: string;
      text: string;
      status: ReplyStatus | null;
      /** The round that shows the change, when the reply says it is done. */
      round: string | null;
    }
  | { type: "resolve"; to: string }
  | { type: "reopen"; to: string; text: string }
  | { type: "pick"; key: string; variant: string | null }
  | { type: "answer"; question: string; option: string | null; text: string }
  | { type: "submit"; verdict: Verdict; text: string }
  /** An agent has read everything up to `at`: what came later is new. */
  | { type: "ack" }
);
export type EventType = FeedbackEvent["type"];

export type RoundImage = {
  /** `<variant>/<key>`, or the key alone when the round has no variants. */
  id: string;
  /** What the screenshot shows, the same across variants and rounds:
   * `out-desktop/osoba-karolczak`. */
  key: string;
  variant: string | null;
  /** Paths inside the round's directory. */
  file: string;
  thumb: string | null;
  dom: string | null;
  width: number;
  height: number;
  /** Image pixels per CSS pixel. */
  dpr: number;
  url: string | null;
};

export type Question = { id: string; text: string; options: string[] };

export type Author = {
  actor: string;
  session: string | null;
  workspace: string | null;
  change: string | null;
};

export type Round = {
  id: string;
  title: string;
  notes: string;
  parent: string | null;
  createdAt: string;
  updatedAt: string;
  author: Author;
  variants: string[];
  questions: Question[];
  images: RoundImage[];
};

export type Reply = {
  id: string;
  by: string;
  at: string;
  text: string;
  status: ReplyStatus | null;
  round: string | null;
};

export type CommentStatus = "open" | "addressed" | "resolved";

export type Comment = {
  id: string;
  /** The round the comment was made in, which keeps its thread. */
  round: string;
  image: string | null;
  key: string | null;
  variant: string | null;
  region: Region | null;
  anchor: Anchor | null;
  kind: CommentKind;
  text: string;
  by: string;
  at: string;
  /** When anyone last touched it: edit, reply, resolve. */
  updatedAt: string;
  status: CommentStatus;
  replies: Reply[];
};

export type RoundState = {
  comments: Comment[];
  picks: Record<string, { variant: string; at: string }>;
  answers: Record<string, { option: string | null; text: string; at: string }>;
  submits: { at: string; verdict: Verdict; text: string }[];
  lastAck: string | null;
};

export const OWNER = "szymon";
export const isAgent = (by: string) => by.startsWith("agent");

/** Who is waiting on whom for a comment: the agent has something to do, or
 * Szymon has a reply or a fix to look at. A `keep` waits on nobody. */
export function waitingOn(c: Comment): "agent" | "owner" | null {
  if (c.status === "resolved" || c.kind === "keep") return null;
  if (c.status === "addressed") return "owner";
  const last = c.replies.at(-1);
  return last && isAgent(last.by) ? "owner" : "agent";
}

export const newId = (prefix: string) =>
  prefix + randomBytes(5).toString("hex").slice(0, 7);

/** Width and height from a PNG's header, without decoding it. */
export function pngSize(file: string): { width: number; height: number } {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(24);
    readSync(fd, head, 0, 24, 0);
    const signature = head.subarray(0, 8).toString("hex");
    if (
      signature !== "89504e470d0a1a0a" ||
      head.toString("latin1", 12, 16) !== "IHDR"
    ) {
      throw new Error(`${file} is not a PNG`);
    }
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } finally {
    closeSync(fd);
  }
}

/** Write through a temporary file, so a reader never sees half of one. */
export function writeAtomic(file: string, content: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

export function loadRound(id: string, home: string): Round | null {
  const file = join(roundDir(id, home), "round.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Round;
}

export function saveRound(round: Round, home: string) {
  const dir = roundDir(round.id, home);
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, "round.json"), JSON.stringify(round, null, 1));
}

/** Every round, newest first. */
export function listRounds(home: string): Round[] {
  const dir = roundsDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => ROUND_ID.test(name))
    .map((name) => loadRound(name, home))
    .filter((r): r is Round => r !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const eventsFile = (id: string, home: string) =>
  join(roundDir(id, home), "events.jsonl");

/** One line, one write: appends this small from separate processes land
 * whole and in order on a local filesystem. */
export function appendEvent(id: string, event: FeedbackEvent, home: string) {
  appendFileSync(eventsFile(id, home), JSON.stringify(event) + "\n");
}

export function readEvents(id: string, home: string): FeedbackEvent[] {
  const file = eventsFile(id, home);
  if (!existsSync(file)) return [];
  const events: FeedbackEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as FeedbackEvent);
    } catch {
      // A line torn by a crash mid-write: the rest of the log still holds.
    }
  }
  return events;
}

/** The round as its log leaves it. Events about a comment that is not there
 * (deleted, or never made in this round) change nothing. */
export function foldRound(
  roundId: string,
  events: FeedbackEvent[],
): RoundState {
  const comments = new Map<string, Comment>();
  const picks = new Map<string, { variant: string; at: string }>();
  const state: RoundState = {
    comments: [],
    picks: {},
    answers: {},
    submits: [],
    lastAck: null,
  };
  for (const e of events) {
    switch (e.type) {
      case "comment":
        comments.set(e.id, {
          id: e.id,
          round: roundId,
          image: e.image,
          key: e.key,
          variant: e.variant,
          region: e.region,
          anchor: e.anchor,
          kind: e.kind,
          text: e.text,
          by: e.by,
          at: e.at,
          updatedAt: e.at,
          status: "open",
          replies: [],
        });
        break;
      case "edit": {
        const c = comments.get(e.id);
        if (!c) break;
        if (e.text !== undefined) c.text = e.text;
        if (e.kind !== undefined) c.kind = e.kind;
        if (e.region !== undefined) c.region = e.region;
        c.updatedAt = e.at;
        break;
      }
      case "delete":
        comments.delete(e.id);
        break;
      case "reply": {
        const c = comments.get(e.to);
        if (!c) break;
        c.replies.push({
          id: e.id,
          by: e.by,
          at: e.at,
          text: e.text,
          status: e.status,
          round: e.round,
        });
        if (e.status === "addressed") c.status = "addressed";
        else if (e.status === "declined") c.status = "open";
        c.updatedAt = e.at;
        break;
      }
      case "resolve": {
        const c = comments.get(e.to);
        if (!c) break;
        c.status = "resolved";
        c.updatedAt = e.at;
        break;
      }
      case "reopen": {
        const c = comments.get(e.to);
        if (!c) break;
        c.status = "open";
        if (e.text) {
          c.replies.push({
            id: `${e.to}-reopen-${c.replies.length}`,
            by: e.by,
            at: e.at,
            text: e.text,
            status: null,
            round: null,
          });
        }
        c.updatedAt = e.at;
        break;
      }
      case "pick":
        if (e.variant === null) picks.delete(e.key);
        else picks.set(e.key, { variant: e.variant, at: e.at });
        break;
      case "answer":
        state.answers[e.question] = {
          option: e.option,
          text: e.text,
          at: e.at,
        };
        break;
      case "submit":
        state.submits.push({ at: e.at, verdict: e.verdict, text: e.text });
        break;
      case "ack":
        if (!state.lastAck || e.at > state.lastAck) state.lastAck = e.at;
        break;
    }
  }
  state.comments = [...comments.values()];
  state.picks = Object.fromEntries(picks);
  return state;
}

export const roundState = (id: string, home: string) =>
  foldRound(id, readEvents(id, home));

/** A comment from an earlier round of the chain that is not resolved yet,
 * and the screenshot of this round it belongs on: the same key, and the same
 * variant if this round has it. */
export type Carried = Comment & { mapsTo: string | null };

/** The rounds before this one, nearest first, following `parent`. */
export function ancestors(round: Round, home: string): Round[] {
  const chain: Round[] = [];
  const seen = new Set([round.id]);
  let next = round.parent;
  while (next && !seen.has(next)) {
    seen.add(next);
    const parent = loadRound(next, home);
    if (!parent) break;
    chain.push(parent);
    next = parent.parent;
  }
  return chain;
}

export function imageFor(
  round: Round,
  key: string | null,
  variant: string | null,
): RoundImage | null {
  if (key === null) return null;
  const same = round.images.filter((i) => i.key === key);
  return same.find((i) => i.variant === variant) ?? same[0] ?? null;
}

/** When an agent last read this round or any round before it: what Szymon
 * did after that is new to it. A fresh round inherits its parent's reading,
 * so the comments it carries over are not news a second time. */
export function lastRead(round: Round, home: string): string | null {
  let latest = roundState(round.id, home).lastAck;
  for (const r of ancestors(round, home)) {
    const ack = roundState(r.id, home).lastAck;
    if (ack && (!latest || ack > latest)) latest = ack;
  }
  return latest;
}

/** What the rounds before this one left open. Each comment lives in the
 * round it was made in, so a chain carries every comment at most once. */
export function carriedComments(round: Round, home: string): Carried[] {
  return ancestors(round, home).flatMap((parent) =>
    roundState(parent.id, home)
      .comments.filter((c) => c.status !== "resolved")
      .map((c) => ({
        ...c,
        mapsTo: imageFor(round, c.key, c.variant)?.id ?? null,
      })),
  );
}

/** The round a comment was made in, found by searching every log: a reply
 * names the comment, not the round. */
export function findComment(
  commentId: string,
  home: string,
): { round: Round; comment: Comment } | null {
  for (const round of listRounds(home)) {
    const comment = roundState(round.id, home).comments.find(
      (c) => c.id === commentId,
    );
    if (comment) return { round, comment };
  }
  return null;
}

export const childrenOf = (id: string, rounds: Round[]) =>
  rounds.filter((r) => r.parent === id).map((r) => r.id);

/** An agent blocked in `wait` on a round, so the board can say a send will
 * reach somebody. One file per process, removed when it stops; a file whose
 * process is gone (killed with its session) is cleaned up on the next read. */
export type Waiter = {
  pid: number;
  actor: string;
  session: string | null;
  since: string;
};

const waitersDir = (id: string, home: string) =>
  join(roundDir(id, home), "waiters");

export function addWaiter(id: string, waiter: Waiter, home: string) {
  const dir = waitersDir(id, home);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${waiter.pid}.json`);
  writeAtomic(file, JSON.stringify(waiter));
  return () => rmSync(file, { force: true });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

export function liveWaiters(id: string, home: string): Waiter[] {
  const dir = waitersDir(id, home);
  if (!existsSync(dir)) return [];
  const waiters: Waiter[] = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    try {
      const w = JSON.parse(readFileSync(file, "utf8")) as Waiter;
      if (alive(w.pid)) waiters.push(w);
      else rmSync(file, { force: true });
    } catch {
      rmSync(file, { force: true });
    }
  }
  return waiters;
}

/** Who the log says did something: an agent and the workspace it ran in,
 * which is named after its session (see agentActor in ../mcp/tasks.ts). */
export function agentActor(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CLAUDE_PROJECT_DIR || process.cwd();
  const name = basename(dir).replace(/[^A-Za-z0-9_.-]/g, "");
  return name ? `agent:${name}` : "agent";
}

/** A path segment of an image id: what a file name may carry, minus
 * anything that could climb out of the round's directory. */
export const safeSegment = (s: string) =>
  s.replace(/[^A-Za-z0-9._+@=-]/g, "-").replace(/^\.+/, "-");
