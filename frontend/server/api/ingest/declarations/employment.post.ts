import { getApp } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import {
  closedFromThroughGate,
  countEmploymentMoves,
  employmentGate,
  employmentPriorityOf,
  gatedBand,
  NO_PAGE_PRIORITY,
  personThroughGate,
  statusThroughGate,
  storedBand,
  type EmploymentGate,
  type EmploymentMove,
  type StoredBand,
} from "~~/server/utils/declarationEmployment";
import { EXTRACT_IMAGES, EXTRACTS } from "~~/server/utils/declarations";
import { inParallel } from "~~/server/utils/parallel";
import {
  EMPLOYMENT_FIELDS,
  employmentImagesId,
  employmentIngestSchema,
  MAX_BAND_PICTURE_BYTES,
  readingBands,
  type EmploymentIngestResult,
  type EmploymentIngestSkipReason,
  type EmploymentItemInput,
  type EmploymentMachine,
  type EmploymentState,
  type EmploymentStatus,
  type ReadingBand,
} from "~~/shared/declarationEmployment";
import {
  isPng,
  MAX_IMAGE_BYTES,
  MAX_REQUEST_IMAGE_BYTES,
  pngSize,
} from "~~/shared/declarations";

/**
 * Pictures of BIP declarations to read posts off, from the job on predator
 * (`upload --employment`): for each declaration whose date page the site has,
 * its header strip and its bands, with the machine's suggestions for printed
 * ones.
 *
 * Scoped like the date ingest: a datascience caller, checked before the body
 * is read; at most 25 items, 200 kB a picture and 8 MB of pictures a request.
 * An item lives on its date page's own document,
 * `declarationExtracts/<sha256>-p<page>`, as a map a band beside the date's
 * fields, which this never writes; a date page the site does not have is
 * refused, never made. The pictures go to
 * `declarationExtractImages/<item>-<band>`, a document a band with its
 * header.
 *
 * Sent again, a band changes only where something did. A new picture replaces
 * the old one while no vote is on the band, or once readers asked for a wider
 * cut (`recut`); otherwise readers keep the one they answered. A band opens
 * only when the declaration is known to be the person's (`employmentGate`).
 * Each item is stored in a transaction that reads its date page afresh, so a
 * comparison of that page running at the same time cannot leave it closed
 * (server/utils/declarationEmployment.ts).
 */
export default defineEventHandler(
  async (event): Promise<EmploymentIngestResult> => {
    // The gate comes before the body: 8 MB of pictures are not buffered and
    // parsed for somebody who may not send them.
    const user = requireDatascience(await getUser(event));
    const body = await readValidatedBody(event, (raw) =>
      employmentIngestSchema.parse(raw),
    );

    const pictures = body.items.map(picturesOf);
    const bytes = pictures.reduce((sum, item) => sum + item.bytes, 0);
    if (bytes > MAX_REQUEST_IMAGE_BYTES) {
      throw createError({
        statusCode: 413,
        statusMessage: "Payload Too Large",
        message: `${bytes} bytes of images; send at most ${MAX_REQUEST_IMAGE_BYTES} a request`,
      });
    }

    const db = getFirestore(getApp(), "koryta-pl");
    const now = Timestamp.now();
    const upload: Upload = {
      tag: body.tag,
      runId: body.runId ?? null,
      uploaderUid: user.uid,
    };

    const done: (BandOutcome[] | EmploymentIngestSkipReason)[] = [];
    const moves: EmploymentMove[] = [];
    const failures: unknown[] = [];
    // The items of one date page one after another, the rest side by side.
    const byPage = new Map<string, number[]>();
    body.items.forEach((item, i) =>
      byPage.set(item.id, [...(byPage.get(item.id) ?? []), i]),
    );
    await inParallel([...byPage.values()], ITEMS_IN_PARALLEL, async (order) => {
      for (const i of order) {
        const item = body.items[i]!;
        const problem = pictures[i]!.problem;
        if (problem) {
          done[i] = problem;
          continue;
        }
        try {
          const stored = await storeItem(db, item, pictures[i]!, upload, now);
          done[i] = stored ?? "unknown_extract";
          for (const band of stored ?? []) if (band.move) moves.push(band.move);
        } catch (error) {
          failures.push(error);
        }
      }
    });
    // What was stored is counted even when an item failed, which fails the
    // request for the job to send it again.
    await countEmploymentMoves(db, moves, now);
    if (failures.length > 0) throw failures[0];

    const result: EmploymentIngestResult = {
      status: "ok",
      bands: { created: 0, updated: 0, kept: 0, unchanged: 0 },
      skipped: [],
    };
    body.items.forEach((item, i) => {
      const outcome = done[i]!;
      if (typeof outcome === "string") {
        result.skipped.push({ id: item.id, reason: outcome });
      } else {
        for (const band of outcome) result.bands[band.outcome] += 1;
      }
    });
    return result;
  },
);

