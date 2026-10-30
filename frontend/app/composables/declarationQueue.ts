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

/** A request on the reader's behalf: with their token when they are signed
 * in, with this browser's reader id when they are not. */
async function readerRequest<T>(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    query?: unknown;
    timeout?: number;
  },
): Promise<T> {
  const user = useCurrentUser();
  if (user.value) return authRequest<T>(url, options);
  const id = storedReaderId(true);
  return await $fetch<T>(url, {
    method: (options.method || "POST") as "POST",
    body: options.body as Record<string, unknown>,
    query: options.query as Record<string, unknown>,
    timeout: options.timeout,
    headers: id ? { "X-Reader-Id": id } : {},
  });
}

/** Moves this browser's readings without an account onto the account the
 * reader just signed in to, so what they read before counts as theirs. Kept
 * for another try when it fails; forgotten once the server has them. */
export async function claimStoredReadings(): Promise<number> {
  const readerId = storedReaderId();
  if (!readerId) return 0;
  const result = await authRequest<{ claimed: number }>(
    "/api/declarations/claim",
    { method: "POST", body: { readerId }, timeout: 20_000 },
  );
  forgetReaderId();
  return result.claimed;
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
 * says so.
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
  const mine = ref<{ today: number; total: number } | null>(null);
  const loadState = ref<"idle" | "loading" | "ready" | "error">("idle");
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
    return readerRequest<DeclarationQueue>("/api/declarations/next", {
      method: "GET",
      query: { count: BATCH },
      timeout: 20_000,
    });
  }

  async function start() {
    loadState.value = "loading";
    try {
      const seq = ++sent;
      absorb(await fetchNext(), seq);
      loadState.value = "ready";
    } catch (err) {
      console.error("Failed to load declaration crops", err);
      loadState.value = "error";
    }
  }

  async function refill() {
    refilling.value = true;
    try {
      const seq = ++sent;
      // A refill that brings nothing new ends the run for now, even when the
      // server still lists crops this reader has just answered: it has not
      // caught up with them, and asking again at once would only loop.
      if (absorb(await fetchNext(), seq) === 0) exhausted.value = true;
    } catch (err) {
      console.error("Failed to refill the declaration queue", err);
      if (queue.value.length === 0) loadState.value = "error";
    } finally {
      refilling.value = false;
    }
  }

  async function answer(task: DeclarationTask, body: DeclarationAnswer) {
    if (!queue.value.some((entry) => entry.task.id === task.id)) return;
    queue.value = queue.value.filter((entry) => entry.task.id !== task.id);
    answeredHere.add(task.id);
    given.value += 1;
    inFlight.value += 1;
    const seq = ++sent;
    try {
      const result = await readerRequest<DeclarationAnswerResult>(
        `/api/declarations/${encodeURIComponent(task.id)}/answer`,
        { method: "POST", body, timeout: 20_000 },
      );
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
      failure.value =
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

  /** Starts over, for a reader who just signed in: the server's queue and
   * counts are the account's now, not this browser's. */
  function reset() {
    queue.value = [];
    open.value = null;
    mine.value = null;
    exhausted.value = false;
    answered.value = null;
    answeredHere.clear();
    loadState.value = "idle";
  }

  return {
    queue,
    open,
    mine,
    loadState,
    refilling,
    exhausted,
    inFlight,
    answered,
    given,
    failure,
    start,
    answer,
    reset,
  };
}
