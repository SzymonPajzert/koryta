import { createHash } from "node:crypto";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { matchAndDrain } from "~~/server/utils/declarationPublish";
import { resolveMergedNode } from "~~/server/utils/merge";
import { pageIsPublic } from "~~/shared/model";
import {
  declarationIngestSchema,
  extractId,
  isPng,
  machineSettles,
  MAX_IMAGE_BYTES,
  MAX_REQUEST_IMAGE_BYTES,
  pngSize,
  publishLimitOf,
  type DeclarationCandidacyInput,
  type DeclarationExtractInput,
  type DeclarationIngestResult,
  type IngestSkipReason,
} from "~~/shared/declarations";

/**
 * Crops of BIP asset declarations, from the job on predator.
 *
 * Scoped like `/api/ingest/extraction`: a datascience caller, a batch, a `tag`
 * naming what made it. Unlike it, every document has a fixed id, so a resent
 * chunk after a crash overwrites instead of doubling: a candidacy is its
 * BipPersonOfInterest key, a crop is its file and page.
 *
 * Two kinds of record arrive. A candidacy says how the search for one won
 * local candidacy went, found or not, which is what the admin overview counts.
 * An extract is one crop to read, with the candidacies it serves; its
 * images go to their own collection so that listing extracts never loads bytes.
 *
 * A reading starts open and readers move it (`/api/declarations/<id>/answer`),
 * except a typed date the job read with high confidence, which settles here.
 * A crop settled either way is then compared with its pages, which is where
 * anything is published (server/utils/declarationPublish.ts).
 */