/** Items stored at once, each in a transaction of its own. */
const ITEMS_IN_PARALLEL = 5;

/** Who sent a batch, kept with the pictures: a bad cut can be found and sent
 * again by its tag. */
type Upload = { tag: string; runId: string | null; uploaderUid: string };

/** A picture as stored: its bytes and size, and the declaration page it was
 * cut from. */
type Strip = { page: number; png: Buffer; width: number; height: number };

type ItemPictures = {
  header: Strip[];
  bands: Partial<Record<ReadingBand, Strip[]>>;
  /** All of the item's picture bytes, as sent. */
  bytes: number;
  problem: EmploymentIngestSkipReason | null;
};

type BandOutcome = {
  outcome: keyof EmploymentIngestResult["bands"];
  move: EmploymentMove | null;
};

/** Whether the bytes are a PNG of a sane size: the content type is never the
 * sender's. 24 bytes reach the size in the PNG's header. */
function goodPng(bytes: Buffer): boolean {
  return bytes.length >= 24 && bytes.length <= MAX_IMAGE_BYTES && isPng(bytes);
}

/** The item's pictures as bytes, and what keeps them from being stored. */
function picturesOf(item: EmploymentItemInput): ItemPictures {
  const decode = (strips: readonly { page: number; png: string }[]) =>
    strips.map(({ page, png }): Strip => {
      const bytes = Buffer.from(png, "base64");
      return {
        page,
        png: bytes,
        ...(goodPng(bytes) ? pngSize(bytes) : { width: 0, height: 0 }),
      };
    });
  const weight = (strips: readonly Strip[]) =>
    strips.reduce((sum, strip) => sum + strip.png.length, 0);

  const header = decode(item.header.strips);
  const bands: ItemPictures["bands"] = {};
  for (const band of readingBands) {
    const sent = item[band];
    if (sent) bands[band] = decode(sent.strips);
  }
  const each = Object.values(bands);
  const bad = [header, ...each].some((strips) =>
    strips.some((strip) => !goodPng(strip.png)),
  );
  const tooLarge = each.some(
    (strips) => weight(header) + weight(strips) > MAX_BAND_PICTURE_BYTES,
  );
  return {
    header,
    bands,
    bytes: weight(header) + each.reduce((sum, s) => sum + weight(s), 0),
    problem: bad ? "bad_image" : tooLarge ? "too_large" : null,
  };
}

/** Stores an item's bands on its date page, or returns null when the site
 * has no such page. */
async function storeItem(
  db: Firestore,
  item: EmploymentItemInput,
  pictures: ItemPictures,
  upload: Upload,
  now: Timestamp,
): Promise<BandOutcome[] | null> {
  const ref = db.collection(EXTRACTS).doc(item.id);
  return db.runTransaction(async (tx) => {
    const crop = (await tx.get(ref)).data();
    if (!crop) return null;
    const gate = await employmentGate(db, crop);
    const priority = gate.open
      ? await employmentPriorityOf(db, gate, crop)
      : null;

    const update: Record<string, unknown> = {};
    const outcomes: BandOutcome[] = [];
    for (const band of readingBands) {
      if (!item[band]) continue;
      const field = EMPLOYMENT_FIELDS[band];
      const change = bandChange(storedBand(crop, band), item, band, {
        gate,
        priority,
        now,
      });
      if (change.whole) update[field] = change.whole;
      for (const [key, value] of Object.entries(change.fields)) {
        update[`${field}.${key}`] = value;
      }
      if (change.pictures) {
        tx.set(
          db.collection(EXTRACT_IMAGES).doc(employmentImagesId(item.id, band)),
          {
            header: {
              typed: item.header.typed,
              strips: pictures.header,
              lines: item.header.lines,
            },
            strips: pictures.bands[band] ?? [],
            lines: item[band]!.lines,
            imageHash: item[band]!.imageHash,
            cutVersion: item.cutVersion,
            ...upload,
            updatedAt: now,
          },
        );
      }
      outcomes.push({
        outcome: change.outcome,
        move: change.move ? { band, ...change.move } : null,
      });
    }
    if (Object.keys(update).length > 0) tx.update(ref, update);
    return outcomes;
  });
}

