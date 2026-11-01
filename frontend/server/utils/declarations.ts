import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  QuerySnapshot,
  Transaction,
} from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { H3Event } from "h3";
import { createHash } from "node:crypto";
import { warsawDate } from "~~/shared/dates";
import {
  agreedName,
  answerVotes,
  READ_NAMES,
  READER_ID_PATTERN,
  settleReading,
  type DeclarationAnswer,
  type DeclarationQueue,
  type DeclarationTask,
  type LocalOffice,
  type ReaderAnswer,
  type Settlement,
} from "~~/shared/declarations";
import { getUser } from "./auth";

export const EXTRACTS = "declarationExtracts";
export const EXTRACT_IMAGES = "declarationExtractImages";
export const ANSWERS = "declarationAnswers";
export const READER_LIMITS = "declarationReaderLimits";
export const PUBLICATIONS = "declarationPublications";
export const PUBLISH_LIMITS = "declarationPublishLimits";
/** One record a reader and a person they found: the reader typed a date off
 * one of the person's crops that the birth date on the person's page does not
 * contradict (`creditFinds` in declarationPublish.ts). Server-only, like the
 * answers. */
export const READER_FINDS = "declarationReaderFinds";

/** Answers one reader may give in a Warsaw day. Far above what a person reads
 * in a sitting (the 10-29 review read 145 crops in an afternoon), low enough
 * that one account cannot read the whole queue alone. A browser without an
 * account is held to it too, under its reader id, and the answers an account
 * claims count on it for the days they were given (`claimAnswers`). */
export const READER_DAILY_LIMIT = 300;

/** Answers all readers without a vote may give in a Warsaw day, between them,
 * skips included: what ten readers may read in a day. A reader id costs
 * nothing to make, and an account nobody confirmed costs one sign-up, so the
 * limit per reader bounds nothing here; this bounds what they can write. Past
 * it, reading goes on with an account that votes. */
export const VOTELESS_DAILY_LIMIT = 3000;

/** Times all readers without a vote may ask for crops in a Warsaw day,
 * between them: four to every answer they may give. A sitting asks once or
 * twice, as every answer brings the next crops with it; what this bounds is a
 * stranger asking without answering, a fresh reader id each time, when every
 * ask reads a page of crops and this reader's answers to them. */
export const VOTELESS_ASK_DAILY_LIMIT = 4 * VOTELESS_DAILY_LIMIT;

/** Documents a day's room for readers without a vote is kept on, each with
 * its share of it. On one document every stranger's answer would wait for the
 * one before it; on ten, only those that land on the same one do. */
export const ROOM_SHARDS = 10;

/** The names of the two rooms in `declarationReaderLimits`. */
const VOTELESS_ANSWERS = "voteless-answers";
const VOTELESS_ASKS = "voteless-asks";

/** Answers a claim copies to the account at most: days of reading in one
 * browser, as a reader without an account may give `READER_DAILY_LIMIT` a
 * day, and few enough that the claim stays a request. It takes over all of
 * them, and the sweep copies the rest (`finishClaims`). */
export const CLAIM_LIMIT = 1000;

/** Crops a claim works on at once, each in a transaction of its own: a
 * thousand one after another would outlast the page's wait for the claim. */
const CLAIM_CONCURRENCY = 20;

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

/** Who answers a crop. */
export type DeclarationReader = {
  /** Whose the answers are: the account's uid, or `anon:<reader key>`. */
  uid: string;
  /** Whether the answers count towards an agreement. */
  votes: boolean;
  /** Reading without an account, under the browser's reader id. */
  anonymous: boolean;
};

/** What the database knows a browser without an account by: the SHA-256 of
 * its reader id, in hex. The browser keeps the id and sends it with what it
 * asks; nothing stored, nor an export of it, holds the id, so nothing there
 * is enough to read as that browser or to claim what it read
 * (`claimAnswers`). */
export function readerKeyOf(readerId: string): string {
  return createHash("sha256").update(readerId).digest("hex");
}

/** The uid the answers of a browser without an account are filed under: its
 * key (`readerKeyOf`), behind a prefix that keeps it apart from every
 * account's uid. */
export function anonymousUid(readerId: string): string {
  return `anon:${readerKeyOf(readerId)}`;
}

