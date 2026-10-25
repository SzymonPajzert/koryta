/** The board: a web page on predator's loopback where Szymon looks through a
 * round's screenshots and pins comments to them. He reaches it through
 * `ssh -L 4848:localhost:4848 predator`; nothing listens beyond 127.0.0.1.
 *
 * It serves the page in ui/, the rounds' files, and a small JSON API over
 * store.ts. Everything it writes is an event appended to a round's log, by
 * `szymon` - there is nobody else on the other end of the tunnel.
 *
 * Started by the CLI when a command needs it (`publish`, `wait`), detached,
 * so it outlives the agent that started it; `cli.ts stop` ends it. It reads
 * ui/ once at start, so removing the workspace it was started from does not
 * break a running board.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  appendEvent,
  boardPort,
  carriedComments,
  childrenOf,
  COMMENT_KINDS,
  liveWaiters,
  listRounds,
  loadRound,
  newId,
  OWNER,
  roundDir,
  roundsDir,
  roundState,
  storeHome,
  VERDICTS,
  waitingOn,
  type FeedbackEvent,
  type Round,
} from "./store";

const here = dirname(fileURLToPath(import.meta.url));

const UI_FILES: Record<string, string> = {
  "/": "index.html",
  "/board.js": "board.js",
  "/board.css": "board.css",
};
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  png: "image/png",
  webp: "image/webp",
};

const region = z.object({
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
  w: z.number().finite().min(0),
  h: z.number().finite().min(0),
});
const text = z.string().trim().min(1).max(10_000);
const id = z.string().min(1).max(40);

/** What the page may post. The server adds who, when and the new ids, and
 * reads key and variant off the round, so the page cannot get them wrong. */
const incoming = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("comment"),
    image: z.string().max(400).nullable(),
    region: region.nullable(),
    anchor: z
      .object({ path: z.string().max(600), text: z.string().max(200) })
      .nullable()
      .default(null),
    kind: z.enum(COMMENT_KINDS),
    text,
  }),
  z.object({
    type: z.literal("edit"),
    id,
    text: text.optional(),
    kind: z.enum(COMMENT_KINDS).optional(),
    region: region.nullable().optional(),
  }),
  z.object({ type: z.literal("delete"), id }),
  z.object({ type: z.literal("reply"), to: id, text }),
  z.object({ type: z.literal("resolve"), to: id }),
  z.object({
    type: z.literal("reopen"),
    to: id,
    text: z.string().trim().max(10_000).default(""),
  }),
  z.object({
    type: z.literal("pick"),
    key: z.string().max(400),
    variant: z.string().max(120).nullable(),
  }),
  z.object({
    type: z.literal("answer"),
    question: z.string().max(20),
    option: z.string().max(400).nullable(),
    text: z.string().trim().max(10_000).default(""),
  }),
  z.object({
    type: z.literal("submit"),
    verdict: z.enum(VERDICTS),
    text: z.string().trim().max(10_000).default(""),
  }),
]);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function summary(round: Round, rounds: Round[], home: string) {
  const state = roundState(round.id, home);
  const carried = carriedComments(round, home);
  const all = [...state.comments, ...carried];
  const count = (w: "agent" | "owner") =>
    all.filter((c) => waitingOn(c) === w).length;
  const first = round.images[0];
  return {
    id: round.id,
    title: round.title,
    parent: round.parent,
    children: childrenOf(round.id, rounds),
    createdAt: round.createdAt,
    updatedAt: round.updatedAt,
    author: round.author,
    images: round.images.length,
    variants: round.variants,
    thumb: first?.thumb ?? null,
    comments: state.comments.length,
    forAgent: count("agent"),
    forOwner: count("owner"),
    lastSubmit: state.submits.at(-1) ?? null,
    waiters: liveWaiters(round.id, home),
  };
}

function detail(round: Round, home: string) {
  const rounds = listRounds(home);
  const chain: { id: string; title: string }[] = [];
  for (let at = round.parent; at;) {
    const r = rounds.find((x) => x.id === at);
    if (!r || chain.some((c) => c.id === r.id)) break;
    chain.push({ id: r.id, title: r.title });
    at = r.parent;
  }
  return {
    round,
    state: roundState(round.id, home),
    carried: carriedComments(round, home),
    children: childrenOf(round.id, rounds),
    ancestors: chain,
    waiters: liveWaiters(round.id, home),
  };
}

/** The newest change anywhere in the store, for the page to poll. */
function stamp(home: string): number {
  let latest = 0;
  const dir = roundsDir(home);
  if (!existsSync(dir)) return 0;
  for (const r of listRounds(home)) {
    const rd = roundDir(r.id, home);
    for (const f of ["round.json", "events.jsonl", "waiters"]) {
      const p = join(rd, f);
      if (existsSync(p)) latest = Math.max(latest, statSync(p).mtimeMs);
    }
  }
  return latest;
}

