/** What Szymon said about a round, written for the agent that made it.
 *
 * Markdown, grouped by what each comment asks of the agent: what to fix, what
 * waits on Szymon, what to keep, what he wants everywhere. Every box comes
 * with a crop of the screenshot around it, outlined, for the agent to Read -
 * the crop is the part of the comment words cannot carry - and, when the
 * screenshot has a DOM census, with the elements it is on.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import {
  decodeCensus,
  describeElement,
  elementsIn,
  pathTo,
  regionInDocument,
  scopesOf,
  type DomCensus,
  type DomElement,
} from "./dom";
import {
  carriedComments,
  isAgent,
  loadRound,
  roundDir,
  roundState,
  roundUrl,
  waitingOn,
  type Comment,
  type Round,
  type RoundImage,
  type RoundState,
} from "./store";

const RED = "#e11d48";

/** The screenshot around a comment's box, the box outlined; a point gets a
 * ring. Wide crops are scaled to 1600px so they stay readable once Read. */
export async function cropComment(
  src: string,
  image: RoundImage,
  comment: Comment,
  out: string,
): Promise<string | null> {
  const r = comment.region;
  if (!r || !existsSync(src)) return null;
  const point = r.w === 0 && r.h === 0;
  const unit = image.dpr;
  const margin = point
    ? 160 * unit
    : Math.min(160 * unit, Math.max(40 * unit, 0.35 * Math.max(r.w, r.h)));
  const left = Math.max(0, Math.floor(r.x - margin));
  const top = Math.max(0, Math.floor(r.y - margin));
  const right = Math.min(image.width, Math.ceil(r.x + r.w + margin));
  const bottom = Math.min(image.height, Math.ceil(r.y + r.h + margin));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  const stroke = 3 * unit;
  const mark = point
    ? `<circle cx="${r.x - left}" cy="${r.y - top}" r="${12 * unit}" fill="none" stroke="${RED}" stroke-width="${stroke}"/>`
    : `<rect x="${r.x - left}" y="${r.y - top}" width="${r.w}" height="${r.h}" fill="none" stroke="${RED}" stroke-width="${stroke}"/>`;
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${mark}</svg>`,
  );
  let pipeline = sharp(src)
    .extract({ left, top, width, height })
    .composite([{ input: overlay, top: 0, left: 0 }]);
  if (width > 1600) {
    // composite() runs last in sharp's pipeline, so scale in a second pass.
    const buf = await pipeline.png().toBuffer();
    pipeline = sharp(buf).resize({ width: 1600 });
  }
  await pipeline.png().toFile(out);
  return out;
}

type Located = {
  on: string | null;
  path: string | null;
  inside: string[];
  scopes: string[];
};

const censusCache = new Map<string, { census: DomCensus; els: DomElement[] }>();

function loadCensus(path: string) {
  let hit = censusCache.get(path);
  if (!hit) {
    const census = JSON.parse(readFileSync(path, "utf8")) as DomCensus;
    hit = { census, els: decodeCensus(census) };
    censusCache.set(path, hit);
  }
  return hit;
}

/** The elements a comment's box is on, from its screenshot's census. */
export function locate(
  dir: string,
  image: RoundImage,
  comment: Comment,
): Located | null {
  if (!comment.region || !image.dom) return null;
  const path = join(dir, image.dom);
  if (!existsSync(path)) return null;
  const { census, els } = loadCensus(path);
  const box = regionInDocument(comment.region, image.dpr, census.origin);
  const { on, inside } = elementsIn(els, box);
  return {
    on: on ? describeElement(on) : null,
    path: on ? pathTo(els, on) : null,
    inside: inside.map(describeElement),
    scopes: on ? scopesOf(els, on) : [],
  };
}

const px = (n: number) => Math.round(n);

function boxLine(c: Comment, image: RoundImage | null): string | null {
  const r = c.region;
  if (!r) return null;
  const d = image?.dpr ?? 1;
  const where =
    r.w === 0 && r.h === 0
      ? `point ${px(r.x / d)},${px(r.y / d)}`
      : `x ${px(r.x / d)}-${px((r.x + r.w) / d)}, y ${px(r.y / d)}-${px((r.y + r.h) / d)}`;
  const page = image ? ` of a ${px(image.width / d)}px wide screenshot` : "";
  return `${where} (CSS px${page})`;
}

const who = (by: string) => (isAgent(by) ? "you" : "Szymon");

function threadLines(c: Comment): string[] {
  return c.replies.map((r) => {
    const status = r.status
      ? ` (${r.status}${r.round ? `, in ${r.round}` : ""})`
      : "";
    return `${who(r.by)}${status}: ${JSON.stringify(r.text)}`;
  });
}

type Entry = {
  comment: Comment;
  image: RoundImage | null;
  dir: string;
  /** The round of the chain the comment was made in, when not this one. */
  from: string | null;
  isNew: boolean;
};

async function entryLines(
  e: Entry,
  cropDir: string,
  n: number,
): Promise<string[]> {
  const c = e.comment;
  const where = c.key
    ? `\`${c.key}\`${c.variant ? ` [${c.variant}]` : ""}`
    : "the whole round";
  const tags = [c.id, e.from ? `from ${e.from}` : null, e.isNew ? "new" : null]
    .filter(Boolean)
    .join(", ");
  const lines = [`${n}. **${c.kind}** on ${where} (${tags})`];
  for (const l of c.text.split("\n")) lines.push(`   > ${l}`);
  const box = boxLine(c, e.image);
  let crop: string | null = null;
  if (e.image && c.region) {
    crop = await cropComment(
      join(e.dir, e.image.file),
      e.image,
      c,
      join(cropDir, `${c.id}.png`),
    );
  }
  if (box) lines.push(`   - box: ${box}${crop ? `; crop: ${crop}` : ""}`);
  else if (e.image) lines.push(`   - screenshot: ${join(e.dir, e.image.file)}`);
  const located = e.image ? locate(e.dir, e.image, c) : null;
  const on = c.anchor
    ? `\`${c.anchor.path}\`${c.anchor.text ? ` "${c.anchor.text}"` : ""}`
    : located?.on
      ? `\`${located.path}\``
      : null;
  if (on) lines.push(`   - on: ${on}`);
  if (located?.inside.length) {
    lines.push(
      `   - inside: ${located.inside.map((s) => `\`${s}\``).join(", ")}`,
    );
  }
  if (located?.scopes.length) {
    lines.push(
      `   - scoped style: ${located.scopes.map((s) => `data-v-${s}`).join(" ")}`,
    );
  }
  if (e.image?.url) lines.push(`   - page: ${e.image.url}`);
  for (const t of threadLines(c)) lines.push(`   - ${t}`);
  return lines;
}

export type DigestOptions = {
  /** Count as new what came after this time; null: everything is new. */
  since: string | null;
};

export type Digest = {
  markdown: string;
  todo: number;
  state: RoundState;
};

/** The digest of round `id`, writing the crops it names into the round's
 * `crops/` directory. */
export async function digest(
  id: string,
  home: string,
  options: DigestOptions,
): Promise<Digest> {
  const round = loadRound(id, home);
  if (!round) throw new Error(`No round ${id}`);
  const dir = roundDir(id, home);
  const cropDir = join(dir, "crops");
  mkdirSync(cropDir, { recursive: true });
  const state = roundState(id, home);
  // New is what Szymon did since the agent last read: a comment, a reply, a
  // reopen (a reply too), a resolve. The agent's own replies are not news.
  const since = options.since;
  const fresh = (c: Comment) =>
    since === null ||
    c.at > since ||
    c.replies.some((r) => !isAgent(r.by) && r.at > since) ||
    (c.status === "resolved" && c.updatedAt > since);

  const homes = new Map<string, Round>([[round.id, round]]);
  const entries: Entry[] = state.comments.map((c) => ({
    comment: c,
    image: round.images.find((i) => i.id === c.image) ?? null,
    dir,
    from: null,
    isNew: fresh(c),
  }));
  for (const c of carriedComments(round, home)) {
    let parent = homes.get(c.round);
    if (!parent) {
      parent = loadRound(c.round, home) ?? undefined;
      if (!parent) continue;
      homes.set(c.round, parent);
    }
    entries.push({
      comment: c,
      image: parent.images.find((i) => i.id === c.image) ?? null,
      dir: roundDir(c.round, home),
      from: c.round,
      isNew: fresh(c),
    });
  }

  const open = entries.filter((e) => e.comment.status !== "resolved");
  const groups: [string, Entry[]][] = [
    [
      "To do - fix each, reply to it, and show the fix in the next round",
      open.filter(
        (e) => e.comment.kind === "fix" && waitingOn(e.comment) === "agent",
      ),
    ],
    [
      "Questions from Szymon - answer each with `reply`",
      open.filter(
        (e) =>
          e.comment.kind === "question" && waitingOn(e.comment) === "agent",
      ),
    ],
    [
      "Site-wide rules - propose each as a task for `.interface-design/system.md`, quoting him; do not write the file",
      open.filter(
        (e) => e.comment.kind === "rule" && waitingOn(e.comment) === "agent",
      ),
    ],
    [
      "Keep - the next round must not lose these",
      open.filter((e) => e.comment.kind === "keep"),
    ],
    [
      "Waiting on Szymon - you replied or fixed it; nothing to do unless he reopens it",
      open.filter((e) => waitingOn(e.comment) === "owner"),
    ],
  ];

  const out: string[] = [];
  out.push(`# Design feedback on ${round.id}: ${round.title}`);
  out.push("");
  out.push(`Board: ${roundUrl(round.id)} · files: ${dir}`);
  const last = state.submits.at(-1);
  if (!last) {
    out.push(
      `Not sent yet: Szymon has not pressed send on this round (${state.comments.length} comments so far).`,
    );
  } else if (last.verdict === "approve") {
    out.push(
      `**Approved** ${last.at}: do what is still open below without another round, then go on to tests, baselines and commits.`,
    );
  } else {
    out.push(
      `**Sent back** ${last.at}: work through what is open below, then publish the next round with \`--next ${round.id}\`.`,
    );
  }
  if (last?.text) out.push(`Szymon: ${JSON.stringify(last.text)}`);

  const picks = Object.entries(state.picks);
  if (picks.length) {
    out.push("", "## Picks");
    for (const [key, p] of picks) out.push(`- \`${key}\`: **${p.variant}**`);
  }
  if (round.questions.length) {
    out.push("", "## Your questions");
    for (const q of round.questions) {
      const a = state.answers[q.id];
      const answer = a
        ? [
            a.option ? `**${a.option}**` : null,
            a.text ? JSON.stringify(a.text) : null,
          ]
            .filter(Boolean)
            .join(" - ")
        : "not answered";
      out.push(`- ${q.id} ${JSON.stringify(q.text)}: ${answer}`);
    }
  }

  let todo = 0;
  for (const [title, list] of groups) {
    if (!list.length) continue;
    out.push("", `## ${title} (${list.length})`);
    if (!title.startsWith("Keep") && !title.startsWith("Waiting"))
      todo += list.length;
    let n = 1;
    for (const e of list) out.push(...(await entryLines(e, cropDir, n++)));
  }
  const resolved = entries.filter(
    (e) => e.comment.status === "resolved" && e.isNew,
  );
  if (resolved.length) {
    out.push(
      "",
      `## Resolved by Szymon since you last read (${resolved.length})`,
    );
    for (const e of resolved)
      out.push(`- ${e.comment.id}: ${JSON.stringify(e.comment.text)}`);
  }
  if (!entries.length && !picks.length) out.push("", "No comments.");

  out.push(
    "",
    "---",
    "Run from frontend/:",
    `- reply: \`npm run -s design-feedback -- reply <comment id> "<what you changed>" --addressed --in <next round>\` (\`--declined\` with the reason if you will not)`,
    `- next round: \`npm run -s design-feedback -- publish <dir> --next ${round.id} --notes "<what changed>"\`, then \`wait\` on it`,
  );
  return { markdown: out.join("\n"), todo, state };
}
