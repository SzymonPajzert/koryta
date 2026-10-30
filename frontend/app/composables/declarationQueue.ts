import type { User } from "firebase/auth";
import type {
  AnswerVerdict,
  DeclarationAnswer,
  DeclarationAnswerResult,
  DeclarationQueue,
  DeclarationTask,
} from "~~/shared/declarations";
import { useCurrentUser } from "vuefire";
import { authRequest } from "~/composables/auth";
import { typedFromValue } from "~/utils/declarationReading";

/** A request the server turned down, with the reason to give the reader. */
export type Refusal = { status: number; message: string };

/** Where the reading endpoints turn a reader down in words written for them
 * (server/utils/declarations.ts and server/api/declarations/): 403 for a
 * claim by an account whose address nobody confirmed, 404 for a crop that is
 * gone (`GONE_LINE` says it in the page's words), 429 for a limit of the day.
 * A 401 is turned down in a programmer's words („nieważny token”), which the
 * page says in its own (`SIGNED_OUT_LINE`). A 400 is the page's own mistake,
 * worded by a validator for a programmer, and a 5xx says nothing a reader
 * can act on. */
const REFUSALS: ReadonlySet<number> = new Set([403, 404, 429]);

/** The page's line for a 401. The page sends every request with a token or
 * with this browser's reader id, so what the server turns down is a token
 * it will not take any more: a sign-in that lapsed, or was ended elsewhere.
 * The request after a refusal takes a fresh token (`refreshToken`), so
 * trying again, with „Spróbuj ponownie” under the alert or „Zapisz” on the
 * crop that came back with what was typed into it, renews a sign-in that
 * only lapsed, and keeps the typed answer, which a reload would lose. Where
 * Firebase cannot renew it, it signs the reader out, and the banner offers
 * the sign-in. Its first words are the button's. */
const SIGNED_OUT_LINE =
  "Sesja wygasła. Spróbuj ponownie albo zaloguj się jeszcze raz.";

/** The statuses ofetch asks again after, once, for a GET (an answer, a POST,
 * it never asks again): its own list without 429. A limit of the day turns
 * the second ask down as it did the first, and each ask without a vote takes
 * from the day's room for asks (`admitToQueue`), so asking again would only
 * use up what is left of it. A request the network lost, a timeout and a 5xx
 * are still asked again. */
const RETRY_STATUS_CODES = [408, 409, 425, 500, 502, 503, 504];

/** The page's line for an answer to a crop the server says is gone. Its own
 * words, „Nie ma takiego wycinka.”, are about the crop answered a moment
 * ago, but they come up over the next one, as if that one were missing, and
 * say nothing of the answer. Nor does this line say which crop it was: the
 * reader may have answered another one, or two, before the refusal came
 * back, and „the one before” would be one of those. */
const GONE_LINE =
  "Jeden z wycinków zniknął z kolejki, zanim zdążyliśmy zapisać Twoją odpowiedź.";

/**
 * Why the server turned the reader down, in the words to give them, or null
 * where it said nothing a reader can use: no answer at all (the network, a
 * timeout), a 5xx, any other status, a refusal without words. The page's own
 * lines stand in for those, and for a 401 (`SIGNED_OUT_LINE`), whatever the
 * server said with it.
 *
 * Nitro answers an error on an `/api/` path with JSON, and ofetch's
 * FetchError carries it as `data` and the status as `statusCode`. The words
 * `createError` was given are that JSON's `message`; its `statusMessage`, and
 * the response's status text with it, is "Server Error" for every error that
 * named none, a 429 included.
 */
export function refusalOf(error: unknown): Refusal | null {
  const failure = error as {
    statusCode?: unknown;
    data?: { message?: unknown } | null;
  } | null;
  const status = failure?.statusCode;
  if (status === 401) return { status, message: SIGNED_OUT_LINE };
  const message = failure?.data?.message;
  if (typeof status !== "number" || !REFUSALS.has(status)) return null;
  if (typeof message !== "string" || message.trim() === "") return null;
  return { status, message: message.trim() };
}

