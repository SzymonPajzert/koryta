import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { readingKind, type ExtractStatus } from "~~/shared/declarations";
import { EXTRACT_IMAGES, EXTRACTS, PUBLICATIONS } from "./declarations";

/**
 * The decisions /admin/oswiadczenia offers on a crop the readers left to an
 * admin, as the approved overview draws them (round bip-admin-r2,
 * 2026-10-29): a date, "unreadable", or taking the crop back when it is not
 * the person's.
 *
 * Only a crop on one of the overview's two lists is decided: one readers
 * could not agree on (`disputed`), and an agreed reading its page contradicts
 * (`pageMatch` `different`). Anything else was settled in the meantime - by
 * another admin, or by a reviewer who corrected the page so that the sweep
 * matched it - and a decision made on the old state is refused rather than
 * laid over theirs.
 *
 * A date settles the crop as the admin's (`agreed.by` "admin") and is
 * compared with its pages afresh, but it publishes and confirms nobody: a
 * draft born that day is held for somebody to publish by hand
 * (`admin_decision` in declarationPublish.ts), and a public page born that
 * day is left as it is, since the admin chose the date with the pages' dates
 * a click away. A page born on another day is flagged as for any reading. The
 * other two take the crop out of the comparison: an unreadable or withdrawn
 * crop matches no page and holds none (`agreedDay` in declarationPublish.ts
 * reads only an agreed one), and leaves the "different" list. A note the
 * comparison filed on a page stays: it is that page's to resolve. Who decided
 * what, and what it replaced, stays on the crop.
 *
 * None of the three leaves a crop confirming a page. A public page whose
 * record lists the crop stops showing its declaration
 * (`confirmedDeclarations` reads the crop, and takes neither an admin's date
 * nor a crop that is not agreed), which `linkedOnAPage` tells the endpoints,
 * so they drop the pages' cached answers.
 */

/** The name overview.get.ts caches the overview under. A decision, and a
 * press of "Opublikuj z kolejki", clears it, so the reload after one shows
 * what it did rather than an answer up to two minutes old. Nitro keeps a
 * cached function under `nitro:functions:<name>` in the `cache` storage. */
export const OVERVIEW_CACHE = "declarationOverview";
export const OVERVIEW_CACHE_BASE = `nitro:functions:${OVERVIEW_CACHE}`;

export type AdminDecision =
  | { verdict: "date"; value: string }
  | { verdict: "unreadable" }
  | { verdict: "withdraw" };

/** What a decision left the crop as. */
export type DecidedExtract = {
  id: string;
  status: ExtractStatus;
  /** Whether it now holds a full date to compare with its pages. */
  compare: boolean;
};

/** A crop's pictures as data URLs, the way the reading task sends them. A
 * crop the job read itself may have come without one: null then. */
export type CropImages = { date: string | null; name: string | null };

/** Whether a crop is on one of the overview's lists that ask an admin. */
export function waitsForAdmin(data: DocumentData | undefined): boolean {
  return (
    data?.status === "disputed" ||
    (data?.status === "agreed" && data.pageMatch === "different")
  );
}

/** Records of pages read to tell whether any public one links a crop. A crop
 * names the few pages of its candidacies. */
const LINKED_RECORDS = 50;

/**
 * Whether a public page may be showing the crop's declaration: a published
 * or confirmed record lists it. A decision on such a crop takes the
 * declaration off the page (`confirmedDeclarations`), whose answer is cached
 * for hours, so the endpoints drop the cached answers after it - and only
 * then, since most crops an admin decides were never linked anywhere.
 *
 * A question that cannot be answered counts as yes: dropping the cache costs
 * reads, keeping it would leave the page vouching for a crop just taken back.
 */
export async function linkedOnAPage(
  db: Firestore,
  extractId: string,
): Promise<boolean> {
  try {
    const records = await db
      .collection(PUBLICATIONS)
      .where("extractIds", "array-contains", extractId)
      .limit(LINKED_RECORDS)
      .get();
    return records.docs.some((doc) => {
      const status = doc.get("status");
      return status === "published" || status === "confirmed";
    });
  } catch (error) {
    console.error(
      `[declarations] cannot tell whether a page links ${extractId}`,
      error,
    );
    return true;
  }
}

/**
 * Records an admin's decision on a crop, in a transaction: two admins, or
 * two tabs, deciding one crop at once cannot both have their way.
 *
 * Throws a 404 for a crop that does not exist or has nothing to read, and a
 * 409 for one that no longer waits for an admin.
 */
export async function decideExtract(
  db: Firestore,
  args: {
    extractId: string;
    uid: string;
    decision: AdminDecision;
    now?: Date;
  },
): Promise<DecidedExtract> {
  const now = args.now ?? new Date();
  const { decision } = args;
  const value = decision.verdict === "date" ? decision.value : null;
  const kind = value === null ? null : readingKind(value);
  if (decision.verdict === "date" && !kind) {
    throw createError({
      statusCode: 400,
      message: "Data musi być dniem (RRRR-MM-DD) albo rokiem (RRRR).",
    });
  }
  const status: ExtractStatus =
    decision.verdict === "date"
      ? "agreed"
      : decision.verdict === "unreadable"
        ? "unreadable"
        : "withdrawn";
  const ref = db.collection(EXTRACTS).doc(args.extractId);

  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.status === "failed") {
      throw createError({
        statusCode: 404,
        message: "Nie ma takiego wycinka.",
      });
    }
    if (data.status === "open") {
      throw createError({
        statusCode: 409,
        message: "Ten wycinek czeka jeszcze na czytelników.",
      });
    }
    if (!waitsForAdmin(data)) {
      throw createError({
        statusCode: 409,
        message: "Ten wycinek ktoś już rozstrzygnął.",
      });
    }

    const at = Timestamp.fromDate(now);
    tx.update(ref, {
      status,
      agreed: kind ? { value, kind, by: "admin", uid: args.uid, at } : null,
      decision: {
        verdict: decision.verdict,
        value,
        uid: args.uid,
        at,
        // What it replaced, which `status` and `agreed` no longer say.
        before: {
          status: data.status,
          agreed: (data.agreed?.value as string | undefined) ?? null,
        },
      },
      // Out of the comparison it was in. A date is compared afresh by the
      // caller, and `pageMatch` null is what the sweep finds it by should
      // that fail; the others compare with nothing.
      pageMatch: null,
      pageRecheck: false,
      updatedAt: at,
    });
    return { id: args.extractId, status, compare: kind === "date" };
  });
}

function dataUrl(bytes: unknown): string | null {
  if (!bytes) return null;
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes as Uint8Array);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** The pictures of a crop, or null for a crop that does not exist. */
export async function cropImages(
  db: Firestore,
  extractId: string,
): Promise<CropImages | null> {
  const [extract, images] = await db.getAll(
    db.collection(EXTRACTS).doc(extractId),
    db.collection(EXTRACT_IMAGES).doc(extractId),
  );
  if (!extract?.exists) return null;
  return {
    date: dataUrl(images?.get("date")),
    name: dataUrl(images?.get("name")),
  };
}