/** Where a browser's answers given before the database held keys (2026-11)
 * are filed: under its reader id itself. A claim reads them still. */
export function legacyAnonymousUid(readerId: string): string {
  return `anon:${readerId}`;
}

/** A reader id as a browser sent it, lower-cased, or null for anything but a
 * version 4 UUID. */
export function readerIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.toLowerCase();
  return READER_ID_PATTERN.test(id) ? id : null;
}

/**
 * Who is asking for crops or answering one. Reading is open to readers
 * without an account: their answers are kept under their browser's id and
 * count towards no automatic publication.
 *
 * A token makes the reader its account, whose answers vote once it is some
 * evidence of a person (`isCountedReader`); an account without a confirmed
 * address reads all the same, without a vote. Without a token, the browser's
 * reader id (`X-Reader-Id`) files the answers under its key
 * (`anonymousUid`), never with a vote. A token that does not verify is a 401
 * even beside a reader id: a
 * signed-in reader whose token lapsed must find out, not have their answers
 * filed as a stranger's.
 */
export async function getReader(event: H3Event): Promise<DeclarationReader> {
  if (getRequestHeader(event, "Authorization") !== undefined) {
    const user = await getUser(event);
    return { uid: user.uid, votes: isCountedReader(user), anonymous: false };
  }
  const readerId = readerIdOf(getRequestHeader(event, "X-Reader-Id"));
  if (readerId) {
    return { uid: anonymousUid(readerId), votes: false, anonymous: true };
  }
  throw createError({
    statusCode: 401,
    message:
      "Błąd uwierzytelniania: brak tokenu ani identyfikatora czytelnika. Proszę się zalogować.",
  });
}

/** A share of a day's room for readers without a vote, as whoever takes from
 * it read it. */
type RoomShare = { ref: DocumentReference; count: number };

/**
 * A share of a day's room with space left in it, or null once every share is
 * full: `<day>_<name>_<n>` in `declarationReaderLimits`, `ROOM_SHARDS` of
 * them, each holding its part of `limit`. The search starts at a random share
 * and moves on while they are full, so the shares fill evenly.
 *
 * `read` is the `get` of the transaction that takes from the room, which then
 * adds its one to the share in that same transaction: that is what keeps the
 * room exact however many readers answer at once. For a look without taking,
 * it is a plain read.
 */
async function roomIn(
  db: Firestore,
  read: (ref: DocumentReference) => Promise<DocumentSnapshot>,
  name: string,
  day: string,
  limit: number,
): Promise<RoomShare | null> {
  const share = Math.ceil(limit / ROOM_SHARDS);
  const start = Math.floor(Math.random() * ROOM_SHARDS);
  for (let i = 0; i < ROOM_SHARDS; i++) {
    const ref = db
      .collection(READER_LIMITS)
      .doc(`${day}_${name}_${(start + i) % ROOM_SHARDS}`);
    const count = Number((await read(ref)).get("count") ?? 0);
    if (count < share) return { ref, count };
  }
  return null;
}

/** The 429 for a reader without a vote once the day's room for them is used
 * up. What lets them read on is an account that votes, so that is what it
 * asks for: to sign in, or to confirm the address. */
function votelessRefusal(reader: DeclarationReader) {
  return createError({
    statusCode: 429,
    message: reader.anonymous
      ? "Na dziś przyjęliśmy już tyle odczytów bez konta, ile możemy. Zaloguj się albo załóż konto, żeby czytać dalej."
      : "Na dziś przyjęliśmy już tyle odczytów bez potwierdzonego adresu e-mail, ile możemy. Potwierdź adres (link przyszedł po rejestracji), żeby czytać dalej.",
  });
}

/**
 * Lets a reader ask for crops (`/api/declarations/next`): a reader whose
 * answers vote always, one without a vote while the day has room both for
 * their answers and for their asking.
 *
 * Each ask without a vote is counted on the day's room for asks: it reads a
 * page of crops and this reader's answers to them, and a stranger can ask
 * with a fresh reader id every time. Once the day's answers without a vote
 * are used up, a crop served would only come back refused, after the reader
 * typed it out, so none is served.
 */