/** Has Firebase issue the reader a new token. Whether an account's answers
 * vote is read off its token (`isCountedReader`), and the token says what was
 * true when it was issued, up to an hour ago: a reader who has just confirmed
 * their address, as a refusal asked them to, would be turned down again on
 * the old one. A refresh that fails leaves the request the token it has. */
async function refreshToken(user: User) {
  try {
    await user.getIdToken(true);
  } catch (err) {
    console.warn("Could not refresh the reader's token", err);
  }
}

/** Where a reader without an account keeps the id their readings are filed
 * under. Szymon, round bip-czytanie-r1 (2026-10-29): reading is open to
 * readers who are not signed in, "We'd assign them some identifier and they
 * can either convert their found things to a signed up account or the answers
 * are aggregated under their ID - it doesn't count towards auto publish for
 * now". A random id in this browser, never an account: a Firebase anonymous
 * sign-in would make the reader "signed in" everywhere, and a signed-in
 * reader sees drafts and their dates, which a blind reading must not. */
const READER_KEY = "koryta:declaration-reader";

/** The reader id of a browser that keeps nothing, as a private window that
 * refuses storage: made on first use and held in memory for as long as the
 * page is open. Such a reader still reads, under one id, counted for nothing
 * like any reader without an account; a sign-in before they leave claims it,
 * and after a reload there is nothing left to claim. */
let unkeptReaderId: string | null = null;

function readKeptReaderId(): string | null {
  try {
    return window.localStorage.getItem(READER_KEY);
  } catch {
    return null;
  }
}