export default defineEventHandler(async (event) => {
  // The gate comes before the body: a request with 8 MB of images should not
  // be buffered and parsed for somebody who may not send it.
  const user = requireDatascience(await getUser(event));
  const body = await readValidatedBody(event, (raw) =>
    declarationIngestSchema.parse(raw),
  );

  const decoded = decodeImages(body.extracts);
  const imageBytes = [...decoded.values()].reduce(
    (sum, { date, name }) => sum + (date?.length ?? 0) + (name?.length ?? 0),
    0,
  );
  if (imageBytes > MAX_REQUEST_IMAGE_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: "Payload Too Large",
      message: `${imageBytes} bytes of images; send at most ${MAX_REQUEST_IMAGE_BYTES} a request`,
    });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const now = Timestamp.now();
  const result: DeclarationIngestResult = {
    status: "ok",
    candidacies: { created: 0, updated: 0, skipped: [] },
    extracts: { created: 0, updated: 0, kept: 0, skipped: [] },
  };

  // --- candidacies -------------------------------------------------------
  /** Every live page met on the way, by its id: how soon readers see its
   * crops. */
  const pages = new Map<string, LivePage>();
  const people = await livePeople(
    db,
    body.candidacies.flatMap((candidacy) => candidacy.kids),
    pages,
  );
  const candidacyRefs = body.candidacies.map((candidacy) =>
    db.collection("declarationCandidacies").doc(candidacy.key),
  );
  const storedCandidacies =
    candidacyRefs.length > 0 ? await db.getAll(...candidacyRefs) : [];

  const writes = new WriteQueue(db);
  /** What each key resolves to, for the extracts of this request. */
  const candidacyByKey = new Map<string, StoredCandidacy>();

  body.candidacies.forEach((candidacy, i) => {
    const personIds = unique(
      candidacy.kids.map((kid) => people.get(kid)).filter(isString),
    );
    if (personIds.length === 0) {
      result.candidacies.skipped.push({
        key: candidacy.key,
        reason: "no_site_person",
      });
      return;
    }
    const exists = storedCandidacies[i]?.exists ?? false;
    const stored: StoredCandidacy = {
      key: candidacy.key,
      personIds,
      kids: candidacy.kids,
      teryt: candidacy.teryt,
      unitName: candidacy.unitName ?? null,
      level: candidacy.level,
      office: candidacy.office,
      year: candidacy.year,
      status: candidacy.status,
      reason: candidacy.reason ?? null,
      bipUrls: candidacy.bipUrls ?? [],
      files: candidacy.files ?? 0,
    };
    candidacyByKey.set(candidacy.key, stored);
    writes.set(
      candidacyRefs[i]!,
      {
        ...stored,
        tag: body.tag,
        runId: body.runId ?? null,
        uploaderUid: user.uid,
        updatedAt: now,
        ...(exists ? {} : { createdAt: now }),
      },
      0,
    );
    if (exists) result.candidacies.updated += 1;
    else result.candidacies.created += 1;
  });

  // --- extracts ----------------------------------------------------------
  // Keys an extract names that were sent in an earlier request.
  const earlierKeys = unique(
    body.extracts
      .flatMap((extract) => extract.candidacies)
      .filter((key) => !candidacyByKey.has(key)),
  );
  if (earlierKeys.length > 0) {
    const earlier = await db.getAll(
      ...earlierKeys.map((key) =>
        db.collection("declarationCandidacies").doc(key),
      ),
    );
    for (const snapshot of earlier) {
      if (!snapshot.exists) continue;
      const data = snapshot.data() as StoredCandidacy;
      const personIds = asStrings(data.personIds);
      // People are re-checked: a page merged or removed since the candidacy
      // was sent must not take the crop.
      const resolved = await livePeople(db, personIds, pages);
      candidacyByKey.set(snapshot.id, {
        ...data,
        personIds: unique(
          personIds.map((id) => resolved.get(id)).filter(isString),
        ),
      });
    }
  }

  const extractRefs = body.extracts.map((extract) =>
    db
      .collection("declarationExtracts")
      .doc(extractId(extract.sha256, extract.page)),
  );
  const storedExtracts =
    extractRefs.length > 0 ? await db.getAll(...extractRefs) : [];
  /** Crops to compare with their pages once stored: the ones this request
   * settles - a typed date the job read with high confidence - and the ones
   * settled already that it names more pages or units for. */
  const toCompare: string[] = [];

  body.extracts.forEach((extract, i) => {
    const id = extractId(extract.sha256, extract.page);
    const skip = (reason: IngestSkipReason) =>
      result.extracts.skipped.push({ id, reason });

    const candidacies = extract.candidacies
      .map((key) => candidacyByKey.get(key))
      .filter((candidacy): candidacy is StoredCandidacy => !!candidacy);
    if (candidacies.length === 0) return skip("unknown_candidacy");
    const personIds = unique(candidacies.flatMap((c) => c.personIds));
    if (personIds.length === 0) return skip("no_site_person");
    if (!namesItsPerson(extract, candidacies)) return skip("unconfirmed_name");

    const images = decoded.get(i);
    if (extract.outcome === "crop" && !images?.date) return skip("no_images");
    if (extract.outcome !== "failed" && images?.bad) return skip("bad_image");

    const snapshot = storedExtracts[i];
    const existing = snapshot?.exists
      ? (snapshot.data() as Record<string, unknown>)
      : undefined;
    const answered = Number(existing?.answerCount ?? 0) > 0;
    const ref = extractRefs[i]!;
    const imageHash =
      extract.outcome !== "failed" && images?.date ? hashOf(images) : null;
    // The same picture again costs nothing; a new one replaces the old only
    // while nobody has answered it.
    const writeImages =
      imageHash !== null && !answered && existing?.imageHash !== imageHash;
    const reading = readingState(extract, existing, now);
    const nextPersonIds = unique([
      ...asStrings(existing?.personIds),
      ...personIds,
    ]);
    const nextUnits = unitsOf(candidacies, existing?.units);
    // A settled crop is compared with the pages it named when it settled, so
    // one sent again for a page or a candidacy more has not met those yet: it
    // is compared again now, and marked uncompared for the sweep in case
    // this fails. Both lists only ever grow.
    const widened =
      existing?.status === "agreed" &&
      (nextPersonIds.length > asStrings(existing.personIds).length ||
        nextUnits.length >
          (Array.isArray(existing.units) ? existing.units.length : 0));
    if (reading.status === "agreed" || widened) toCompare.push(id);

    writes.set(
      ref,
      {
        id,
        sha256: extract.sha256,
        page: extract.page,
        url: extract.url,
        host: hostOf(extract.url),
        pageUrl: extract.pageUrl ?? null,
        label: extract.label ?? null,
        declarationYear: extract.declarationYear ?? null,
        candidacyKeys: unique([
          ...asStrings(existing?.candidacyKeys),
          ...candidacies.map((c) => c.key),
        ]),
        personIds: nextPersonIds,
        priority: Math.min(
          ...personIds.map((pageId) => pages.get(pageId)?.priority ?? 3),
        ),
        units: nextUnits,
        linkNamed: extract.linkNamed ?? null,
        outcome: extract.outcome,
        failure: extract.outcome === "failed" ? (extract.reason ?? null) : null,
        machine: extract.machine ?? null,
        // Answers were given to the picture already stored, so a re-cut
        // never replaces it under them.
        ...(!writeImages
          ? {}
          : {
              imageHash,
              hasNameImage: !!images!.name,
              imageSize: {
                date: pngSize(images!.date!),
                name: images!.name ? pngSize(images!.name) : null,
              },
            }),
        tag: body.tag,
        runId: body.runId ?? null,
        uploaderUid: user.uid,
        updatedAt: now,
        ...reading,
        ...(widened ? { pageMatch: null } : {}),
      },
      0,
    );
    if (writeImages) {
      writes.set(
        db.collection("declarationExtractImages").doc(id),
        { date: images!.date, name: images!.name ?? null, updatedAt: now },
        images!.date!.length + (images!.name?.length ?? 0),
      );
    }
    if (!existing) result.extracts.created += 1;
    else if (answered && extract.outcome === "crop") result.extracts.kept += 1;
    else result.extracts.updated += 1;
  });

  await writes.flush();

  // A crop that arrives settled meets its pages now, the way one settled by
  // readers does after the answer that settles it. Never at the upload's
  // expense: the crops are stored, and the sweep the job calls next compares
  // whatever this did not.
  if (toCompare.length > 0) {
    try {
      const { drain } = await matchAndDrain(
        db,
        toCompare,
        new Date(),
        publishLimitOf(useRuntimeConfig(event)),
      );
      if (drain.published.length > 0) {
        await useStorage("cache").clear("nitro:handlers");
      }
    } catch (error) {
      console.error("[declarations] comparing uploaded readings failed", error);
    }
  }
  return result;
});