export async function admitToQueue(
  db: Firestore,
  reader: DeclarationReader,
  now: Date = new Date(),
): Promise<void> {
  if (reader.votes) return;
  const day = warsawDate(now);
  const [answersLeft, asked] = await Promise.all([
    roomIn(db, (ref) => ref.get(), VOTELESS_ANSWERS, day, VOTELESS_DAILY_LIMIT),
    db.runTransaction(async (tx) => {
      const room = await roomIn(
        db,
        (ref) => tx.get(ref),
        VOTELESS_ASKS,
        day,
        VOTELESS_ASK_DAILY_LIMIT,
      );
      if (room) {
        tx.set(room.ref, { count: room.count + 1, day }, { merge: true });
      }
      return room !== null;
    }),
  ]);
  if (!answersLeft || !asked) throw votelessRefusal(reader);
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

/** A crop's stored bytes as the data URL a page draws. */
export function dataUrl(bytes: unknown): string | null {
  if (!bytes) return null;
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes as Uint8Array);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** A crop as a reader gets it: nothing about whose it is but the unit, the
 * office and the link to the form, and no date (see `DeclarationTask`). */
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
    documentUrl: String(data.url ?? ""),
    host: (data.host as string | null) ?? null,
    images: { date, name: READ_NAMES ? dataUrl(images?.get("name")) : null },
    imageSize: {
      date: size.date ?? { width: 0, height: 0 },
      name: READ_NAMES ? (size.name ?? null) : null,
    },
  };
}

/** The crops this reader should read next, most useful first.
 *
 * Drafts before published pages (`priority`), and within a
 * tier the crops one reader already answered: a second reading is what
 * settles a crop, so readers are sent where one is missing before they start
 * new ones. Only answers that vote count here (`answerCount`), as only they
 * settle anything. A crop this reader answered or skipped is never served
 * again, with an account or under a browser's reader id alike.
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
  const [tasks, open, total, todays, found] = await Promise.all([
    nextTasks(db, uid, count, exclude),
    db.collection(EXTRACTS).where("status", "==", "open").count().get(),
    mine.where("counted", "==", true).count().get(),
    mine.where("counted", "==", true).where("day", "==", today).count().get(),
    db.collection(READER_FINDS).where("uid", "==", uid).count().get(),
  ]);
  return {
    task: tasks[0] ?? null,
    upcoming: tasks.slice(1),
    open: open.data().count,
    mine: {
      total: total.data().count,
      today: todays.data().count,
      found: found.data().count,
    },
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
    } else if (answer.verdict === "unreadable" || answer.verdict === "skip") {
      // A skip is a reader who could not read the line (`settleReading`).
      unreadable += 1;
    } else if (answer.verdict === "empty") empty += 1;
  }
  return { readings, unreadable, empty };
}

/** Whether an answer is a reading, not a skip, given with a vote: what a
 * claim weighs. */
function isVotingReading(answer: ReaderAnswer): boolean {
  return answer.verdict !== "skip" && answerVotes(answer);
}

/** A crop's answers that vote, the only ones its settling hears. Every
 * answer the site stores says whether it votes (`recordAnswer` and
 * `claimAnswers` write `votes`), so however many strangers answered a crop,
 * none of their answers is in this read. */
function votingAnswersTo(db: Firestore, extractId: string): Query {
  return db
    .collection(ANSWERS)
    .where("extractId", "==", extractId)
    .where("votes", "==", true);
}

function answersOf(snapshot: QuerySnapshot): ReaderAnswer[] {
  return snapshot.docs.map((doc) => doc.data() as ReaderAnswer);
}

/**
 * Writes onto a crop what its answers that vote add up to, inside the
 * caller's transaction: the counts every time, and what they settle while the
 * crop is open. Returns the settlement when the answers close the crop, else
 * null. The one place a crop is settled by readers, whether a voter answered
 * it (`recordAnswer`) or an account claimed answers to it (`claimAnswers`).
 * Nothing without a vote calls it, so the crop's `updatedAt`, which the
 * admin's lists are ordered by, moves with voters and never with strangers.
 *
 * `answerCount` and the summary count the answers that vote and nothing
 * else: the queue sends readers first to the crops a vote short of agreeing
 * (`nextTasks`), an admin deciding a disputed crop sees the readings that
 * disputed it, and an upload may still cut again a crop no voter has read
 * (`answerCount` in /api/ingest/declarations).
 */
