import type {
  DocumentData,
  DocumentSnapshot,
  Firestore,
} from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { warsawDate } from "~~/shared/dates";
import {
  agreedName,
  settleReading,
  type DeclarationAnswer,
  type DeclarationQueue,
  type DeclarationTask,
  type LocalOffice,
  type ReaderAnswer,
  type Settlement,
} from "~~/shared/declarations";

export const EXTRACTS = "declarationExtracts";
export const EXTRACT_IMAGES = "declarationExtractImages";
export const ANSWERS = "declarationAnswers";
export const READER_LIMITS = "declarationReaderLimits";
export const PUBLICATIONS = "declarationPublications";
export const PUBLISH_LIMITS = "declarationPublishLimits";

/** Answers one reader may give in a Warsaw day. Far above what a person reads
 * in a sitting (the 10-29 review read 145 crops in an afternoon), low enough
 * that one account cannot read the whole queue alone. */
export const READER_DAILY_LIMIT = 300;

/** Whether an account's answers can count towards an agreement.
 *
 * Agreement is counted in distinct accounts, so an account has to be some
 * evidence of a person: a Google sign-in, or an e-mail address its owner
 * confirmed. Sign-up with a password sends the confirmation mail but never
 * requires it (LoginForm.vue), which on its own would let one person make the
 * two readers that publish a page. */
export function isCountedReader(user: DecodedIdToken): boolean {
  return (
    user.email_verified === true ||
    user.firebase.sign_in_provider === "google.com"
  );
}

/** A 403 for an account that cannot read crops yet. */
export function requireCountedReader(user: DecodedIdToken): DecodedIdToken {
  if (!isCountedReader(user)) {
    throw createError({
      statusCode: 403,
      message:
        "Potwierdź adres e-mail (link przyszedł po rejestracji), żeby odczytywać oświadczenia.",
    });
  }
  return user;
}

/** An answer's document: one per crop and reader, so answering again
 * replaces the earlier answer instead of adding a voice. */
export function answerId(extractId: string, uid: string): string {
  return `${extractId}_${uid}`;
}

/** The unit and office of a crop, as the reading task names them, and as a
 * page that links the declaration does. */
export function unitOf(data: DocumentData): {
  unit: string;
  office: LocalOffice | null;
} {
  const unit = Array.isArray(data.units) ? data.units[0] : undefined;
  return {
    unit: unit?.unitName ?? (unit?.teryt ? `TERYT ${unit.teryt}` : ""),
    office: unit?.office ?? null,
  };
}

function dataUrl(bytes: unknown): string | null {
  if (!bytes) return null;
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes as Uint8Array);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** A crop as a reader gets it: nothing about whose it is but the unit and
 * office, no date, no link to the form (see `DeclarationTask`). */
export function taskOf(
  extract: DocumentSnapshot,
  images: DocumentSnapshot | undefined,
): DeclarationTask | null {
  const data = extract.data();
  const date = dataUrl(images?.get("date"));
  if (!data || !date) return null;
  const size = data.imageSize ?? {};
  return {
    id: extract.id,
    ...unitOf(data),
    declarationYear: data.declarationYear ?? null,
    images: { date, name: dataUrl(images?.get("name")) },
    imageSize: {
      date: size.date ?? { width: 0, height: 0 },
      name: size.name ?? null,
    },
  };
}

/** The crops this reader should read next, most useful first.
 *
 * Drafts before published pages (`priority`, Szymon's order), and within a
 * tier the crops one reader already answered: a second reading is what
 * settles a crop, so readers are sent where one is missing before they start
 * new ones. A crop this reader answered or skipped is never served again.
 *
 * Pages through the open crops with a cursor rather than an offset, which
 * Firestore bills per skipped document. */
export async function nextTasks(
  db: Firestore,
  uid: string,
  count: number,
  exclude: ReadonlySet<string> = new Set(),
): Promise<DeclarationTask[]> {
  const picked: DocumentSnapshot[] = [];
  let cursor: DocumentSnapshot | undefined;
  for (let page = 0; page < 6 && picked.length < count; page++) {
    let query = db
      .collection(EXTRACTS)
      .where("status", "==", "open")
      .orderBy("priority", "asc")
      .orderBy("answerCount", "desc")
      .orderBy("rand", "asc")
      .limit(40);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    cursor = snapshot.docs.at(-1);

    const fresh = snapshot.docs.filter((doc) => !exclude.has(doc.id));
    if (fresh.length === 0) continue;
    const mine = await db.getAll(
      ...fresh.map((doc) => db.collection(ANSWERS).doc(answerId(doc.id, uid))),
    );
    fresh.forEach((doc, i) => {
      if (!mine[i]!.exists && picked.length < count) picked.push(doc);
    });
  }
  if (picked.length === 0) return [];

  const images = await db.getAll(
    ...picked.map((doc) => db.collection(EXTRACT_IMAGES).doc(doc.id)),
  );
  return picked
    .map((doc, i) => taskOf(doc, images[i]))
    .filter((task): task is DeclarationTask => task !== null);
}