type BandChange = {
  /** A band stored for the first time: its whole map. */
  whole: EmploymentState<Timestamp> | null;
  /** The fields of a stored band that change. */
  fields: Record<string, unknown>;
  /** Whether the pictures are written. */
  pictures: boolean;
  outcome: BandOutcome["outcome"];
  move: Omit<EmploymentMove, "band"> | null;
};

/**
 * What one band sent changes. A band nobody has voted on is placed as if it
 * were new: put off for a newer declaration (`later`), else open or waiting
 * as its gate says; its picture and the machine's reading are replaced. So
 * is one readers asked to be cut again wider, once a new picture comes: the
 * votes it had were on the old one. Any other band keeps its picture, and
 * only its gate moves it (`statusThroughGate`).
 */
function bandChange(
  before: StoredBand | undefined,
  item: EmploymentItemInput,
  band: ReadingBand,
  args: { gate: EmploymentGate; priority: number | null; now: Timestamp },
): BandChange {
  const { gate, priority, now } = args;
  const sent = item[band]!;
  const machine: EmploymentMachine | null = sent.typed
    ? {
        suggestions: sent.suggestions,
        asOf: item.header.asOf,
        filedOn: item.header.filedOn,
      }
    : null;
  const placed: EmploymentStatus = item.later
    ? "later"
    : gate.open
      ? "open"
      : "waiting";

  if (!before) {
    return {
      whole: {
        status: placed,
        closedFrom: null,
        personId: personThroughGate(placed, gate, null),
        priority: priority ?? NO_PAGE_PRIORITY,
        // Spreads concurrent readers over the queue without offsets.
        rand: Math.random(),
        answerCount: 0,
        typed: sent.typed,
        machine,
        imageHash: sent.imageHash,
        cutVersion: item.cutVersion,
        summary: null,
        agreed: null,
        decision: null,
        applyState: null,
        skipReason: null,
        applied: null,
        plan: null,
        control: null,
        flags: {},
        updatedAt: now,
      },
      fields: {},
      pictures: true,
      outcome: "created",
      move: { from: null, to: placed },
    };
  }

  const was = gatedBand(before);
  const newPicture = before.imageHash !== sent.imageHash;
  const unvoted =
    was.answerCount === 0 &&
    (was.status === "waiting" ||
      was.status === "later" ||
      was.status === "open");
  const cutAgain = was.status === "recut" && newPicture;
  const replaced = unvoted || cutAgain;
  const status = replaced ? placed : statusThroughGate(was, gate.open);
  const personId = personThroughGate(status, gate, was.personId);
  const closedFrom = closedFromThroughGate(was, status);
  const pictures = newPicture && replaced;

  const fields: Record<string, unknown> = {};
  if (status !== before.status) fields.status = status;
  if (closedFrom !== (before.closedFrom ?? null))
    fields.closedFrom = closedFrom;
  if (personId !== (before.personId ?? null)) fields.personId = personId;
  if (replaced && (pictures || before.typed !== sent.typed)) {
    fields.typed = sent.typed;
  }
  if (replaced && (pictures || !sameValue(before.machine ?? null, machine))) {
    fields.machine = machine;
  }
  if (pictures) {
    fields.imageHash = sent.imageHash;
    fields.cutVersion = item.cutVersion;
  }
  if (cutAgain) {
    fields.answerCount = 0;
    fields.summary = null;
    if (before.flags?.missing_part !== undefined) {
      fields["flags.missing_part"] = FieldValue.delete();
    }
  }
  if (Object.keys(fields).length > 0) fields.updatedAt = now;
  if (status === "open" && priority !== null && before.priority !== priority) {
    fields.priority = priority;
  }

  return {
    whole: null,
    fields,
    pictures,
    outcome:
      newPicture && !pictures
        ? "kept"
        : Object.keys(fields).length > 0
          ? "updated"
          : "unchanged",
    move: status !== was.status ? { from: was.status, to: status } : null,
  };
}

/** Whether two values read the same, whatever order a map's keys came back
 * from Firestore in. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, i) => sameValue(value, b[i]))
    );
  }
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => key in right && sameValue(left[key], right[key]))
  );
}