function writeSettlement(
  tx: Transaction,
  extractRef: DocumentReference,
  data: DocumentData,
  answers: readonly ReaderAnswer[],
  now: Date,
): Settlement | null {
  // Skips included: three of them settle a crop as unreadable.
  const voting = answers.filter(answerVotes);
  const settlement = data.status === "open" ? settleReading(voting) : null;
  const settled =
    settlement !== null && settlement.status !== "open" ? settlement : null;
  tx.update(extractRef, {
    answerCount: voting.length,
    answers: summaryOf(voting),
    updatedAt: Timestamp.fromDate(now),
    ...(settled
      ? {
          status: settled.status,
          agreed:
            settled.status === "agreed"
              ? {
                  value: settled.value,
                  kind: settled.kind,
                  by: "readers",
                  readers: settled.readers,
                  at: Timestamp.fromDate(now),
                }
              : null,
          agreedName: agreedName(voting),
        }
      : {}),
  });
  return settled;
}

export type RecordedAnswer = {
  /** What the answers settle, if this answer settled the crop. */
  settled: Settlement | null;
  /** The person pages the crop is linked to, for crediting the reader with
   * whom a date found (`creditFinds`). */
  personIds: string[];
};

/**
 * Stores a reader's answer and, when it votes, settles the crop if the
 * answers agree, in one transaction: two readers answering the same crop at
 * once cannot both miss the agreement, nor settle it twice.
 *
 * Every answer counts as its reader's own work, but only one that votes has a
 * say (`DeclarationReader.votes`). One without a vote changes nothing a crop
 * settles, so it neither reads the crop's other answers nor writes the crop:
 * strangers' answers can pile up on one crop without lengthening anybody's
 * transaction on it, and an upload still finds the crop unread and may cut it
 * again. Answers without a vote are held instead to the day's room for them,
 * between them (`VOTELESS_DAILY_LIMIT`), taken in this same transaction.
 *
 * An answer to a crop that is no longer open is kept - it is still somebody's
 * reading - but changes nothing.
 */