/** What /oswiadczenia needs: the next crops and the counts around them. */
export async function queueFor(
  db: Firestore,
  uid: string,
  count: number,
  exclude: ReadonlySet<string> = new Set(),
): Promise<DeclarationQueue> {
  const today = warsawDate();
  const mine = db.collection(ANSWERS).where("uid", "==", uid);
  const [tasks, open, total, todays] = await Promise.all([
    nextTasks(db, uid, count, exclude),
    db.collection(EXTRACTS).where("status", "==", "open").count().get(),
    mine.where("counted", "==", true).count().get(),
    mine.where("counted", "==", true).where("day", "==", today).count().get(),
  ]);
  return {
    task: tasks[0] ?? null,
    upcoming: tasks.slice(1),
    open: open.data().count,
    mine: { total: total.data().count, today: todays.data().count },
  };
}

/** What a crop's answers add up to, kept on the crop: how many read which
 * date, how many could not. Counts only - who answered stays in the answers. */
function summaryOf(answers: readonly ReaderAnswer[]) {
  const readings: Record<string, number> = {};
  let unreadable = 0;
  let empty = 0;
  for (const answer of answers) {
    if (answer.verdict === "date" && answer.value) {
      readings[answer.value] = (readings[answer.value] ?? 0) + 1;
    } else if (answer.verdict === "unreadable") unreadable += 1;
    else if (answer.verdict === "empty") empty += 1;
  }
  return { readings, unreadable, empty };
}

export type RecordedAnswer = {
  /** What the answers settle, if this answer settled the crop. */
  settled: Settlement | null;
  documentUrl: string;
  host: string | null;
};

/**
 * Stores a reader's answer and settles the crop when the answers agree, in
 * one transaction: two readers answering the same crop at once cannot both
 * miss the agreement, nor settle it twice.
 *
 * An answer to a crop that is no longer open is kept - it is still somebody's
 * reading - but changes nothing.
 */
export async function recordAnswer(
  db: Firestore,
  args: {
    extractId: string;
    user: DecodedIdToken;
    answer: DeclarationAnswer;
    now?: Date;
  },
): Promise<RecordedAnswer> {
  const now = args.now ?? new Date();
  const day = warsawDate(now);
  const uid = args.user.uid;
  const extractRef = db.collection(EXTRACTS).doc(args.extractId);
  const answerRef = db.collection(ANSWERS).doc(answerId(args.extractId, uid));
  const limitRef = db.collection(READER_LIMITS).doc(`${day}_${uid}`);
  const counted = args.answer.verdict !== "skip";

  return db.runTransaction(async (tx) => {
    const [extract, others, limit] = await Promise.all([
      tx.get(extractRef),
      tx.get(db.collection(ANSWERS).where("extractId", "==", args.extractId)),
      tx.get(limitRef),
    ]);
    const data = extract.data();
    if (!data || data.status === "failed" || data.status === "withdrawn") {
      throw createError({
        statusCode: 404,
        message: "Nie ma takiego wycinka.",
      });
    }
    const usedToday = (limit.get("count") as number | undefined) ?? 0;
    if (counted && usedToday >= READER_DAILY_LIMIT) {
      throw createError({
        statusCode: 429,
        message: "Na dziś wystarczy - dziękujemy! Wróć jutro.",
      });
    }

    const mine: ReaderAnswer = {
      uid,
      verdict: args.answer.verdict,
      value: args.answer.value ?? null,
      name: args.answer.name?.trim() || null,
    };
    const answers = [
      ...others.docs
        .map((doc) => doc.data() as ReaderAnswer)
        .filter((answer) => answer.uid !== uid),
      mine,
    ];
    const countedAnswers = answers.filter((a) => a.verdict !== "skip");

    tx.set(answerRef, {
      extractId: args.extractId,
      uid,
      verdict: mine.verdict,
      value: mine.value,
      name: mine.name,
      counted,
      day,
      // Which picture was answered, should the crop ever be cut again.
      imageHash: data.imageHash ?? null,
      at: Timestamp.fromDate(now),
    });
    if (counted) {
      tx.set(limitRef, { count: usedToday + 1, day }, { merge: true });
    }

    const settlement = data.status === "open" ? settleReading(answers) : null;
    const settles =
      settlement?.status === "agreed" ||
      settlement?.status === "unreadable" ||
      settlement?.status === "disputed";
    tx.update(extractRef, {
      answerCount: countedAnswers.length,
      answers: summaryOf(countedAnswers),
      updatedAt: Timestamp.fromDate(now),
      ...(settlement && settles
        ? {
            status: settlement.status,
            agreed:
              settlement.status === "agreed"
                ? {
                    value: settlement.value,
                    kind: settlement.kind,
                    by: "readers",
                    readers: settlement.readers,
                    at: Timestamp.fromDate(now),
                  }
                : null,
            agreedName: agreedName(countedAnswers),
          }
        : {}),
    });

    return {
      settled: settles ? settlement : null,
      documentUrl: String(data.url ?? ""),
      host: (data.host as string | null) ?? null,
    };
  });
}