/** Whether the browser kept `id`: false where it refuses storage. */
function keepReaderId(id: string): boolean {
  try {
    window.localStorage.setItem(READER_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/** The id this browser's readings without an account are filed under, made
 * on first use when `create` is set: kept in the browser, so the next visit
 * files under it too, or held in memory where the browser refuses storage.
 * Either way a request without a token carries one, as the server needs: it
 * answers a request with neither a token nor a reader id with a 401. Null on
 * the server, and, without `create`, where nothing has been read yet. */
export function storedReaderId(create = false): string | null {
  // Held in a module, which on the server every request would share.
  if (import.meta.server) return null;
  const known = readKeptReaderId() ?? unkeptReaderId;
  if (known || !create) return known;
  const made = crypto.randomUUID();
  if (!keepReaderId(made)) unkeptReaderId = made;
  return made;
}

function forgetReaderId() {
  unkeptReaderId = null;
  try {
    window.localStorage.removeItem(READER_KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: unknown;
  timeout?: number;
};

/** A request on the reader's behalf: with their token when they are signed
 * in, a fresh one if `freshToken`, with this browser's reader id when they
 * are not. Never asked again after a 429 (`RETRY_STATUS_CODES`). */
async function readerRequest<T>(
  url: string,
  options: RequestOptions,
  freshToken = false,
): Promise<T> {
  const user = useCurrentUser();
  if (user.value) {
    if (freshToken) await refreshToken(user.value);
    return authRequest<T>(url, {
      ...options,
      retryStatusCodes: RETRY_STATUS_CODES,
    });
  }
  const id = storedReaderId(true);
  return await $fetch<T>(url, {
    method: (options.method || "POST") as "POST",
    body: options.body as Record<string, unknown>,
    query: options.query as Record<string, unknown>,
    timeout: options.timeout,
    retryStatusCodes: RETRY_STATUS_CODES,
    headers: id ? { "X-Reader-Id": id } : {},
  });
}

/** Moves this browser's readings without an account onto the account the
 * reader just signed in to, so what they read before counts as theirs. Kept
 * for another try when it fails, a 403 for an address nobody confirmed among
 * it (`refusalOf` has the server's words), which the server gives only where
 * there are readings to move; forgotten once the server has them, or has
 * found none, as for a browser that only looked.
 *
 * Firebase reloads the account when the page loads, so `emailVerified` says
 * whether the address is confirmed now; the token may not say so yet, and
 * the server reads the token. Where the two can differ, the claim takes a
 * fresh token: the visit after a reader confirmed their address is the one
 * that claims again. */
export async function claimStoredReadings(): Promise<number> {
  const readerId = storedReaderId();
  if (!readerId) return 0;
  const user = useCurrentUser();
  if (user.value?.emailVerified) await refreshToken(user.value);
  const result = await authRequest<{ claimed: number }>(
    "/api/declarations/claim",
    { method: "POST", body: { readerId }, timeout: 20_000 },
  );
  forgetReaderId();
  return result.claimed;
}

/** Where this browser notes, for as long as the tab is open, that the reader
 * was told why the readings it made without an account did not move. The
 * server turns the claim down (403) on every signed-in visit until the
 * address is confirmed; said on each, the line would stand over a phone's
 * date field and „Zapisz” for seconds of every visit, news only the first
 * time. */
const CLAIM_REFUSED_KEY = "koryta:declaration-claim-refused";

/** The same note where the browser will not keep it: once for as long as
 * the page is open. */
let claimRefusalTold = false;

/** Whether the reader is to be told why the claim was turned down: the first
 * time in this browser session, which this notes. So it is asked as the line
 * goes up, never before: a line that waited for a sign-in to leave the
 * screen and was never shown is said on a later visit. Never on the server,
 * where a module's note would be every request's. */
export function firstClaimRefusal(): boolean {
  if (import.meta.server) return false;
  let told = claimRefusalTold;
  try {
    told ||= window.sessionStorage.getItem(CLAIM_REFUSED_KEY) !== null;
  } catch {
    // Storage refused: the note in memory is all there is.
  }
  if (told) return false;
  try {
    window.sessionStorage.setItem(CLAIM_REFUSED_KEY, "1");
  } catch {
    claimRefusalTold = true;
  }
  return true;
}

/** How many crops /oswiadczenia asks for at a time: the one to read and two
 * behind it, so the next is drawn the moment an answer is given. */
const BATCH = 3;

/** A crop waiting on the page, with what the reader had typed into it if a
 * save of it failed and it came back. */
export type QueuedTask = {
  task: DeclarationTask;
  draft: { date: string; name: string } | null;
};

/** The crop answered last, for the line that links its whole declaration. */
export type AnsweredCrop = {
  id: string;
  documentUrl: string;
  host: string | null;
  verdict: AnswerVerdict;
  value: string | null;
  settled: boolean;
};

/**
 * The reading queue of /oswiadczenia: what is on screen, what is behind it,
 * and the answers on their way to the server.
 *
 * An answer moves the reader on at once and is saved behind their back, the
 * way the note triage (admin/notatki/kategoryzacja.vue) does it: one crop is a
 * few seconds of work, and a round trip per crop would be most of them. A save
 * that fails puts the crop back at the front with what was typed into it, and
 * says so: in the server's words where it turned the answer down (a limit of
 * the day, an address to confirm), as the page's own line where it did not
 * answer or would only have spoken of a token. A crop the server says is gone
 * is left out instead, with a line of the page's that says an answer was not
 * kept (`GONE_LINE`).
 *
 * Every answer comes back with the server's own next crops, which is what
 * keeps the queue full; it is fetched on its own only when an answer did not
 * refill it. Responses can overtake each other, so the counts are taken from
 * the newest request only, and a crop answered in this sitting is never taken
 * back from a response that left before the server saw the answer.
 */
export function useDeclarationQueue() {
  const queue = ref<QueuedTask[]>([]);
  /** Crops still waiting for a reader, and this reader's own count. */
  const open = ref<number | null>(null);
  const mine = ref<DeclarationQueue["mine"] | null>(null);
  const loadState = ref<"idle" | "loading" | "ready" | "error">("idle");
  /** Why the queue could not load (`loadState` "error"), when the server
   * said: the day's room for readers without a vote is used up, say. */
  const refusal = ref<Refusal | null>(null);
  const refilling = ref(false);
  /** The server had nothing more to give the last time it was asked. */
  const exhausted = ref(false);
  const inFlight = ref(0);
  const answered = ref<AnsweredCrop | null>(null);
  /** Answers given in this sitting, kept or not. */
  const given = ref(0);
  const failure = ref("");

  const answeredHere = new Set<string>();
  let sent = 0;
  let applied = 0;
  /** The request whose crop the „answered” line is about: the line belongs
   * to the latest answer, not to whichever save came back last. */
  let shown = 0;
  /** Set by a refusal: the request after it takes a fresh token, where what
   * the refusal asked for, a confirmed address, shows (`refreshToken`). */
  let afterRefusal = false;
  /** How many times the queue started over (`reset`). A fetch for crops that
   * left before the latest start was made for the reader who was here then,
   * a stranger before they signed in, and its crops, or its refusal, are not
   * the account's: it lands on nothing. */
  let generation = 0;

  function request<T>(url: string, options: RequestOptions) {
    const fresh = afterRefusal;
    afterRefusal = false;
    return readerRequest<T>(url, options, fresh);
  }

  /** The server's reason for a failure, if it gave one, noted for the next
   * request's token. */
  function refusedBy(err: unknown): Refusal | null {
    const reason = refusalOf(err);
    if (reason) afterRefusal = true;
    return reason;
  }

  /** Takes a response's counts if no newer one has landed, and its crops
   * that are neither on the page already nor answered here. */
  function absorb(result: DeclarationQueue, seq: number): number {
    if (seq > applied) {
      applied = seq;
      open.value = result.open;
      mine.value = result.mine;
    }
    const incoming = [result.task, ...result.upcoming].filter(
      (task): task is DeclarationTask => !!task,
    );
    const onPage = new Set(queue.value.map((entry) => entry.task.id));
    const fresh = incoming.filter(
      (task) => !onPage.has(task.id) && !answeredHere.has(task.id),
    );
    if (fresh.length > 0) {
      queue.value = [
        ...queue.value,
        ...fresh.map((task) => ({ task, draft: null })),
      ];
    }
    exhausted.value = incoming.length === 0;
    return fresh.length;
  }

  function fetchNext() {
    return request<DeclarationQueue>("/api/declarations/next", {
      method: "GET",
      query: { count: BATCH },
      timeout: 20_000,
    });
  }

  async function start() {
    const asked = generation;
    loadState.value = "loading";
    refusal.value = null;
    try {
      const seq = ++sent;
      const result = await fetchNext();
      if (asked !== generation) return;
      absorb(result, seq);
      loadState.value = "ready";
    } catch (err) {
      if (asked !== generation) return;
      console.error("Failed to load declaration crops", err);
      refusal.value = refusedBy(err);
      loadState.value = "error";
    }
  }

  async function refill() {
    const asked = generation;
    refilling.value = true;
    try {
      const seq = ++sent;
      const result = await fetchNext();
      if (asked !== generation) return;
      // A refill that brings nothing new ends the run for now, even when the
      // server still lists crops this reader has just answered: it has not
      // caught up with them, and asking again at once would only loop.
      if (absorb(result, seq) === 0) exhausted.value = true;
    } catch (err) {
      if (asked !== generation) return;
      console.error("Failed to refill the declaration queue", err);
      const reason = refusedBy(err);
      if (queue.value.length === 0) {
        refusal.value = reason;
        loadState.value = "error";
      }
    } finally {
      // A refill of the account's own may be on its way by now.
      if (asked === generation) refilling.value = false;
    }
  }

  async function answer(task: DeclarationTask, body: DeclarationAnswer) {
    if (!queue.value.some((entry) => entry.task.id === task.id)) return;
    queue.value = queue.value.filter((entry) => entry.task.id !== task.id);
    answeredHere.add(task.id);
    given.value += 1;
    inFlight.value += 1;
    const seq = ++sent;
    const asked = generation;
    try {
      const result = await request<DeclarationAnswerResult>(
        `/api/declarations/${encodeURIComponent(task.id)}/answer`,
        { method: "POST", body, timeout: 20_000 },
      );
      if (asked !== generation) return;
      absorb(result, seq);
      if (seq > shown) {
        shown = seq;
        answered.value = {
          ...result.answered,
          verdict: body.verdict,
          value: body.value ?? null,
          settled: result.settled,
        };
      }
    } catch (err) {
      console.error("Failed to save the declaration reading", err);
      const stale = asked !== generation;
      const reason = stale ? refusalOf(err) : refusedBy(err);
      if (reason?.status === 404) {
        if (stale) return;
        // Gone since it was handed out: withdrawn, or its declaration
        // failed. Nothing can be saved for it, a skip included, so it does
        // not come back to stand first for good. The reader is on the next
        // crop by now, which the server's words would seem to be about.
        failure.value = GONE_LINE;
        return;
      }
      answeredHere.delete(task.id);
      queue.value = [
        {
          task,
          draft: {
            date: body.verdict === "date" ? typedFromValue(body.value) : "",
            name: body.name ?? "",
          },
        },
        ...queue.value.filter((entry) => entry.task.id !== task.id),
      ];
      if (stale) return;
      // Back first with what was typed, to send again: once signed in or
      // with the address confirmed, as the server's reason asks, or once
      // the connection is back. Where the server gave a reason, that says
      // why; the line about the crop coming back is for when it did not.
      failure.value =
        reason?.message ??
        "Nie udało się zapisać odpowiedzi. Wycinek wrócił na początek kolejki.";
    } finally {
      inFlight.value -= 1;
    }
  }

  // Low means one crop left with nothing on its way that could bring more.
  watch([() => queue.value.length, inFlight], ([length, flying]) => {
    if (
      loadState.value === "ready" &&
      length <= 1 &&
      flying === 0 &&
      !exhausted.value &&
      !refilling.value
    ) {
      void refill();
    }
  });

  /** Keeps what the reader typed into the first crop and has not sent, for a
   * sign-in about to start the queue over: `reset` keeps a crop with a draft,
   * so the date typed before „Zaloguj się” is still there after it. */
  function keepTyped(typed: { date: string; name: string }) {
    const [head, ...rest] = queue.value;
    if (!head || head.draft) return;
    if (!typed.date.trim() && !typed.name.trim()) return;
    queue.value = [{ ...head, draft: typed }, ...rest];
  }

  /** Starts over, for a reader who just signed in: the server's queue and
   * counts are the account's now, not this browser's, and a fetch for crops
   * still on its way from before lands on nothing (`generation`). A crop
   * whose answer came back stays first, with what was typed into it: turned
   * down for want of an account, it is the account's to send now. The failure
   * line goes: its reason, „Zaloguj się albo załóż konto” say, was the
   * stranger's. The claim, asked after this, says its own if it has one. */
  function reset() {
    generation += 1;
    queue.value = queue.value.filter((entry) => entry.draft !== null);
    open.value = null;
    mine.value = null;
    exhausted.value = false;
    refilling.value = false;
    answered.value = null;
    answeredHere.clear();
    refusal.value = null;
    failure.value = "";
    // The account's token is fresh from its sign-in.
    afterRefusal = false;
    loadState.value = "idle";
  }

  return {
    queue,
    open,
    mine,
    loadState,
    refusal,
    refilling,
    exhausted,
    inFlight,
    answered,
    given,
    failure,
    start,
    answer,
    reset,
    keepTyped,
  };
}
