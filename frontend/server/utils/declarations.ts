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

/** Answers one claim moves at most: days of reading in one browser, as a
 * reader without an account may give `READER_DAILY_LIMIT` a day, and few
 * enough that the claim stays a request. Past it the rest stay under the
 * browser's id, which the page forgets once the claim succeeds. Nothing that
 * counted is lost: those answers never voted, and the account is served their
 * crops again. */
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
  /** Whose the answers are: the account's uid, or `anon:<reader id>`. */
  uid: string;
  /** Whether the answers count towards an agreement. */
  votes: boolean;
  /** Reading without an account, under the browser's reader id. */
  anonymous: boolean;
};

/** The uid the answers of a browser without an account are filed under. The
 * prefix keeps it apart from every account's uid. */
export function anonymousUid(readerId: string): string {
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
 * without an account (Szymon, round bip-czytanie-r1, 2026-10-29): "the
 * answers are aggregated under their ID - it doesn't count towards auto
 * publish for now".
 *
 * A token makes the reader its account, whose answers vote once it is some
 * evidence of a person (`isCountedReader`); an account without a confirmed
 * address reads all the same, without a vote. Without a token, the browser's
 * reader id (`X-Reader-Id`) files the answers under `anon:<id>`, never with a
 * vote. A token that does not verify is a 401 even beside a reader id: a
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
    images: { date, name: READ_NAMES ? dataUrl(images?.get("name")) : null },
    imageSize: {
      date: size.date ?? { width: 0, height: 0 },
      name: READ_NAMES ? (size.name ?? null) : null,
    },
  };
}

/** The crops this reader should read next, most useful first.
 *
 * Drafts before published pages (`priority`, Szymon's order), and within a
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
  documentUrl: string;
  host: string | null;
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
      documentUrl: String(data.url ?? ""),
      host: (data.host as string | null) ?? null,
    };
  });
}

export type ClaimedAnswers = {
  /** Answers that are the account's now. */
  claimed: number;
  /** The crops they settled, and what they settled. */
  settled: { extractId: string; settlement: Settlement }[];
};

/**
 * Moves the answers a browser gave without an account onto the account that
 * has just signed in there (`POST /api/declarations/claim`), and settles what
 * they settle now that they vote. An answer keeps its reading and its day,
 * and names the id it came from (`claimedFrom`).
 *
 * Only an account that votes can claim (`isCountedReader`). One whose address
 * nobody confirmed gets a 403, which the page takes as "not yet": it keeps
 * the reader id and claims again on a later visit, once the address is
 * confirmed. Moved before that, the answers would have no vote for good and
 * the page would have forgotten the id - and a password sign-up is signed in
 * before its confirmation mail can even be opened (LoginForm.vue), so every
 * reader who signs up that way would claim too early.
 *
 * The 403 is for a browser with readings to wait for, as its words promise
 * („odczyty z tej przeglądarki przejdą na Twoje konto”). A browser that only
 * looked has a reader id all the same, made with its first ask for crops, and
 * a skip is no reading, as the reader's own count has it (`counted`): for such
 * an id the claim answers 0 and moves nothing, and the page forgets the id.
 * One read to tell, for an account without a vote only.
 *
 * Holding the reader id is the only proof that the answers are this
 * person's, and that is enough. The id is 122 random bits, kept in the one
 * browser that made it and sent only to this site (never to Sentry: see
 * `PRIVATE_HEADERS` in sentry.server.config.ts), so it is not guessed; and
 * what it unlocks is answers that never had a say. Somebody who did get hold
 * of one could only file a stranger's readings under their own account, one
 * answer a crop, which that account could give by reading the crops itself.
 *
 * The claimed answers vote within the account's daily limit, on the days
 * they were given (`READER_DAILY_LIMIT`): an account that claimed one
 * browser's readings after another's would otherwise vote on as many crops a
 * day as it has browsers. What a day has no room for moves all the same,
 * without a vote. The room is taken before anything moves, in one
 * transaction, so two claims at once cannot both spend it, and what was taken
 * for an answer that did not move is given back afterwards.
 *
 * A transaction per crop, as in `recordAnswer`. Where the account answered a
 * crop itself, its own answer stands, unless it has no say and the browser's
 * would have one: an answer given before the address was confirmed gives way
 * to the same person's reading that votes. An answer read off a picture that
 * has since been cut again is dropped, as a reading of nothing the crop shows
 * now. At most `CLAIM_LIMIT` answers a claim.
 *
 * Idempotent: a claimed answer is gone from the browser's id, so a second
 * claim finds nothing to move, and writes nothing.
 */