export async function recordAnswer(
  db: Firestore,
  args: {
    extractId: string;
    reader: DeclarationReader;
    answer: DeclarationAnswer;
    now?: Date;
  },
): Promise<RecordedAnswer> {
  const now = args.now ?? new Date();
  const day = warsawDate(now);
  const { reader } = args;
  const { uid, votes } = reader;
  const extractRef = db.collection(EXTRACTS).doc(args.extractId);
  const answerRef = db.collection(ANSWERS).doc(answerId(args.extractId, uid));
  const limitRef = db.collection(READER_LIMITS).doc(`${day}_${uid}`);
  const counted = args.answer.verdict !== "skip";
  // A skip with a vote is a voice too (three settle a crop as unreadable), so
  // it is held to the reader's daily limit like a reading. A stranger's skip
  // has no say: it counts in the day's room for answers without a vote only.
  const limited = counted || votes;

  return db.runTransaction(async (tx) => {
    const [extract, limit] = await Promise.all([
      tx.get(extractRef),
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
    if (limited && usedToday >= READER_DAILY_LIMIT) {
      throw createError({
        statusCode: 429,
        message: "Na dziś wystarczy - dziękujemy! Wróć jutro.",
      });
    }
    const room = votes
      ? null
      : await roomIn(
          db,
          (ref) => tx.get(ref),
          VOTELESS_ANSWERS,
          day,
          VOTELESS_DAILY_LIMIT,
        );
    if (!votes && !room) throw votelessRefusal(reader);
    const others = votes
      ? await tx.get(votingAnswersTo(db, args.extractId))
      : null;

    const mine: ReaderAnswer = {
      uid,
      verdict: args.answer.verdict,
      value: args.answer.value ?? null,
      name: args.answer.name?.trim() || null,
      votes,
    };
    tx.set(answerRef, {
      extractId: args.extractId,
      uid,
      verdict: mine.verdict,
      value: mine.value,
      name: mine.name,
      votes,
      counted,
      day,
      // Which picture was answered, should the crop ever be cut again.
      imageHash: data.imageHash ?? null,
      at: Timestamp.fromDate(now),
    });
    if (limited) {
      tx.set(limitRef, { count: usedToday + 1, day }, { merge: true });
    }
    if (room) {
      tx.set(room.ref, { count: room.count + 1, day }, { merge: true });
    }

    return {
      settled: others
        ? writeSettlement(
            tx,
            extractRef,
            data,
            [...answersOf(others).filter((answer) => answer.uid !== uid), mine],
            now,
          )
        : null,
      personIds: Array.isArray(data.personIds)
        ? data.personIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  });
}

export type ClaimedAnswers = {
  /** Answers the account has now, copied from the browser's. */
  claimed: number;
  /** The crops they settled, and what they settled. */
  settled: { extractId: string; settlement: Settlement }[];
  /** The browser's answers the account took over and has no copy of yet,
   * which the sweep copies (`finishClaims`). Taken over is all the claim
   * needs, so the page forgets the id whatever this says. */
  left: number;
};

/**
 * Gives the account that has just signed in to a browser what the browser
 * read without an account (`POST /api/declarations/claim`), and settles what
 * the readings settle now that they vote. Nothing is deleted, and no record
 * of its own keeps the claim: the browser's answers say who took them over.
 *
 * In two steps. First the browser's answers are taken over: each is marked
 * with the account (`claimedBy`, `claimPending`), in batched writes that read
 * nothing, so no other reader's transaction stands in their way. That is the
 * claim, and the page may forget the id once it is made. Then each answer
 * taken over is copied to the account, under the account's uid, crop by
 * crop, each in a transaction that settles the crop again: the copy names
 * the document it claims (`claims`) and is what votes, counts in the reader's
 * tally and keeps the crop out of their queue. The browser's answer stays
 * where it was given, as it was given, and notes whether it was copied
 * (`copied`). What one request does not copy stays marked, and the sweep
 * copies it (`finishClaims`): all it needs is in the answers. So one crop's
 * failure stops nothing, and a browser whose reader never comes back loses
 * nothing.
 *
 * Where the account answered a crop itself, its own answer stands, unless it
 * has no say and the browser's would have one: an answer given before the
 * address was confirmed gives way to the same person's reading that votes.
 * An answer read off a picture that has since been cut again gets no copy,
 * as a reading of nothing the crop shows now.
 *
 * Only an account that votes can claim (`isCountedReader`). One whose address
 * nobody confirmed gets a 403, which the page takes as "not yet": it keeps
 * the reader id and claims again on a later visit, once the address is
 * confirmed. Copied before that, the answers would have no vote for good -
 * and a password sign-up is signed in before its confirmation mail can even
 * be opened (LoginForm.vue), so every reader who signs up that way would
 * claim too early.
 *
 * The 403 is for a browser with readings to wait for, as its words promise
 * („odczyty z tej przeglądarki przejdą na Twoje konto”). A browser that only
 * looked has a reader id all the same, made with its first ask for crops, and
 * a skip is no reading, as the reader's own count has it (`counted`): for such
 * an id the claim answers 0 and takes over nothing, and the page forgets the
 * id. A read a uid the browser files under to tell, for an account without a
 * vote only.
 *
 * Holding the reader id is the proof that the answers are this person's.
 * The database holds only the id's hash (`readerKeyOf`), so neither it nor an
 * export of it is enough to claim them; the id itself is 122 random bits,
 * kept in the one browser that made it and sent only to this site (never to
 * Sentry: see `PRIVATE_HEADERS` in sentry.server.config.ts).
 *
 * The copies vote within the account's daily limit, on the days the answers
 * were given (`READER_DAILY_LIMIT`): an account that claimed one browser's
 * readings after another's would otherwise vote on as many crops a day as it
 * has browsers. What a day has no room for is copied all the same, without a
 * vote. The room is taken before anything is copied, in one transaction, so
 * two passes at once cannot both spend it, and what was taken for an answer
 * that got no copy is given back afterwards.
 *
 * Each answer goes to the first account that claims it: should the page have
 * kept the id, an account that signs in there later gets what was read since.
 * Idempotent: a second claim finds nothing to take over or copy, and writes
 * nothing.
 */
export async function claimAnswers(
  db: Firestore,
  args: { readerId: string; user: DecodedIdToken; now?: Date },
): Promise<ClaimedAnswers> {
  const now = args.now ?? new Date();
  const from = [anonymousUid(args.readerId), legacyAnonymousUid(args.readerId)];
  const to = args.user.uid;
  const none: ClaimedAnswers = { claimed: 0, settled: [], left: 0 };
  if (!isCountedReader(args.user)) {
    const readings = await Promise.all(
      from.map((uid) =>
        db
          .collection(ANSWERS)
          .where("uid", "==", uid)
          .where("counted", "==", true)
          .limit(1)
          .get(),
      ),
    );
    if (readings.every((found) => found.empty)) return none;
    throw createError({
      statusCode: 403,
      message:
        "Potwierdź adres e-mail (link przyszedł po rejestracji), a odczyty z tej przeglądarki przejdą na Twoje konto.",
    });
  }

  const given = await browserAnswers(db, from, now);
  const free = given.filter((answer) => answer.claimedBy === null);
  await takeOver(db, free, to, now);
  await takeOverFinds(db, from, to, now);
  const waiting = [
    ...given.filter((answer) => answer.claimedBy === to && answer.pending),
    ...free,
  ];
  if (waiting.length === 0) return none;
  const pass = waiting.slice(0, CLAIM_LIMIT);
  const result = await copyClaimed(db, to, pass, now);
  return { ...result, left: result.left + waiting.length - pass.length };
}

/** Answers taken over and not copied yet that a sweep copies at most. */
const CLAIMS_PER_SWEEP = 200;

/**
 * Copies the answers accounts took over and have no copy of yet
 * (`claimPending`): what failed in a claim, or what was past its
 * `CLAIM_LIMIT`. The sweep the job runs after every upload calls it before
 * it compares the settled crops, so a crop a copy settled is compared in the
 * same sweep. The reader need not be there: the answers say whose they are.
 */
export async function finishClaims(
  db: Firestore,
  now: Date,
  size = CLAIMS_PER_SWEEP,
): Promise<{ finished: number; left: number }> {
  const pending = await db
    .collection(ANSWERS)
    .where("claimPending", "==", true)
    .limit(size)
    .get();
  const byAccount = new Map<string, GivenAnswer[]>();
  for (const answer of pending.docs.flatMap((doc) => givenAnswer(doc, now))) {
    if (!answer.claimedBy) continue;
    byAccount.set(answer.claimedBy, [
      ...(byAccount.get(answer.claimedBy) ?? []),
      answer,
    ]);
  }
  let finished = 0;
  let left = 0;
  for (const [to, answers] of byAccount) {
    const done = await copyClaimed(db, to, answers, now);
    finished += answers.length - done.left;
    left += done.left;
  }
  return { finished, left };
}

/** One of a browser's answers, as a claim weighs it. */
type GivenAnswer = {
  ref: DocumentReference;
  extractId: string;
  day: string;
  counted: boolean;
  /** The account that took it over, or null. */
  claimedBy: string | null;
  /** Taken over, and not copied yet. */
  pending: boolean;
};

function givenAnswer(doc: DocumentSnapshot, now: Date): GivenAnswer[] {
  const extractId = doc.get("extractId");
  if (typeof extractId !== "string" || extractId === "") return [];
  const claimedBy = doc.get("claimedBy");
  return [
    {
      ref: doc.ref,
      extractId,
      day: String(doc.get("day") ?? warsawDate(now)),
      counted: doc.get("counted") === true,
      claimedBy: typeof claimedBy === "string" ? claimedBy : null,
      pending: doc.get("claimPending") === true,
    },
  ];
}

/** Every answer a browser gave, under each uid it files under. */
async function browserAnswers(
  db: Firestore,
  uids: readonly string[],
  now: Date,
): Promise<GivenAnswer[]> {
  const found = await Promise.all(
    uids.map((uid) => db.collection(ANSWERS).where("uid", "==", uid).get()),
  );
  return found.flatMap((snapshot) =>
    snapshot.docs.flatMap((doc) => givenAnswer(doc, now)),
  );
}

/** Writes one batch takes, under a batch's 500. */
const WRITES_PER_BATCH = 400;

/** Marks a browser's answers as the account's, to be copied: the claim. */
async function takeOver(
  db: Firestore,
  answers: readonly GivenAnswer[],
  to: string,
  now: Date,
) {
  for (let i = 0; i < answers.length; i += WRITES_PER_BATCH) {
    const batch = db.batch();
    for (const answer of answers.slice(i, i + WRITES_PER_BATCH)) {
      batch.update(answer.ref, {
        claimedBy: to,
        claimedAt: Timestamp.fromDate(now),
        claimPending: true,
      });
    }
    await batch.commit();
  }
}

/** The people a browser found go to the account too: a copy of each record
 * under the account (`claims` names the browser's), kept once where the
 * account found the same person itself, and the browser's own record marked
 * with the account. */
async function takeOverFinds(
  db: Firestore,
  from: readonly string[],
  to: string,
  now: Date,
) {
  const found = await Promise.all(
    from.map((uid) =>
      db.collection(READER_FINDS).where("uid", "==", uid).get(),
    ),
  );
  const free = found
    .flatMap((snapshot) => snapshot.docs)
    .filter((find) => !find.get("claimedBy") && find.get("personId"));
  // Two writes a find.
  for (let i = 0; i < free.length; i += WRITES_PER_BATCH / 2) {
    const batch = db.batch();
    for (const find of free.slice(i, i + WRITES_PER_BATCH / 2)) {
      batch.set(
        db.collection(READER_FINDS).doc(`${to}_${find.get("personId")}`),
        { ...find.data(), uid: to, claims: find.id },
        { merge: true },
      );
      batch.update(find.ref, {
        claimedBy: to,
        claimedAt: Timestamp.fromDate(now),
      });
    }
    await batch.commit();
  }
}

/**
 * Copies to an account the answers it took over (`claimAnswers`):
 * `CLAIM_CONCURRENCY` at a time, each crop in a transaction of its own, then
 * what failed once more alone, with nothing of the pass's own beside it. A
 * crop that fails alone too ends the pass: whatever stops it is not the
 * pass's own crowding, and each failure costs the client library's five
 * attempts. What is left stays marked for the sweep (`left`).
 */
async function copyClaimed(
  db: Firestore,
  to: string,
  answers: readonly GivenAnswer[],
  now: Date,
): Promise<ClaimedAnswers> {
  const result: ClaimedAnswers = { claimed: 0, settled: [], left: 0 };

  // A skip is no answer the limit counts, and has no say either way.
  const wanted = new Map<string, number>();
  for (const answer of answers) {
    if (answer.counted) {
      wanted.set(answer.day, (wanted.get(answer.day) ?? 0) + 1);
    }
  }
  const room = await takeVotes(db, to, wanted);
  const plan = answers.map((answer) => {
    if (!answer.counted) return { ...answer, votes: true };
    const left = room.get(answer.day) ?? 0;
    room.set(answer.day, left - 1);
    return { ...answer, votes: left > 0 };
  });

  const unused = new Map<string, number>();
  const giveBack = (answer: (typeof plan)[number]) => {
    if (answer.counted && answer.votes) {
      unused.set(answer.day, (unused.get(answer.day) ?? 0) + 1);
    }
  };
  const copy = async (answer: (typeof plan)[number]) => {
    const { copied, settled } = await copyAnswer(db, {
      extractId: answer.extractId,
      original: answer.ref,
      to,
      votes: answer.votes,
      now,
    });
    if (copied) result.claimed += 1;
    else giveBack(answer);
    if (settled) {
      result.settled.push({ extractId: answer.extractId, settlement: settled });
    }
  };
  const failed: typeof plan = [];
  for (let i = 0; i < plan.length; i += CLAIM_CONCURRENCY) {
    const batch = plan.slice(i, i + CLAIM_CONCURRENCY);
    const outcomes = await Promise.allSettled(batch.map(copy));
    outcomes.forEach((outcome, j) => {
      if (outcome.status === "rejected") failed.push(batch[j]!);
    });
  }
  for (const [i, answer] of failed.entries()) {
    try {
      await copy(answer);
    } catch (error) {
      result.left = failed.length - i;
      console.error(
        `[declarations] copying ${answer.extractId} failed twice, ${result.left} answers left for the sweep`,
        error,
      );
      failed.slice(i).forEach(giveBack);
      break;
    }
  }
  await giveBackVotes(db, to, unused);
  return result;
}

/** Takes from an account's daily limits the votes a claim gives, in one
 * transaction: as many of each day's answers as that day has room for.
 * Returns how many may vote, day by day. */
async function takeVotes(
  db: Firestore,
  uid: string,
  wanted: ReadonlyMap<string, number>,
): Promise<Map<string, number>> {
  if (wanted.size === 0) return new Map();
  const days = [...wanted.keys()];
  const refs = days.map((day) =>
    db.collection(READER_LIMITS).doc(`${day}_${uid}`),
  );
  return db.runTransaction(async (tx) => {
    const limits = await Promise.all(refs.map((ref) => tx.get(ref)));
    const granted = new Map<string, number>();
    days.forEach((day, i) => {
      const used = Number(limits[i]!.get("count") ?? 0);
      const take = Math.min(
        wanted.get(day) ?? 0,
        Math.max(0, READER_DAILY_LIMIT - used),
      );
      granted.set(day, take);
      if (take > 0) {
        tx.set(refs[i]!, { count: used + take, day }, { merge: true });
      }
    });
    return granted;
  });
}

/** Gives back to an account's daily limits what a claim took for answers it
 * did not move. */
async function giveBackVotes(
  db: Firestore,
  uid: string,
  unused: ReadonlyMap<string, number>,
): Promise<void> {
  await Promise.all(
    [...unused].map(([day, count]) =>
      db
        .collection(READER_LIMITS)
        .doc(`${day}_${uid}`)
        .set({ count: FieldValue.increment(-count), day }, { merge: true }),
    ),
  );
}

/** The account's copy of a browser's answer it took over. */
type ClaimedAnswer = ReaderAnswer & {
  extractId: string;
  counted: boolean;
  day: unknown;
  imageHash: string | null;
  at: unknown;
  /** The browser's `anon:<reader key>`. */
  claimedFrom: string;
  /** The browser's answer this is a copy of, which stays where it is. */
  claims: string;
  claimedAt: Timestamp;
};

/** One crop of a claim: the account gets a copy of the browser's answer it
 * took over, unless the account's own stands or the picture was cut again
 * since, and the crop is settled again when what its answers that vote say
 * has changed. The browser's answer stays, and notes whether it was
 * copied. */
async function copyAnswer(
  db: Firestore,
  args: {
    extractId: string;
    /** The browser's answer. */
    original: DocumentReference;
    to: string;
    /** Whether the copy votes: the account's limit decides. */
    votes: boolean;
    now: Date;
  },
): Promise<{ copied: boolean; settled: Settlement | null }> {
  const { extractId, original, to, now } = args;
  const extractRef = db.collection(EXTRACTS).doc(extractId);
  const toRef = db.collection(ANSWERS).doc(answerId(extractId, to));

  return db.runTransaction(async (tx) => {
    const [extract, theirs, own] = await Promise.all([
      tx.get(extractRef),
      tx.get(original),
      tx.get(toRef),
    ]);
    // Copied since the pass listed it, by a claim sent twice at once or a
    // sweep beside it; or given again since, which no account took over.
    if (theirs.get("claimPending") !== true || theirs.get("claimedBy") !== to) {
      return { copied: false, settled: null };
    }
    const data = extract.data();
    const given = theirs.data() as ReaderAnswer & Record<string, unknown>;
    // The reading alone: not the marks of the take-over, which are the
    // browser's answer's.
    const copy: ClaimedAnswer = {
      extractId,
      uid: to,
      verdict: given.verdict,
      value: given.value ?? null,
      name: given.name ?? null,
      votes: args.votes,
      counted: given.counted === true,
      day: given.day,
      imageHash: (given.imageHash as string | null | undefined) ?? null,
      at: given.at,
      claimedFrom: String(given.uid),
      claims: original.id,
      claimedAt: Timestamp.fromDate(now),
    };
    const outdated =
      data !== undefined && copy.imageHash !== (data.imageHash ?? null);
    const ownStands =
      own.exists &&
      (isVotingReading(own.data() as ReaderAnswer) || !isVotingReading(copy));
    if (outdated || ownStands) {
      tx.update(original, { claimPending: false, copied: false });
      return { copied: false, settled: null };
    }

    // Read before anything is written, as a transaction must.
    const voting =
      data && isVotingReading(copy)
        ? await tx.get(votingAnswersTo(db, extractId))
        : null;
    tx.update(original, { claimPending: false, copied: true });
    tx.set(toRef, copy);
    return {
      copied: true,
      settled:
        data && voting
          ? writeSettlement(
              tx,
              extractRef,
              data,
              [...answersOf(voting).filter((other) => other.uid !== to), copy],
              now,
            )
          : null,
    };
  });
}