function toEvent(
  round: Round,
  body: z.infer<typeof incoming>,
  home: string,
): FeedbackEvent {
  const at = new Date().toISOString();
  const by = OWNER;
  const state = roundState(round.id, home);
  const hasComment = (cid: string) => {
    if (!state.comments.some((c) => c.id === cid)) {
      throw new HttpError(404, `No comment ${cid} in round ${round.id}`);
    }
  };
  switch (body.type) {
    case "comment": {
      const image =
        body.image === null
          ? null
          : round.images.find((i) => i.id === body.image);
      if (image === undefined) {
        throw new HttpError(404, `No image ${String(body.image)}`);
      }
      return {
        type: "comment",
        at,
        by,
        id: newId("c"),
        image: image?.id ?? null,
        key: image?.key ?? null,
        variant: image?.variant ?? null,
        region: body.region,
        anchor: body.anchor,
        kind: body.kind,
        text: body.text,
      };
    }
    case "edit":
    case "delete":
      hasComment(body.id);
      return { ...body, at, by };
    case "reply":
      hasComment(body.to);
      return {
        type: "reply",
        at,
        by,
        id: newId("r"),
        to: body.to,
        text: body.text,
        status: null,
        round: null,
      };
    case "resolve":
    case "reopen":
      hasComment(body.to);
      return { ...body, at, by };
    case "pick": {
      const variants = round.images
        .filter((i) => i.key === body.key)
        .map((i) => i.variant);
      if (
        variants.length < 2 ||
        (body.variant && !variants.includes(body.variant))
      ) {
        throw new HttpError(400, `Nothing to pick for ${body.key}`);
      }
      return { ...body, at, by };
    }
    case "answer":
      if (!round.questions.some((q) => q.id === body.question)) {
        throw new HttpError(404, `No question ${body.question}`);
      }
      return { ...body, at, by };
    case "submit":
      return { ...body, at, by };
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 256_000) throw new HttpError(413, "Too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Not JSON");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": TYPES.json,
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendFile(req: IncomingMessage, res: ServerResponse, path: string) {
  const st = statSync(path);
  const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type":
      TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream",
    "cache-control": "no-cache",
    etag,
  });
  res.end(readFileSync(path));
}

/** A tunnel may land on any local port, but the name must be the machine's
 * own: a page elsewhere that points a name of its own at 127.0.0.1 (DNS
 * rebinding) gets nothing. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export type Board = { port: number; close: () => Promise<void> };

/** The board on `port` (0: any free one). `own` makes this process the
 * board's: it writes server.pid and stops on SIGTERM; a test leaves it off. */
export function startServer(
  home = storeHome(),
  port = boardPort(),
  own = true,
): Promise<Board> {
  const ui = Object.fromEntries(
    Object.entries(UI_FILES).map(([route, file]) => [
      route,
      readFileSync(join(here, "ui", file), "utf8"),
    ]),
  );

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: e instanceof Error ? e.message : String(e) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!LOCAL_HOST.test(req.headers.host ?? "")) {
      throw new HttpError(403, "Open the board as localhost");
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const page = UI_FILES[path];
    if (req.method === "GET" && page) {
      const ext = page.split(".").pop() ?? "html";
      res.writeHead(200, {
        "content-type": TYPES[ext] ?? TYPES.html,
        "cache-control": "no-cache",
      });
      res.end(ui[path]);
      return;
    }
    if (path === "/api/health") {
      send(res, 200, { ok: true, pid: process.pid, home, port });
      return;
    }
    if (path === "/api/stamp") {
      send(res, 200, { stamp: stamp(home) });
      return;
    }
    if (path === "/api/rounds" && req.method === "GET") {
      const rounds = listRounds(home);
      send(res, 200, { rounds: rounds.map((r) => summary(r, rounds, home)) });
      return;
    }
    const m = /^\/api\/rounds\/([^/]+)(\/.*)?$/.exec(path);
    if (!m) throw new HttpError(404, "Not found");
    const roundId = decodeURIComponent(m[1] ?? "");
    const rest = m[2] ?? "";
    let round: Round | null;
    try {
      round = loadRound(roundId, home);
    } catch {
      throw new HttpError(400, "Bad round id");
    }
    if (!round) throw new HttpError(404, `No round ${roundId}`);

    if (rest === "" && req.method === "GET") {
      send(res, 200, detail(round, home));
      return;
    }
    if (rest === "/events" && req.method === "POST") {
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
        throw new HttpError(415, "Send JSON");
      }
      const parsed = incoming.safeParse(await readBody(req));
      if (!parsed.success) {
        throw new HttpError(
          400,
          parsed.error.issues.map((i) => i.message).join("; "),
        );
      }
      const event = toEvent(round, parsed.data, home);
      appendEvent(round.id, event, home);
      send(res, 200, { ok: true, id: "id" in event ? event.id : null });
      return;
    }
    if (rest.startsWith("/files/") && req.method === "GET") {
      const rel = decodeURIComponent(rest.slice("/files/".length));
      if (
        !/^(images|thumbs|crops)\/[A-Za-z0-9._+@=/-]+\.(png|webp|json)$/.test(
          rel,
        )
      ) {
        throw new HttpError(404, "Not found");
      }
      const base = roundDir(round.id, home);
      const file = resolve(base, rel);
      if (!file.startsWith(base + sep) || !existsSync(file)) {
        throw new HttpError(404, "Not found");
      }
      sendFile(req, res, file);
      return;
    }
    throw new HttpError(404, "Not found");
  }

  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const bound =
        typeof address === "object" && address ? address.port : port;
      const close = () =>
        new Promise<void>((closed) => server.close(() => closed()));
      if (!own) {
        done({ port: bound, close });
        return;
      }
      mkdirSync(home, { recursive: true });
      const pidFile = join(home, "server.pid");
      writeFileSync(
        pidFile,
        JSON.stringify({
          pid: process.pid,
          port: bound,
          started: new Date().toISOString(),
          from: here,
        }),
      );
      const stop = () => {
        try {
          const held = JSON.parse(readFileSync(pidFile, "utf8")) as {
            pid: number;
          };
          if (held.pid === process.pid) rmSync(pidFile, { force: true });
        } catch {
          // Already gone.
        }
        process.exit(0);
      };
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
      console.error(
        `design feedback board on http://localhost:${bound}/ (store ${home})`,
      );
      done({ port: bound, close });
    });
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  startServer().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
