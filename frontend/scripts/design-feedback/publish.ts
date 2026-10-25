/** Turning a render's screenshots into a round on the board.
 *
 * The render kits under ~/.cache/koryta write `raw/<label>/<mode>-<size>/
 * <page>.png`, one directory per build or variant. `--variants` reads that
 * layout as it is: the first directory is the variant, the rest of the path
 * is the key the board lines variants up by and carries comments across
 * rounds by. Anything else is a key per file.
 */
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import sharp from "sharp";
import { domFileFor, type DomCensus } from "./dom";
import {
  listRounds,
  loadRound,
  pngSize,
  roundDir,
  safeSegment,
  saveRound,
  type Author,
  type Question,
  type Round,
  type RoundImage,
} from "./store";

export type Shot = { file: string; key: string; variant: string | null };

function pngsUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...pngsUnder(path));
    else if (/\.png$/i.test(name)) out.push(path);
  }
  return out;
}

const keyOf = (path: string) =>
  path
    .replace(/\.png$/i, "")
    .split(/[\\/]/)
    .map(safeSegment)
    .join("/");

/** The screenshots `sources` name. A file is a key of its own name. A
 * directory gives every PNG under it, keyed by its path inside it - or, with
 * `variants`, the PNGs of each named subdirectory (`"*"`: all of them), keyed
 * by their path inside that. `match` and `skip` test the key. */
export function collectShots(
  sources: string[],
  options: {
    variants?: string[] | "*" | null;
    match?: RegExp | null;
    skip?: RegExp | null;
  } = {},
): Shot[] {
  const shots: Shot[] = [];
  const keep = (key: string) =>
    (!options.match || options.match.test(key)) && !options.skip?.test(key);
  for (const source of sources) {
    if (!statSync(source).isDirectory()) {
      const key = keyOf(basename(source));
      if (keep(key)) shots.push({ file: source, key, variant: null });
      continue;
    }
    const variants = options.variants ?? null;
    if (variants === null) {
      for (const file of pngsUnder(source)) {
        const key = keyOf(relative(source, file));
        if (keep(key)) shots.push({ file, key, variant: null });
      }
      continue;
    }
    const names =
      variants === "*"
        ? readdirSync(source)
            .filter((n) => statSync(join(source, n)).isDirectory())
            .sort()
        : variants;
    for (const name of names) {
      const dir = join(source, name);
      if (!existsSync(dir)) throw new Error(`No variant directory ${dir}`);
      for (const file of pngsUnder(dir)) {
        const key = keyOf(relative(dir, file));
        if (keep(key)) shots.push({ file, key, variant: safeSegment(name) });
      }
    }
  }
  const ids = new Set<string>();
  for (const s of shots) {
    const id = imageId(s);
    if (ids.has(id)) throw new Error(`Two screenshots would both be ${id}`);
    ids.add(id);
  }
  return shots;
}

export const imageId = (s: { key: string; variant: string | null }) =>
  s.variant ? `${s.variant}/${s.key}` : s.key;

/** The id after `parent`: `person-r3` is followed by `person-r4`, anything
 * else by `<id>-r2`, skipping ids already taken. */
export function nextRoundId(parent: string, taken: Set<string>): string {
  const m = /^(.*)-r(\d+)$/.exec(parent);
  const stem = m ? m[1] : parent;
  let n = m ? Number(m[2]) + 1 : 2;
  while (taken.has(`${stem}-r${n}`)) n++;
  return `${stem}-r${n}`;
}

/** "Phone rows: A or C?|A|C" - the question, then its options if any. */
export function parseQuestion(spec: string, index: number): Question {
  const [text, ...options] = spec.split("|").map((s) => s.trim());
  return {
    id: `q${index + 1}`,
    text: text ?? "",
    options: options.filter(Boolean),
  };
}

/** A thumbnail of a screenshot's top: the grid shows the first screen or so
 * of each page, all at one shape. */
async function thumbnail(
  src: string,
  out: string,
  width: number,
  height: number,
) {
  mkdirSync(dirname(out), { recursive: true });
  await sharp(src)
    .extract({
      left: 0,
      top: 0,
      width,
      height: Math.min(height, Math.round(width * 1.25)),
    })
    .resize({ width: 480, withoutEnlargement: true })
    .webp({ quality: 74 })
    .toFile(out);
}

function readCensus(file: string): DomCensus | null {
  const path = domFileFor(file);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as DomCensus;
}

export type PublishOptions = {
  id: string;
  title: string;
  notes: string;
  parent: string | null;
  shots: Shot[];
  questions: Question[];
  /** Image pixels per CSS pixel, for screenshots without a census. */
  dpr: number | null;
  /** Add the screenshots to a round that exists, replacing any with the same
   * id, instead of refusing. */
  add: boolean;
  author: Author;
};

export async function publish(o: PublishOptions, home: string): Promise<Round> {
  if (o.shots.length === 0) throw new Error("No screenshots to publish");
  const existing = loadRound(o.id, home);
  if (existing && !o.add) {
    throw new Error(
      `Round ${o.id} exists. Publish the next one with --next ${o.id}, ` +
        `or add screenshots to it with --add.`,
    );
  }
  if (o.parent && !loadRound(o.parent, home)) {
    throw new Error(`No round ${o.parent} to follow`);
  }
  const dir = roundDir(o.id, home);
  const images: RoundImage[] = [];
  for (const shot of o.shots) {
    const id = imageId(shot);
    const file = `images/${id}.png`;
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    // A copy, not a link: the next render writes into the same inode.
    copyFileSync(shot.file, join(dir, file), constants.COPYFILE_FICLONE);
    const { width, height } = pngSize(shot.file);
    const census = readCensus(shot.file);
    let dom: string | null = null;
    if (census) {
      dom = `images/${id}.dom.json`;
      copyFileSync(domFileFor(shot.file), join(dir, dom));
    }
    const thumb = `thumbs/${id}.webp`;
    await thumbnail(shot.file, join(dir, thumb), width, height);
    images.push({
      id,
      key: shot.key,
      variant: shot.variant,
      file,
      thumb,
      dom,
      width,
      height,
      dpr: census?.dpr ?? o.dpr ?? 1,
      url: census?.url ?? null,
    });
  }

  const now = new Date().toISOString();
  const kept = (existing?.images ?? []).filter(
    (i) => !images.some((n) => n.id === i.id),
  );
  const all = [...kept, ...images];
  const variants = [
    ...new Set(all.map((i) => i.variant).filter((v): v is string => !!v)),
  ];
  const round: Round = {
    id: o.id,
    title: o.title || existing?.title || o.id,
    notes: o.notes || existing?.notes || "",
    parent: o.parent ?? existing?.parent ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    author: existing?.author ?? o.author,
    variants,
    questions: [
      ...(existing?.questions ?? []),
      ...o.questions.map((q, i) => ({
        ...q,
        id: `q${(existing?.questions.length ?? 0) + i + 1}`,
      })),
    ],
    images: all,
  };
  saveRound(round, home);
  return round;
}

export const takenIds = (home: string) =>
  new Set(listRounds(home).map((r) => r.id));
