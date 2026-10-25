// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digest } from "../../scripts/design-feedback/digest";
import {
  decodeCensus,
  describeElement,
  elementsIn,
  pathTo,
  regionInDocument,
  type DomCensus,
  type DomRow,
} from "../../scripts/design-feedback/dom";
import {
  collectShots,
  nextRoundId,
  parseQuestion,
  publish,
} from "../../scripts/design-feedback/publish";
import { startServer, type Board } from "../../scripts/design-feedback/server";
import {
  appendEvent,
  carriedComments,
  foldRound,
  lastRead,
  loadRound,
  pngSize,
  roundDir,
  roundState,
  waitingOn,
  type Author,
  type Comment,
  type FeedbackEvent,
} from "../../scripts/design-feedback/store";

const T = (m: number) => new Date(Date.UTC(2026, 9, 25, 12, m)).toISOString();
const AGENT = "agent:bridge-cse_01TEST";
const AUTHOR: Author = {
  actor: AGENT,
  session: null,
  workspace: null,
  change: null,
};

const comment = (
  id: string,
  at: string,
  fields: Partial<Extract<FeedbackEvent, { type: "comment" }>> = {},
): FeedbackEvent => ({
  type: "comment",
  at,
  by: "szymon",
  id,
  image: "a/page",
  key: "page",
  variant: "a",
  region: { x: 10, y: 20, w: 30, h: 40 },
  anchor: null,
  kind: "fix",
  text: `comment ${id}`,
  ...fields,
});

let dir: string;
let shots: string;

async function png(
  file: string,
  width: number,
  height: number,
  colour = "#f4f4f4",
) {
  mkdirSync(join(file, ".."), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: colour } })
    .png()
    .toFile(file);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "design-feedback-test-"));
  shots = join(dir, "raw");
  await png(join(shots, "a", "out-desktop", "page.png"), 300, 600);
  await png(join(shots, "a", "out-desktop", "page-top.png"), 300, 200);
  await png(join(shots, "b", "out-desktop", "page.png"), 300, 640, "#eeeeee");
  await png(join(shots, "b", "out-mobile", "page.png"), 150, 400);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("foldRound", () => {
  it("follows a comment through edit, reply, resolve and reopen", () => {
    const state = foldRound("r1", [
      comment("c1", T(0)),
      {
        type: "edit",
        at: T(1),
        by: "szymon",
        id: "c1",
        text: "sharper",
        kind: "question",
      },
      {
        type: "reply",
        at: T(2),
        by: AGENT,
        id: "x1",
        to: "c1",
        text: "done",
        status: "addressed",
        round: "r2",
      },
      { type: "resolve", at: T(3), by: "szymon", to: "c1" },
      { type: "reopen", at: T(4), by: "szymon", to: "c1", text: "still not" },
    ]);
    expect(state.comments).toHaveLength(1);
    const c = state.comments[0]!;
    expect(c).toMatchObject({
      text: "sharper",
      kind: "question",
      status: "open",
      round: "r1",
      updatedAt: T(4),
    });
    expect(c.replies.map((r) => [r.by, r.text, r.status])).toEqual([
      [AGENT, "done", "addressed"],
      ["szymon", "still not", null],
    ]);
  });

  it("drops deleted comments and events about comments it never saw", () => {
    const state = foldRound("r1", [
      comment("c1", T(0)),
      { type: "delete", at: T(1), by: "szymon", id: "c1" },
      { type: "resolve", at: T(2), by: "szymon", to: "nope" },
    ]);
    expect(state.comments).toEqual([]);
  });

  it("keeps the last pick, answer and every send, and the latest read", () => {
    const state = foldRound("r1", [
      { type: "pick", at: T(0), by: "szymon", key: "page", variant: "a" },
      { type: "pick", at: T(1), by: "szymon", key: "page", variant: "b" },
      { type: "pick", at: T(1), by: "szymon", key: "other", variant: "a" },
      { type: "pick", at: T(2), by: "szymon", key: "other", variant: null },
      {
        type: "answer",
        at: T(3),
        by: "szymon",
        question: "q1",
        option: "C",
        text: "",
      },
      {
        type: "submit",
        at: T(4),
        by: "szymon",
        verdict: "iterate",
        text: "more",
      },
      { type: "ack", at: T(6), by: AGENT },
      { type: "ack", at: T(5), by: AGENT },
    ]);
    expect(state.picks).toEqual({ page: { variant: "b", at: T(1) } });
    expect(state.answers.q1).toMatchObject({ option: "C" });
    expect(state.submits).toEqual([
      { at: T(4), verdict: "iterate", text: "more" },
    ]);
    expect(state.lastAck).toBe(T(6));
  });
});