/** A candidacy as it is stored, and as the extracts read it. */
type StoredCandidacy = {
  key: string;
  personIds: string[];
  kids: string[];
  teryt: string;
  unitName: string | null;
  level: DeclarationCandidacyInput["level"];
  office: DeclarationCandidacyInput["office"];
  year: number;
  status: DeclarationCandidacyInput["status"];
  reason: string | null;
  bipUrls: string[];
  files: number;
};

/** A live person page and how soon readers should see its crops.
 *
 * The interest is in drafts nobody has verified yet, so those come first,
 * and among them the ones with a birth date (0): only a date already on the
 * page can confirm a settled crop, publish the person and count in the
 * reader's „Znaleziono”. A draft without one comes next (1), and a published
 * page, verified already, last (3). The crawl goes the other way round for
 * drafts, as it looks for the dates the pages lack. Only whether a page has a
 * date is read, never the date. */
type LivePage = { id: string; priority: 0 | 1 | 3 };

/** Each kid's live person page, followed through merges: a page that is gone,
 * deleted or not a person maps to nothing. Every page found is also put in
 * `pages`. */
async function livePeople(
  db: FirebaseFirestore.Firestore,
  ids: readonly string[],
  pages: Map<string, LivePage>,
): Promise<Map<string, string | undefined>> {
  const wanted = unique(ids);
  const answer = new Map<string, string | undefined>();
  if (wanted.length === 0) return answer;
  const snapshots = await db.getAll(
    ...wanted.map((id) => db.collection("nodes").doc(id)),
  );
  for (const [i, snapshot] of snapshots.entries()) {
    let page: FirebaseFirestore.DocumentSnapshot | undefined = snapshot;
    if (page.exists && page.data()?.merged_into) {
      page = (await resolveMergedNode(db, page.id)).snapshot;
    }
    const data = page?.exists ? page.data() : undefined;
    const live = data?.type === "person" && data.deleted !== true;
    answer.set(wanted[i]!, live ? page!.id : undefined);
    if (live) {
      pages.set(page!.id, {
        id: page!.id,
        priority: pageIsPublic(data) ? 3 : data.birthDate ? 0 : 1,
      });
    }
  }
  return answer;
}

/** Whether the crop can be trusted to be the candidate's own page.
 *
 * A file a link named the person by is theirs. A council-wide file that names
 * nobody holds every councillor's declaration, so a page of it is theirs only
 * when the name the job read on that very page is the candidate's: anything
 * else would show readers a stranger's handwriting under somebody's name. */