export async function claimAnswers(
  db: Firestore,
  args: { readerId: string; user: DecodedIdToken; now?: Date },
): Promise<ClaimedAnswers> {
  const now = args.now ?? new Date();
  const from = anonymousUid(args.readerId);
  const to = args.user.uid;
  if (!isCountedReader(args.user)) {
    const readings = await db
      .collection(ANSWERS)
      .where("uid", "==", from)
      .where("counted", "==", true)
      .limit(1)
      .get();
    if (readings.empty) return { claimed: 0, settled: [] };
    throw createError({
      statusCode: 403,
      message:
        "Potwierdź adres e-mail (link przyszedł po rejestracji), a odczyty z tej przeglądarki przejdą na Twoje konto.",
    });
  }
  const theirs = await db
    .collection(ANSWERS)
    .where("uid", "==", from)
    .limit(CLAIM_LIMIT)
    .get();
  const listed = theirs.docs.flatMap((doc) => {
    const extractId = doc.get("extractId");
    if (typeof extractId !== "string" || extractId === "") return [];
    return [
      {
        extractId,
        day: String(doc.get("day") ?? warsawDate(now)),
        counted: doc.get("counted") === true,
      },
    ];
  });
  if (listed.length === 0) return { claimed: 0, settled: [] };

  // A skip is no answer the limit counts, and has no say either way.
  const wanted = new Map<string, number>();
  for (const answer of listed) {
    if (answer.counted) {
      wanted.set(answer.day, (wanted.get(answer.day) ?? 0) + 1);
    }
  }
  const room = await takeVotes(db, to, wanted);
  const plan = listed.map((answer) => {
    if (!answer.counted) return { ...answer, votes: true };
    const left = room.get(answer.day) ?? 0;
    room.set(answer.day, left - 1);
    return { ...answer, votes: left > 0 };
  });

  const result: ClaimedAnswers = { claimed: 0, settled: [] };
  const unused = new Map<string, number>();
  for (let i = 0; i < plan.length; i += CLAIM_CONCURRENCY) {
    await Promise.all(
      plan.slice(i, i + CLAIM_CONCURRENCY).map(async (answer) => {
        const { moved, settled } = await claimAnswer(db, {
          extractId: answer.extractId,
          from,
          to,
          votes: answer.votes,
          now,
        });
        if (moved) result.claimed += 1;
        else if (answer.counted && answer.votes) {
          unused.set(answer.day, (unused.get(answer.day) ?? 0) + 1);
        }
        if (settled) {
          result.settled.push({
            extractId: answer.extractId,
            settlement: settled,
          });
        }
      }),
    );
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

/** A browser's answer as the account that claimed it keeps it. */
type ClaimedAnswer = ReaderAnswer & {
  /** The browser's `anon:<reader id>`. */
  claimedFrom: string;
  claimedAt: Timestamp;
};

/** One crop of a claim: the browser's answer becomes the account's, unless
 * the account's own stands or the picture was cut again since, and the crop
 * is settled again when what its answers that vote say has changed. */
async function claimAnswer(
  db: Firestore,
  args: {
    extractId: string;
    from: string;
    to: string;
    /** Whether the answer votes once moved: the account's limit decides. */
    votes: boolean;
    now: Date;
  },
): Promise<{ moved: boolean; settled: Settlement | null }> {
  const { extractId, from, to, now } = args;
  const extractRef = db.collection(EXTRACTS).doc(extractId);
  const fromRef = db.collection(ANSWERS).doc(answerId(extractId, from));
  const toRef = db.collection(ANSWERS).doc(answerId(extractId, to));

  return db.runTransaction(async (tx) => {
    const [extract, theirs, own] = await Promise.all([
      tx.get(extractRef),
      tx.get(fromRef),
      tx.get(toRef),
    ]);
    // Moved since the claim listed it, by the same claim sent twice at once.
    if (!theirs.exists) return { moved: false, settled: null };
    const data = extract.data();
    const answer = theirs.data() as ReaderAnswer & {
      imageHash?: string | null;
    };
    const moved: ClaimedAnswer = {
      ...answer,
      uid: to,
      votes: args.votes,
      claimedFrom: from,
      claimedAt: Timestamp.fromDate(now),
    };
    const outdated =
      data !== undefined &&
      (answer.imageHash ?? null) !== (data.imageHash ?? null);
    const ownStands =
      own.exists &&
      (isVotingReading(own.data() as ReaderAnswer) || !isVotingReading(moved));
    if (outdated || ownStands) {
      tx.delete(fromRef);
      return { moved: false, settled: null };
    }

    // Read before anything is written, as a transaction must.
    const voting =
      data && isVotingReading(moved)
        ? await tx.get(votingAnswersTo(db, extractId))
        : null;
    tx.delete(fromRef);
    tx.set(toRef, moved);
    return {
      moved: true,
      settled:
        data && voting
          ? writeSettlement(
              tx,
              extractRef,
              data,
              [...answersOf(voting).filter((other) => other.uid !== to), moved],
              now,
            )
          : null,
    };
  });
}