describe("waitingOn", () => {
  const base = foldRound("r1", [comment("c1", T(0))]).comments[0]!;
  const reply = (by: string): Comment["replies"][number] => ({
    id: "x",
    by,
    at: T(1),
    text: "",
    status: null,
    round: null,
  });
  it("says whose move it is", () => {
    expect(waitingOn(base)).toBe("agent");
    expect(waitingOn({ ...base, replies: [reply(AGENT)] })).toBe("owner");
    expect(
      waitingOn({ ...base, replies: [reply(AGENT), reply("szymon")] }),
    ).toBe("agent");
    expect(waitingOn({ ...base, status: "addressed" })).toBe("owner");
    expect(waitingOn({ ...base, status: "resolved" })).toBeNull();
    expect(waitingOn({ ...base, kind: "keep" })).toBeNull();
  });
});

describe("collectShots", () => {
  it("reads one directory per variant, keyed by the path inside it", () => {
    const got = collectShots([shots], { variants: ["b", "a"], skip: /-top$/ });
    expect(got.map((s) => [s.variant, s.key])).toEqual([
      ["b", "out-desktop/page"],
      ["b", "out-mobile/page"],
      ["a", "out-desktop/page"],
    ]);
    expect(
      collectShots([shots], { variants: "*" }).map((s) => s.variant),
    ).toEqual(["a", "a", "b", "b"]);
  });

  it("keys a plain directory by path and a file by its name", () => {
    expect(
      collectShots([join(shots, "a")], { match: /-top$/ }).map((s) => s.key),
    ).toEqual(["out-desktop/page-top"]);
    expect(collectShots([join(shots, "a", "out-desktop", "page.png")])).toEqual(
      [
        {
          file: join(shots, "a", "out-desktop", "page.png"),
          key: "page",
          variant: null,
        },
      ],
    );
  });

  it("refuses two screenshots that would share an id", () => {
    expect(() =>
      collectShots([
        join(shots, "a", "out-desktop", "page.png"),
        join(shots, "b", "out-desktop", "page.png"),
      ]),
    ).toThrow(/both be page/);
  });
});

describe("round ids and questions", () => {
  it("numbers the next round", () => {
    expect(nextRoundId("person-r3", new Set())).toBe("person-r4");
    expect(nextRoundId("person-r3", new Set(["person-r4"]))).toBe("person-r5");
    expect(nextRoundId("chip", new Set())).toBe("chip-r2");
  });
  it("splits a question from its options", () => {
    expect(parseQuestion("Phone rows: A or C?| A |C|", 1)).toEqual({
      id: "q2",
      text: "Phone rows: A or C?",
      options: ["A", "C"],
    });
  });
});

describe("pngSize", () => {
  it("reads the header", () => {
    expect(pngSize(join(shots, "b", "out-desktop", "page.png"))).toEqual({
      width: 300,
      height: 640,
    });
  });
  it("refuses what is not a PNG", () => {
    const f = join(dir, "not.png");
    writeFileSync(f, "GIF89a and more bytes to fill");
    expect(() => pngSize(f)).toThrow(/not a PNG/);
  });
});