function namesItsPerson(
  extract: DeclarationExtractInput,
  candidacies: readonly StoredCandidacy[],
): boolean {
  if (extract.linkNamed === true) return true;
  if (extract.machine?.nameMatches === true) return true;
  return candidacies.every((candidacy) => candidacy.status === "found");
}

/** The reading fields: seeded on the first write, so the queue's
 * `status == "open"` query can find the crop (Firestore never matches an
 * absent field), and left alone afterwards except while nobody has answered:
 * a file cut again may come back from `failed` or go there, and a typed date
 * the job reads with high confidence settles the crop without readers. */
function readingState(
  extract: DeclarationExtractInput,
  existing: Record<string, unknown> | undefined,
  now: Timestamp,
): Record<string, unknown> {
  const settled = machineSettles(extract.machine);
  const status =
    extract.outcome === "failed" ? "failed" : settled ? "agreed" : "open";
  const agreed = settled
    ? { value: settled, kind: "date", by: "machine", at: now }
    : null;
  if (!existing) {
    return {
      status,
      answerCount: 0,
      answers: {},
      agreed,
      // Not compared with its pages yet. Stored rather than left out, so the
      // sweep's `pageMatch == null` finds a crop whose comparison failed.
      pageMatch: null,
      // Spreads concurrent readers over the queue without offsets.
      rand: Math.random(),
      createdAt: now,
    };
  }
  const answered = Number(existing.answerCount ?? 0) > 0;
  const movable = existing.status === "open" || existing.status === "failed";
  return !answered && movable && existing.status !== status
    ? { status, agreed }
    : {};
}

/** The units the crop is evidence for: the candidacies' unit, office and
 * year, kept from earlier uploads too. */
function unitsOf(
  candidacies: readonly StoredCandidacy[],
  existing: unknown,
): {
  teryt: string;
  unitName: string | null;
  level: string;
  office: string;
  year: number;
}[] {
  const all = [
    ...(Array.isArray(existing) ? existing : []),
    ...candidacies.map(({ teryt, unitName, level, office, year }) => ({
      teryt,
      unitName,
      level,
      office,
      year,
    })),
  ];
  const seen = new Map<string, (typeof all)[number]>();
  for (const unit of all) {
    seen.set(`${unit.teryt}|${unit.office}|${unit.year}`, unit);
  }
  return [...seen.values()];
}

type DecodedImages = { date?: Buffer; name?: Buffer | null; bad?: boolean };

/** The extracts' images as bytes, by position, with anything that is not a
 * PNG of a sane size marked bad: the content type is never the sender's. */
function decodeImages(
  extracts: readonly DeclarationExtractInput[],
): Map<number, DecodedImages> {
  const decoded = new Map<number, DecodedImages>();
  extracts.forEach((extract, i) => {
    if (!extract.images) return;
    const date = Buffer.from(extract.images.date, "base64");
    const name = extract.images.name
      ? Buffer.from(extract.images.name, "base64")
      : null;
    const good = (bytes: Buffer) =>
      bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES && isPng(bytes);
    decoded.set(i, {
      date: date.length > 0 ? date : undefined,
      name,
      bad: !good(date) || (name !== null && !good(name)),
    });
  });
  return decoded;
}

/** Writes in batches that stay under Firestore's limits: 500 operations and
 * 10 MiB a commit, of which the images take most. */
class WriteQueue {
  private batch: FirebaseFirestore.WriteBatch;
  private ops = 0;
  private bytes = 0;
  private pending: Promise<unknown>[] = [];

  constructor(private readonly db: FirebaseFirestore.Firestore) {
    this.batch = db.batch();
  }

  set(
    ref: FirebaseFirestore.DocumentReference,
    data: Record<string, unknown>,
    bytes: number,
  ) {
    if (this.ops >= 450 || this.bytes + bytes > 6_000_000) this.cut();
    this.batch.set(ref, data, { merge: true });
    this.ops += 1;
    this.bytes += bytes;
  }

  private cut() {
    if (this.ops === 0) return;
    this.pending.push(this.batch.commit());
    this.batch = this.db.batch();
    this.ops = 0;
    this.bytes = 0;
  }

  async flush() {
    this.cut();
    await Promise.all(this.pending);
  }
}

/** Which picture this is: answers record it, and a resend of the same bytes
 * is not written twice. */
function hashOf(images: DecodedImages): string {
  const hash = createHash("sha256").update(images.date ?? Buffer.alloc(0));
  if (images.name) hash.update(images.name);
  return hash.digest("hex");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}