describe("the DOM census", () => {
  // body > main > section(card) > [h2, p > span] and a wrapper of the same box as its child.
  const rows: DomRow[] = [
    [0, 0, 1000, 2000, -1, "main", "", "", "", "", "", ""],
    [
      100,
      100,
      400,
      300,
      0,
      "section",
      "",
      "k-card v-card v-card--variant-flat v-theme--light",
      "",
      "",
      "",
      "1a2b3c4d",
    ],
    [120, 120, 200, 30, 1, "h2", "", "k-section-title", "Historia", "", "", ""],
    [120, 170, 300, 20, 1, "div", "", "wrap", "", "", "", ""],
    [120, 170, 300, 20, 3, "p", "", "dates", "2004-2008", "", "", ""],
  ];
  const census: DomCensus = {
    v: 1,
    url: "http://localhost:3000/osoba/x",
    title: "",
    viewport: { w: 1000, h: 800 },
    dpr: 2,
    origin: { x: 0, y: 50 },
    capturedAt: T(0),
    els: rows,
  };
  const els = decodeCensus(census);

  it("turns image pixels into document pixels", () => {
    expect(
      regionInDocument({ x: 240, y: 140, w: 600, h: 40 }, 2, census.origin),
    ).toEqual({ x: 120, y: 120, w: 300, h: 20 });
  });

  it("names the element a snug box is on, the innermost of equal boxes", () => {
    const { on } = elementsIn(els, { x: 120, y: 170, w: 300, h: 20 });
    expect(on?.tag).toBe("p");
  });

  it("names the holder of a loose box and what it frames", () => {
    const { on, inside } = elementsIn(els, { x: 110, y: 110, w: 330, h: 90 });
    expect(on?.tag).toBe("section");
    expect(inside.map(describeElement)).toEqual([
      'h2.k-section-title "Historia"',
      'p.dates "2004-2008"',
    ]);
  });

  it("gives a point the smallest element under it", () => {
    expect(elementsIn(els, { x: 130, y: 130, w: 0, h: 0 }).on?.tag).toBe("h2");
  });

  it("leaves Vuetify's modifiers out of a path", () => {
    expect(pathTo(els, els[4]!)).toBe(
      "main > section.k-card.v-card > div.wrap > p.dates",
    );
  });
});

describe("publish, the chain, and the digest", () => {
  it("makes a round, carries what is open into the next, and writes a digest with crops", async () => {
    const home = join(dir, "store");
    const r1 = await publish(
      {
        id: "page-r1",
        title: "Page",
        notes: "Two takes",
        parent: null,
        shots: collectShots([shots], { variants: ["a", "b"], skip: /-top$/ }),
        questions: [parseQuestion("Which?|a|b", 0)],
        dpr: null,
        add: false,
        author: AUTHOR,
      },
      home,
    );
    expect(r1.variants).toEqual(["a", "b"]);
    expect(r1.images.map((i) => i.id)).toEqual([
      "a/out-desktop/page",
      "b/out-desktop/page",
      "b/out-mobile/page",
    ]);
    expect(
      existsSync(
        join(roundDir("page-r1", home), "thumbs/a/out-desktop/page.webp"),
      ),
    ).toBe(true);
    await expect(
      publish(
        {
          ...baseOptions(),
          id: "page-r1",
          shots: collectShots([join(shots, "a")]),
        },
        home,
      ),
    ).rejects.toThrow(/exists/);

    appendEvent(
      "page-r1",
      comment("c1", T(1), {
        image: "a/out-desktop/page",
        key: "out-desktop/page",
        variant: "a",
      }),
      home,
    );
    appendEvent(
      "page-r1",
      comment("c2", T(2), {
        image: "b/out-mobile/page",
        key: "out-mobile/page",
        variant: "b",
        kind: "keep",
        region: { x: 5, y: 5, w: 0, h: 0 },
      }),
      home,
    );
    appendEvent(
      "page-r1",
      comment("c3", T(2), {
        image: null,
        key: null,
        variant: null,
        region: null,
        text: "too busy overall",
      }),
      home,
    );
    appendEvent(
      "page-r1",
      {
        type: "pick",
        at: T(3),
        by: "szymon",
        key: "out-desktop/page",
        variant: "b",
      },
      home,
    );
    appendEvent(
      "page-r1",
      {
        type: "submit",
        at: T(4),
        by: "szymon",
        verdict: "iterate",
        text: "closer",
      },
      home,
    );

    const first = await digest("page-r1", home, { since: null });
    expect(first.todo).toBe(2);
    expect(first.markdown).toContain("**Sent back**");
    expect(first.markdown).toContain("- `out-desktop/page`: **b**");
    expect(first.markdown).toContain('q1 "Which?": not answered');
    expect(first.markdown).toMatch(/## To do .*\(2\)/);
    expect(first.markdown).toMatch(/## Keep .*\(1\)/);
    expect(existsSync(join(roundDir("page-r1", home), "crops", "c1.png"))).toBe(
      true,
    );
    expect(
      await sharp(
        join(roundDir("page-r1", home), "crops", "c2.png"),
      ).metadata(),
    ).toMatchObject({ format: "png" });

    appendEvent("page-r1", { type: "ack", at: T(5), by: AGENT }, home);
    appendEvent(
      "page-r1",
      {
        type: "reply",
        at: T(6),
        by: AGENT,
        id: "x1",
        to: "c1",
        text: "darker",
        status: "addressed",
        round: "page-r2",
      },
      home,
    );

    const r2 = await publish(
      {
        ...baseOptions(),
        id: "page-r2",
        parent: "page-r1",
        shots: collectShots([shots], { variants: ["b"], skip: /-top$/ }),
      },
      home,
    );
    const carried = carriedComments(r2, home);
    expect(carried.map((c) => [c.id, c.mapsTo])).toEqual([
      ["c1", "b/out-desktop/page"],
      ["c2", "b/out-mobile/page"],
      ["c3", null],
    ]);
    expect(lastRead(r2, home)).toBe(T(5));

    const second = await digest("page-r2", home, { since: lastRead(r2, home) });
    expect(second.markdown).toContain("Not sent yet");
    expect(second.markdown).toMatch(/## Waiting on Szymon .*\(1\)/);
    expect(second.markdown).toContain("(c1, from page-r1)");
    expect(second.markdown).not.toContain("new)");

    appendEvent(
      "page-r1",
      { type: "resolve", at: T(7), by: "szymon", to: "c1" },
      home,
    );
    expect(carriedComments(r2, home).map((c) => c.id)).toEqual(["c2", "c3"]);
  });
});

function baseOptions() {
  return {
    id: "",
    title: "",
    notes: "",
    parent: null,
    shots: [],
    questions: [],
    dpr: null,
    add: false,
    author: AUTHOR,
  };
}

describe("the board's API", () => {
  let board: Board;
  let home: string;
  let base: string;
  const json = { "content-type": "application/json" };

  beforeAll(async () => {
    home = join(dir, "board");
    await publish(
      {
        ...baseOptions(),
        id: "b-r1",
        shots: collectShots([shots], { variants: ["a", "b"], skip: /-top$/ }),
        questions: [parseQuestion("Which?|a|b", 0)],
      },
      home,
    );
    board = await startServer(home, 0, false);
    base = `http://127.0.0.1:${board.port}`;
  });
  afterAll(() => board.close());

  const send = (body: unknown, round = "b-r1") =>
    fetch(`${base}/api/rounds/${round}/events`, {
      method: "POST",
      headers: json,
      body: JSON.stringify(body),
    });

  it("lists rounds and serves a round's files", async () => {
    const list = (await (await fetch(`${base}/api/rounds`)).json()) as {
      rounds: { id: string; images: number }[];
    };
    expect(list.rounds).toMatchObject([{ id: "b-r1", images: 3 }]);
    const img = await fetch(
      `${base}/api/rounds/b-r1/files/images/a/out-desktop/page.png`,
    );
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(
      (await fetch(`${base}/api/rounds/b-r1/files/round.json`)).status,
    ).toBe(404);
    expect(
      (await fetch(`${base}/api/rounds/b-r1/files/images/..%2F..%2Fround.json`))
        .status,
    ).toBe(404);
  });

  it("writes what the page posts as Szymon, with ids and key filled in", async () => {
    const res = await send({
      type: "comment",
      image: "b/out-mobile/page",
      region: { x: 1, y: 2, w: 3, h: 4 },
      kind: "rule",
      text: " Always like this ",
    });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const c = roundState("b-r1", home).comments.find((x) => x.id === id);
    expect(c).toMatchObject({
      by: "szymon",
      key: "out-mobile/page",
      variant: "b",
      kind: "rule",
      text: "Always like this",
    });
    expect((await send({ type: "resolve", to: id })).status).toBe(200);
    expect(
      roundState("b-r1", home).comments.find((x) => x.id === id)?.status,
    ).toBe("resolved");
  });

  it("refuses what does not fit the round", async () => {
    expect(
      (
        await send({
          type: "comment",
          image: "c/nothing",
          region: null,
          kind: "fix",
          text: "x",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send({
          type: "comment",
          image: null,
          region: null,
          kind: "shout",
          text: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send({
          type: "comment",
          image: null,
          region: null,
          kind: "fix",
          text: "   ",
        })
      ).status,
    ).toBe(400);
    expect(
      (await send({ type: "pick", key: "out-mobile/page", variant: "b" }))
        .status,
    ).toBe(400);
    expect(
      (await send({ type: "pick", key: "out-desktop/page", variant: "z" }))
        .status,
    ).toBe(400);
    expect(
      (await send({ type: "answer", question: "q9", option: null, text: "" }))
        .status,
    ).toBe(404);
    expect(
      (await send({ type: "reply", to: "c-none", text: "hi" })).status,
    ).toBe(404);
    expect(
      (await send({ type: "submit", verdict: "iterate" }, "no-such-round"))
        .status,
    ).toBe(404);
  });

  it("only answers to its own name, and only JSON writes", async () => {
    // fetch() keeps a Host header of its own; a rebinding page's would not.
    const foreign = await new Promise<number>((done, fail) =>
      request(
        {
          host: "127.0.0.1",
          port: board.port,
          path: "/api/rounds",
          headers: { host: "evil.example:4848" },
        },
        (res) => {
          res.resume();
          done(res.statusCode ?? 0);
        },
      )
        .on("error", fail)
        .end(),
    );
    expect(foreign).toBe(403);
    const form = await fetch(`${base}/api/rounds/b-r1/events`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect(form.status).toBe(415);
  });

  it("takes a send and shows it in the round", async () => {
    expect(
      (await send({ type: "pick", key: "out-desktop/page", variant: "a" }))
        .status,
    ).toBe(200);
    expect(
      (await send({ type: "submit", verdict: "approve", text: "ship it" }))
        .status,
    ).toBe(200);
    const detail = (await (await fetch(`${base}/api/rounds/b-r1`)).json()) as {
      state: { submits: unknown[]; picks: unknown };
    };
    expect(detail.state.submits).toMatchObject([
      { verdict: "approve", text: "ship it" },
    ]);
    expect(detail.state.picks).toMatchObject({
      "out-desktop/page": { variant: "a" },
    });
    expect(
      JSON.parse(
        readFileSync(join(roundDir("b-r1", home), "round.json"), "utf8"),
      ),
    ).toMatchObject({ id: "b-r1" });
    expect(loadRound("b-r1", home)?.questions).toHaveLength(1);
  });
});
