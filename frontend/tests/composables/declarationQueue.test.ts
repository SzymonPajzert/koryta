import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import { getQuery, readBody } from "h3";
import {
  claimStoredReadings,
  refusalOf,
  useDeclarationQueue,
} from "../../app/composables/declarationQueue";
import type {
  DeclarationAnswerResult,
  DeclarationQueue,
  DeclarationTask,
} from "../../shared/declarations";
import {
  failedWith,
  noAnswer,
  PAGE_SAYS,
  refuse,
  REFUSED,
  type Refusing,
} from "../serverRefusals";

const { mockAuthRequest } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
}));
vi.mock("../../app/composables/auth", () => ({
  authRequest: mockAuthRequest,
}));

/** Who is reading: nobody unless a test signs somebody in. Read at the moment
 * a request goes out, so a plain holder is enough. `getIdToken(true)` is
 * Firebase being asked for a fresh token. */
const reader = vi.hoisted(() => ({
  value: null as {
    uid: string;
    emailVerified?: boolean;
    getIdToken?: (forceRefresh?: boolean) => Promise<string>;
  } | null,
}));
vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  useCurrentUser: () => reader,
}));

/** Where the browser keeps the id of its readings without an account. */
const READER_KEY = "koryta:declaration-reader";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const crop = (id: string): DeclarationTask => ({
  id,
  unit: "Testowice (gmina miejsko-wiejska)",
  office: "Rada gminy",
  declarationYear: 2019,
  documentUrl: `https://bip.gmina-testowa.example/oswiadczenie-${id}.pdf`,
  host: "bip.gmina-testowa.example",
  images: { date: `data:image/png;base64,${id}`, name: null },
  imageSize: { date: { width: 950, height: 105 }, name: null },
});

/** The server's queue: the first id to read now, the rest behind it. */
const served = (
  ids: string[],
  over: Partial<DeclarationQueue> = {},
): DeclarationQueue => ({
  task: ids[0] ? crop(ids[0]) : null,
  upcoming: ids.slice(1).map(crop),
  open: 40,
  mine: { today: 0, total: 0 },
  ...over,
});

const answeredA1 = (
  over: Partial<DeclarationAnswerResult> = {},
): DeclarationAnswerResult => ({
  ...served(["a2", "a3"], { mine: { today: 1, total: 1 } }),
  settled: false,
  answered: { id: "a1" },
  ...over,
});

/** What the server answers once it has an answer to `id`: the crops it would
 * hand out next and the counts after it. */
const saved = (
  id: string,
  next: string[],
  over: Partial<DeclarationQueue> = {},
): DeclarationAnswerResult => ({
  ...served(next, over),
  settled: false,
  answered: { id },
});

/** A response the test lets land when it chooses, so that two can land in
 * the other order from the one they left in. */
function later<T>() {
  let land!: (value: T) => void;
  const response = new Promise<T>((resolve) => {
    land = resolve;
  });
  return { response, land };
}

const {
  noAccount: NO_ACCOUNT,
  notConfirmed: NOT_CONFIRMED,
  dailyLimit: DAILY_LIMIT,
  gone: GONE,
  claimNotConfirmed: CLAIM_NOT_CONFIRMED,
  badToken: BAD_TOKEN,
  noReader: NO_READER,
} = REFUSED;

/** The page's own line, for a failed answer the server gave no reason for. */
const ANSWER_FAILED =
  "Nie udało się zapisać odpowiedzi. Wycinek wrócił na początek kolejki.";

const { gone: GONE_LINE, signedOut: SIGNED_OUT } = PAGE_SAYS;

/** What a reader's request is sent again after, once, if it is a GET:
 * ofetch's own list without 429, which a limit would only answer again. */
const RETRY_STATUS_CODES = [408, 409, 425, 500, 502, 503, 504];

/** How the endpoints below turn a request down, by path, if a test says so:
 * every request until the test takes it back, as a day's limit holds, so a
 * request sent again would be seen, and turned down, again. A signed-in
 * reader's requests go through `authRequest`, mocked here, which a test makes
 * fail with `failedWith`. */
const refusing = new Map<string, Refusing>();

const refusalFor = (path: string) => refusing.get(path);

/** What reached the server without a token: the requests a reader who is not
 * signed in sends with plain `$fetch`. Served rather than stubbed, so the
 * method and the headers are the ones that went out. The next crops are
 * served whatever the method, so that a POST would be seen here as one. */
type Seen = {
  method: string;
  query: Record<string, unknown>;
  body?: unknown;
  readerId: string | null;
  authorization: string | null;
};
let seen: Seen[] = [];

/** Set while a test holds the asks for crops at the server, so that one is
 * still on its way when something overtakes it. */
let asksHeld: Promise<void> | null = null;

/** Holds every ask for crops once it has been seen, until the returned
 * function lets them through. */
function holdAsksForCrops() {
  let letThrough!: () => void;
  asksHeld = new Promise((resolve) => {
    letThrough = resolve;
  });
  return () => {
    asksHeld = null;
    letThrough();
  };
}

registerEndpoint("/api/declarations/next", async (event) => {
  seen.push({
    method: event.method,
    query: getQuery(event),
    readerId: event.headers.get("x-reader-id"),
    authorization: event.headers.get("authorization"),
  });
  if (asksHeld) await asksHeld;
  const refusal = refusalFor("/api/declarations/next");
  if (refusal) return refuse(event, refusal);
  return served(["a1", "a2", "a3"]);
});
registerEndpoint("/api/declarations/a1/answer", {
  method: "POST",
  handler: async (event) => {
    seen.push({
      method: event.method,
      query: getQuery(event),
      body: await readBody(event),
      readerId: event.headers.get("x-reader-id"),
      authorization: event.headers.get("authorization"),
    });
    const refusal = refusalFor("/api/declarations/a1/answer");
    if (refusal) return refuse(event, refusal);
    return answeredA1();
  },
});

const ids = (queue: { task: DeclarationTask }[]) =>
  queue.map((entry) => entry.task.id);

/** How many times the queue was asked for crops of its own, rather than
 * given them with an answer. */
const askedForMore = () =>
  mockAuthRequest.mock.calls.filter(([url]) => url === "/api/declarations/next")
    .length;

/** A signed-in reader's queue, started with the crops the server lists. */
async function signedInReading(crops: string[]) {
  reader.value = { uid: "me" };
  mockAuthRequest.mockResolvedValueOnce(served(crops));
  const reading = useDeclarationQueue();
  await reading.start();
  return reading;
}

/** Failures the server gave a reader no reason for, for which the page keeps
 * its own lines. */
const UNEXPLAINED: [string, () => Promise<unknown>][] = [
  ["a 500, whatever it says", () => failedWith(500, "DEADLINE_EXCEEDED")],
  ["a 503 without words", () => failedWith(503)],
  [
    "a 400 worded by the validator",
    () => failedWith(400, '[{"code": "too_big", "path": ["name"]}]'),
  ],
  ["a refusal without words", () => failedWith(429)],
  ["no answer at all", noAnswer],
];

beforeEach(() => {
  seen = [];
  asksHeld = null;
  refusing.clear();
  reader.value = null;
  mockAuthRequest.mockReset();
  window.localStorage.removeItem(READER_KEY);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The queue behind /oswiadczenia. Reading is open to readers without an
 * account: their requests carry this browser's
 * reader id instead of a token, and an account that signs in later claims
 * what they read. An answer moves the reader on at once and is saved behind
 * their back, so a save that fails has to put the crop back where they can
 * see it. */
describe("useDeclarationQueue", () => {
  it("asks without a token, under this browser's reader id, when nobody is signed in", async () => {
    const reading = useDeclarationQueue();
    await reading.start();

    expect(reading.loadState.value).toBe("ready");
    expect(ids(reading.queue.value)).toEqual(["a1", "a2", "a3"]);
    expect(seen).toHaveLength(1);
    const [next] = seen;
    // A GET, as the server routes it: a request sent without its method goes
    // out as a POST, which the stub above would answer all the same.
    expect(next!.method).toBe("GET");
    expect(next!.query).toEqual({ count: "3" });
    expect(next!.authorization).toBeNull();
    expect(next!.readerId).toMatch(UUID);
    // Made on first use and kept, so the next visit files under the same id.
    expect(window.localStorage.getItem(READER_KEY)).toBe(next!.readerId);

    // The answer goes out under the same id.
    await reading.answer(crop("a1"), { verdict: "date", value: "1979-07-15" });

    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({
      method: "POST",
      body: { verdict: "date", value: "1979-07-15" },
      readerId: next!.readerId,
      authorization: null,
    });
    expect(mockAuthRequest).not.toHaveBeenCalled();
    expect(reading.answered.value).toEqual({
      id: "a1",
      verdict: "date",
      value: "1979-07-15",
      settled: false,
    });
    expect(ids(reading.queue.value)).toEqual(["a2", "a3"]);
  });

  it("asks with the reader's token when they are signed in, and makes no reader id", async () => {
    reader.value = { uid: "me" };
    mockAuthRequest.mockResolvedValueOnce(served(["a1", "a2", "a3"]));

    const reading = useDeclarationQueue();
    await reading.start();

    expect(mockAuthRequest).toHaveBeenCalledExactlyOnceWith(
      "/api/declarations/next",
      {
        method: "GET",
        query: { count: 3 },
        timeout: 20_000,
        retryStatusCodes: RETRY_STATUS_CODES,
      },
    );
    expect(seen).toEqual([]);
    expect(window.localStorage.getItem(READER_KEY)).toBeNull();
    expect(ids(reading.queue.value)).toEqual(["a1", "a2", "a3"]);
  });

  it("puts a crop whose answer failed back first, with what was typed into it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reader.value = { uid: "me" };
    mockAuthRequest.mockResolvedValueOnce(served(["a1", "a2", "a3"]));
    const reading = useDeclarationQueue();
    await reading.start();

    let refuse!: (error: Error) => void;
    mockAuthRequest.mockReturnValueOnce(
      new Promise((_, reject) => {
        refuse = reject;
      }),
    );
    const saving = reading.answer(crop("a1"), {
      verdict: "date",
      value: "1979-07-15",
      name: "Jan Przykładowy",
    });

    // The reader is on the next crop before the server has answered.
    expect(ids(reading.queue.value)).toEqual(["a2", "a3"]);
    expect(reading.inFlight.value).toBe(1);
    expect(mockAuthRequest).toHaveBeenLastCalledWith(
      "/api/declarations/a1/answer",
      {
        method: "POST",
        body: {
          verdict: "date",
          value: "1979-07-15",
          name: "Jan Przykładowy",
        },
        timeout: 20_000,
        retryStatusCodes: RETRY_STATUS_CODES,
      },
    );

    refuse(new Error("503"));
    await saving;

    // In front of the crop they had moved on to, with the date the way they
    // typed it rather than the way it is stored.
    expect(reading.queue.value).toEqual([
      {
        task: crop("a1"),
        draft: { date: "15.07.1979", name: "Jan Przykładowy" },
      },
      { task: crop("a2"), draft: null },
      { task: crop("a3"), draft: null },
    ]);
    expect(reading.failure.value).toBe(
      "Nie udało się zapisać odpowiedzi. Wycinek wrócił na początek kolejki.",
    );
    expect(reading.answered.value).toBeNull();
    expect(reading.inFlight.value).toBe(0);
  });

  it("brings back an answer that was not a date with an empty date field", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reader.value = { uid: "me" };
    mockAuthRequest.mockResolvedValueOnce(served(["a1", "a2", "a3"]));
    const reading = useDeclarationQueue();
    await reading.start();

    mockAuthRequest.mockRejectedValueOnce(new Error("503"));
    await reading.answer(crop("a1"), { verdict: "unreadable", name: "Anna" });

    expect(reading.queue.value[0]).toEqual({
      task: crop("a1"),
      draft: { date: "", name: "Anna" },
    });
  });

  it("starts over on reset: no crops, no counts, no answered line", async () => {
    reader.value = { uid: "me" };
    mockAuthRequest.mockResolvedValueOnce(
      served(["a1", "a2", "a3"], { mine: { today: 2, total: 9 } }),
    );
    const reading = useDeclarationQueue();
    await reading.start();
    mockAuthRequest.mockResolvedValueOnce(answeredA1());
    await reading.answer(crop("a1"), { verdict: "skip" });
    expect(reading.answered.value).not.toBeNull();

    reading.reset();

    expect(reading.queue.value).toEqual([]);
    expect(reading.open.value).toBeNull();
    expect(reading.mine.value).toBeNull();
    expect(reading.answered.value).toBeNull();
    expect(reading.exhausted.value).toBe(false);
    expect(reading.loadState.value).toBe("idle");

    // The account's queue now: a crop this browser answered before the reset
    // is the server's to hand out again or not.
    mockAuthRequest.mockResolvedValueOnce(served(["a1", "a2", "a3"]));
    await reading.start();
    expect(ids(reading.queue.value)).toEqual(["a1", "a2", "a3"]);
  });

  // Saves overtake each other: the second answer's can land before the
  // first's, which then brings counts the server had before the second.
  it("takes the counts from the newest request only, whichever lands last", async () => {
    const reading = await signedInReading(["a1", "a2", "a3"]);
    const first = later<DeclarationAnswerResult>();
    const second = later<DeclarationAnswerResult>();
    mockAuthRequest
      .mockReturnValueOnce(first.response)
      .mockReturnValueOnce(second.response);

    const savingA1 = reading.answer(crop("a1"), {
      verdict: "date",
      value: "1979-07-15",
    });
    const savingA2 = reading.answer(crop("a2"), {
      verdict: "date",
      value: "1971-09-03",
    });
    second.land(
      saved("a2", ["a3", "a4", "a5"], {
        open: 38,
        mine: { today: 2, total: 2 },
      }),
    );
    await savingA2;
    first.land(
      saved("a1", ["a3", "a4", "a5"], {
        open: 39,
        mine: { today: 1, total: 1 },
      }),
    );
    await savingA1;

    expect(reading.open.value).toBe(38);
    expect(reading.mine.value).toEqual({ today: 2, total: 2 });
    // The line under the crop is about the answer given last, too.
    expect(reading.answered.value?.id).toBe("a2");
    expect(ids(reading.queue.value)).toEqual(["a3", "a4", "a5"]);
  });

  it("never takes back a crop answered here from a response that left before the server saw the answer", async () => {
    const reading = await signedInReading(["a1", "a2", "a3"]);
    const first = later<DeclarationAnswerResult>();
    const second = later<DeclarationAnswerResult>();
    mockAuthRequest
      .mockReturnValueOnce(first.response)
      .mockReturnValueOnce(second.response);

    const savingA1 = reading.answer(crop("a1"), { verdict: "skip" });
    const savingA2 = reading.answer(crop("a2"), { verdict: "skip" });
    // Served while a2's answer was still on its way, so it lists a2.
    first.land(saved("a1", ["a2", "a3", "a4"]));
    await savingA1;

    expect(ids(reading.queue.value)).toEqual(["a3", "a4"]);

    second.land(saved("a2", ["a3", "a4", "a5"]));
    await savingA2;

    expect(ids(reading.queue.value)).toEqual(["a3", "a4", "a5"]);
  });

  it("asks for more once one crop is left and no answer is on its way", async () => {
    const reading = await signedInReading(["a1", "a2"]);
    const saving = later<DeclarationAnswerResult>();
    mockAuthRequest.mockReturnValueOnce(saving.response);

    const answering = reading.answer(crop("a1"), { verdict: "skip" });
    await flushPromises();

    // One crop left, but the answer on its way comes back with crops of its
    // own: asking now could only fetch the same ones twice.
    expect(ids(reading.queue.value)).toEqual(["a2"]);
    expect(askedForMore()).toBe(1);

    // It brings nothing new, so the queue asks.
    mockAuthRequest.mockResolvedValueOnce(served(["a2", "a3", "a4"]));
    saving.land(saved("a1", ["a2"]));
    await answering;
    await flushPromises();

    expect(askedForMore()).toBe(2);
    expect(mockAuthRequest).toHaveBeenLastCalledWith("/api/declarations/next", {
      method: "GET",
      query: { count: 3 },
      timeout: 20_000,
      retryStatusCodes: RETRY_STATUS_CODES,
    });
    expect(ids(reading.queue.value)).toEqual(["a2", "a3", "a4"]);
    expect(reading.refilling.value).toBe(false);
    expect(reading.exhausted.value).toBe(false);
  });

  it("is exhausted after a refill that brings nothing new, and asks no more", async () => {
    const reading = await signedInReading(["a1", "a2"]);
    // The refill lists only what is here already: a2, on the page, and a1,
    // answered a moment ago, which the server has not caught up with.
    mockAuthRequest
      .mockResolvedValueOnce(saved("a1", ["a2"]))
      .mockResolvedValueOnce(served(["a1", "a2"]));

    await reading.answer(crop("a1"), { verdict: "skip" });
    await flushPromises();

    expect(askedForMore()).toBe(2);
    expect(reading.exhausted.value).toBe(true);
    expect(ids(reading.queue.value)).toEqual(["a2"]);

    // The last crop answered: the queue is empty and does not ask again.
    mockAuthRequest.mockResolvedValueOnce(saved("a2", []));
    await reading.answer(crop("a2"), { verdict: "skip" });
    await flushPromises();

    expect(askedForMore()).toBe(2);
    expect(reading.queue.value).toEqual([]);
    expect(reading.exhausted.value).toBe(true);
  });

  // Enter pressed twice before the next crop is drawn answers the same crop
  // twice; the first answer has already taken it off the queue.
  it("ignores an answer to a crop that is no longer in the queue", async () => {
    const reading = await signedInReading(["a1", "a2", "a3"]);
    mockAuthRequest.mockResolvedValueOnce(answeredA1());
    const body = { verdict: "date", value: "1979-07-15" } as const;

    await Promise.all([
      reading.answer(crop("a1"), body),
      reading.answer(crop("a1"), body),
    ]);

    expect(
      mockAuthRequest.mock.calls.filter(
        ([url]) => url === "/api/declarations/a1/answer",
      ),
    ).toHaveLength(1);
    expect(reading.given.value).toBe(1);
    expect(reading.inFlight.value).toBe(0);
    expect(ids(reading.queue.value)).toEqual(["a2", "a3"]);
  });
});

/** What the server says when it turns a reader down is written for them (a
 * limit of the day, an address to confirm, a crop that is gone), so the page
 * shows it in place of its own line, and a reader stopped by a limit is told
 * why rather than to try again. */
describe("refusalOf", () => {
  it.each([
    [429, NO_ACCOUNT],
    [429, NOT_CONFIRMED],
    [429, DAILY_LIMIT],
    [403, CLAIM_NOT_CONFIRMED],
    [404, GONE],
  ])(
    "reads the server's words off the error a %i fails with",
    async (status, message) => {
      const error = await failedWith(status, message);
      // What reaches the page: the words are in the JSON only; the status
      // text a 429 comes with is Nitro's „Server Error”.
      expect(error).toMatchObject({
        statusCode: status,
        statusMessage: "Server Error",
        data: { statusCode: status, statusMessage: "Server Error", message },
      });

      expect(refusalOf(error)).toEqual({ status, message });
    },
  );

  // The server's words for it are a programmer's: a „token” means nothing
  // to a reader whose sign-in lapsed.
  it.each([
    ["a token it will not take", BAD_TOKEN],
    ["neither a token nor a reader id", NO_READER],
    ["no words at all", undefined],
  ])("says a 401 for %s in the page's own words", async (_, message) => {
    expect(refusalOf(await failedWith(401, message))).toEqual({
      status: 401,
      message: SIGNED_OUT,
    });
  });

  it.each(UNEXPLAINED)("has nothing for %s", async (_, failure) => {
    expect(refusalOf(await failure())).toBeNull();
  });
});

describe("useDeclarationQueue, turned down by the server", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("says why it turned down an answer without an account, with the crop back first as it was typed", async () => {
    const reading = useDeclarationQueue();
    await reading.start();
    refusing.set("/api/declarations/a1/answer", {
      status: 429,
      message: NO_ACCOUNT,
    });

    await reading.answer(crop("a1"), {
      verdict: "date",
      value: "1979-07-15",
      name: "Jan Przykładowy",
    });

    expect(seen.at(-1)).toMatchObject({ method: "POST", authorization: null });
    expect(reading.failure.value).toBe(NO_ACCOUNT);
    // To send again once signed in, as the reason asks.
    expect(reading.queue.value).toEqual([
      {
        task: crop("a1"),
        draft: { date: "15.07.1979", name: "Jan Przykładowy" },
      },
      { task: crop("a2"), draft: null },
      { task: crop("a3"), draft: null },
    ]);
    // Nobody's answer to it was kept, so it is still read blind: no link.
    expect(reading.answered.value).toBeNull();
  });

  it.each([
    ["an account whose address nobody confirmed", NOT_CONFIRMED],
    ["a reader past their own limit for the day", DAILY_LIMIT],
  ])(
    "says why it turned down an answer from %s, with the crop back first",
    async (_, message) => {
      const reading = await signedInReading(["a1", "a2", "a3"]);
      mockAuthRequest.mockRejectedValueOnce(await failedWith(429, message));

      await reading.answer(crop("a1"), { verdict: "unreadable", name: "Anna" });

      expect(reading.failure.value).toBe(message);
      expect(reading.queue.value[0]).toEqual({
        task: crop("a1"),
        draft: { date: "", name: "Anna" },
      });
      expect(ids(reading.queue.value)).toEqual(["a1", "a2", "a3"]);
    },
  );

  // A token the server will not take: a sign-in that lapsed, or was ended
  // elsewhere. Its own words speak of the token.
  it("says in its own words that the sign-in lapsed when an answer is turned down for it, with the crop back first", async () => {
    const reading = await signedInReading(["a1", "a2", "a3"]);
    mockAuthRequest.mockRejectedValueOnce(await failedWith(401, BAD_TOKEN));

    await reading.answer(crop("a1"), { verdict: "date", value: "1979-07-15" });

    expect(reading.failure.value).toBe(SIGNED_OUT);
    expect(reading.queue.value[0]).toEqual({
      task: crop("a1"),
      draft: { date: "15.07.1979", name: "" },
    });
  });

  it.each(UNEXPLAINED)(
    "keeps its own line for an answer that failed with %s",
    async (_, failure) => {
      const reading = await signedInReading(["a1", "a2", "a3"]);
      mockAuthRequest.mockRejectedValueOnce(await failure());

      await reading.answer(crop("a1"), {
        verdict: "date",
        value: "1979-07-15",
      });

      expect(reading.failure.value).toBe(ANSWER_FAILED);
      expect(reading.queue.value[0]).toEqual({
        task: crop("a1"),
        draft: { date: "15.07.1979", name: "" },
      });
    },
  );

  // Withdrawn, or its declaration failed, since it was handed out: back
  // first, it would stand there for good, as every answer to it is turned
  // down the same way, a skip included.
  it("leaves out a crop the server says is gone, and says an answer was not kept", async () => {
    const reading = await signedInReading(["a1", "a2", "a3"]);
    mockAuthRequest.mockRejectedValueOnce(await failedWith(404, GONE));

    await reading.answer(crop("a1"), { verdict: "skip" });

    // Not the server's „Nie ma takiego wycinka.”: by now the reader is on
    // a2, which it would seem to be about.
    expect(reading.failure.value).toBe(GONE_LINE);
    expect(ids(reading.queue.value)).toEqual(["a2", "a3"]);

    // Nor does a response that still lists it bring it back.
    mockAuthRequest.mockResolvedValueOnce(saved("a2", ["a1", "a3", "a4"]));
    await reading.answer(crop("a2"), { verdict: "skip" });

    expect(ids(reading.queue.value)).toEqual(["a3", "a4"]);
  });

  // A reader quicker than the server answers the next crop before the first
  // one's refusal is back: the crop „before” the one on the card is then the
  // second, whose answer was kept.
  it("names no crop by its place when the one that is gone was answered before the last", async () => {
    const reading = await signedInReading(["a1", "a2", "a3", "a4"]);
    let goneBack!: (error: unknown) => void;
    mockAuthRequest.mockReturnValueOnce(
      new Promise((_, reject) => {
        goneBack = reject;
      }),
    );
    const savingA1 = reading.answer(crop("a1"), { verdict: "skip" });
    mockAuthRequest.mockResolvedValueOnce(saved("a2", ["a3", "a4"]));
    await reading.answer(crop("a2"), { verdict: "date", value: "1971-09-03" });

    goneBack(await failedWith(404, GONE));
    await savingA1;

    expect(ids(reading.queue.value)).toEqual(["a3", "a4"]);
    expect(reading.answered.value?.id).toBe("a2");
    expect(reading.failure.value).toBe(GONE_LINE);
    expect(reading.failure.value).not.toMatch(/poprzedni/i);
  });

  it("keeps the server's reason when it will hand out no crops, until it does", async () => {
    refusing.set("/api/declarations/next", {
      status: 429,
      message: NO_ACCOUNT,
    });
    const reading = useDeclarationQueue();

    await reading.start();

    expect(reading.loadState.value).toBe("error");
    expect(reading.refusal.value).toEqual({ status: 429, message: NO_ACCOUNT });
    expect(reading.queue.value).toEqual([]);
    // Asked once: each ask without a vote takes from the day's room for asks.
    expect(seen).toHaveLength(1);

    refusing.delete("/api/declarations/next");
    await reading.start();

    expect(reading.loadState.value).toBe("ready");
    expect(reading.refusal.value).toBeNull();
    expect(seen).toHaveLength(2);
  });

  // What ofetch does by itself is ask a GET again after a 429, which the
  // limit answers the same way, taking a second ask from the day's room. A
  // signed-in reader's requests get the same list (`RETRY_STATUS_CODES`
  // above), which `authRequest` hands on (tests/composables/auth.test.ts).
  it("never asks again by itself for crops a limit turned down", async () => {
    refusing.set("/api/declarations/next", {
      status: 429,
      message: NO_ACCOUNT,
    });
    // That it would be seen here: a plain GET, asked twice.
    await $fetch("/api/declarations/next", { query: { count: 3 } }).catch(
      () => null,
    );
    expect(seen).toHaveLength(2);
    seen = [];

    const reading = useDeclarationQueue();
    await reading.start();

    expect(reading.refusal.value).toEqual({ status: 429, message: NO_ACCOUNT });
    expect(seen).toHaveLength(1);
  });

  it.each(UNEXPLAINED)(
    "has no reason to give for a queue that failed to load with %s",
    async (_, failure) => {
      reader.value = { uid: "me" };
      mockAuthRequest.mockRejectedValueOnce(await failure());
      const reading = useDeclarationQueue();

      await reading.start();

      expect(reading.loadState.value).toBe("error");
      expect(reading.refusal.value).toBeNull();
    },
  );

  it("reads on when the server will hand out no more, and says why once the page has run out", async () => {
    const refused = await failedWith(429, NOT_CONFIRMED);
    reader.value = { uid: "me" };
    // One crop, so the queue asks for more at once: turned down.
    mockAuthRequest
      .mockResolvedValueOnce(served(["a1"]))
      .mockRejectedValueOnce(refused);
    const reading = useDeclarationQueue();
    await reading.start();
    await flushPromises();

    expect(askedForMore()).toBe(2);
    expect(reading.loadState.value).toBe("ready");
    expect(reading.refusal.value).toBeNull();

    // The answer brings back only the crop it answered, which the server has
    // not caught up with, so the queue asks again: turned down, and nothing
    // is left to read.
    mockAuthRequest
      .mockResolvedValueOnce(saved("a1", ["a1"]))
      .mockRejectedValueOnce(refused);
    await reading.answer(crop("a1"), { verdict: "skip" });
    await flushPromises();

    expect(askedForMore()).toBe(3);
    expect(reading.loadState.value).toBe("error");
    expect(reading.refusal.value).toEqual({
      status: 429,
      message: NOT_CONFIRMED,
    });
  });

  // The server reads whether the address is confirmed off the token, which
  // says what was true when it was issued, up to an hour ago.
  it("asks Firebase for a fresh token for the request after a refusal, and only that one", async () => {
    const getIdToken = vi.fn(async (_force?: boolean) => "token");
    reader.value = { uid: "me", getIdToken };
    mockAuthRequest.mockResolvedValueOnce(served(["a1", "a2", "a3"]));
    const reading = useDeclarationQueue();
    await reading.start();
    mockAuthRequest.mockRejectedValueOnce(await failedWith(429, NOT_CONFIRMED));
    await reading.answer(crop("a1"), { verdict: "date", value: "1979-07-15" });

    expect(getIdToken).not.toHaveBeenCalled();

    // Confirmed since, and sent again.
    mockAuthRequest.mockResolvedValueOnce(answeredA1());
    await reading.answer(crop("a1"), { verdict: "date", value: "1979-07-15" });

    expect(getIdToken).toHaveBeenCalledExactlyOnceWith(true);
    expect(getIdToken.mock.invocationCallOrder[0]).toBeLessThan(
      mockAuthRequest.mock.invocationCallOrder.at(-1)!,
    );
    expect(ids(reading.queue.value)).toEqual(["a2", "a3"]);

    mockAuthRequest.mockResolvedValueOnce(saved("a2", ["a3", "a4"]));
    await reading.answer(crop("a2"), { verdict: "skip" });

    expect(getIdToken).toHaveBeenCalledTimes(1);
  });

  // On the last crop, the answer turned down brings it back alone and the
  // queue asks for more at once, on the fresh token that refusal set up.
  // That ask is turned down as well, and has to set up a fresh token in its
  // turn: the answer sent again once the address is confirmed would go on
  // the old token otherwise, and be turned down for nothing.
  it("asks for a fresh token again after a refill it was turned down for, for the answer sent next", async () => {
    const getIdToken = vi.fn(async (_force?: boolean) => "token");
    reader.value = { uid: "me", getIdToken };
    const refused = await failedWith(429, NOT_CONFIRMED);
    // One crop, so the queue asks for more at once: that ask fails for no
    // reason it was given, which leaves the token as it is.
    mockAuthRequest
      .mockResolvedValueOnce(served(["a1"]))
      .mockRejectedValueOnce(await failedWith(503));
    const reading = useDeclarationQueue();
    await reading.start();
    await flushPromises();

    expect(askedForMore()).toBe(2);

    mockAuthRequest
      .mockRejectedValueOnce(refused)
      .mockRejectedValueOnce(refused);
    await reading.answer(crop("a1"), { verdict: "date", value: "1979-07-15" });
    await flushPromises();

    // The answer, then the ask for more, both turned down; the crop is back.
    expect(askedForMore()).toBe(3);
    expect(ids(reading.queue.value)).toEqual(["a1"]);
    expect(getIdToken).toHaveBeenCalledExactlyOnceWith(true);

    // Confirmed since, and sent again.
    mockAuthRequest.mockResolvedValueOnce(saved("a1", ["a2", "a3"]));
    await reading.answer(crop("a1"), { verdict: "date", value: "1979-07-15" });

    expect(getIdToken.mock.calls).toEqual([[true], [true]]);
    // Requests: the queue, the ask that failed, the answer turned down, the
    // ask turned down, the answer sent again. A fresh token just before each
    // of the last two.
    const sent = mockAuthRequest.mock.invocationCallOrder;
    const [forRefill, forResend] = getIdToken.mock.invocationCallOrder;
    expect(sent).toHaveLength(5);
    expect(forRefill).toBeGreaterThan(sent[2]!);
    expect(forRefill).toBeLessThan(sent[3]!);
    expect(forResend).toBeGreaterThan(sent[3]!);
    expect(forResend).toBeLessThan(sent[4]!);
    expect(ids(reading.queue.value)).toEqual(["a2", "a3"]);
  });

  // Signing in from the app bar keeps the page: the claim, then a reset.
  it("keeps a crop that came back with what was typed when it starts over for an account, first, and lets the stranger's reason go", async () => {
    const reading = useDeclarationQueue();
    await reading.start();
    refusing.set("/api/declarations/a1/answer", {
      status: 429,
      message: NO_ACCOUNT,
    });
    await reading.answer(crop("a1"), { verdict: "date", value: "1979-07-15" });
    expect(reading.failure.value).toBe(NO_ACCOUNT);

    reader.value = { uid: "me" };
    reading.reset();

    expect(reading.queue.value).toEqual([
      { task: crop("a1"), draft: { date: "15.07.1979", name: "" } },
    ]);
    // „Zaloguj się albo załóż konto” was said to the stranger: over the
    // account's queue it would ask a reader who has signed in to sign in.
    expect(reading.failure.value).toBe("");

    mockAuthRequest.mockResolvedValueOnce(served(["b1", "a1", "b2"]));
    await reading.start();

    expect(ids(reading.queue.value)).toEqual(["a1", "b1", "b2"]);
    expect(reading.queue.value[0]!.draft).toEqual({
      date: "15.07.1979",
      name: "",
    });
  });

  // A stranger who signs in while their ask for crops is still on its way:
  // the queue starts over as the account's, and whatever that ask brings
  // back, crops or a refusal, is the stranger's.
  it.each([
    ["its crops", undefined],
    ["its refusal", { status: 429, message: NO_ACCOUNT }],
  ])(
    "lands nothing of a stranger's ask for crops that a sign-in overtook: %s",
    async (_, refusal) => {
      if (refusal) refusing.set("/api/declarations/next", refusal);
      const letThrough = holdAsksForCrops();
      const reading = useDeclarationQueue();
      const asking = reading.start();
      await vi.waitFor(() => expect(seen).toHaveLength(1));

      reader.value = { uid: "me" };
      reading.reset();
      mockAuthRequest.mockResolvedValueOnce(served(["b1", "b2", "b3"]));
      await reading.start();

      letThrough();
      await asking;
      await flushPromises();

      expect(reading.loadState.value).toBe("ready");
      expect(reading.refusal.value).toBeNull();
      expect(ids(reading.queue.value)).toEqual(["b1", "b2", "b3"]);
    },
  );

  // The same for an ask for more, made when the stranger's queue ran low,
  // landing while the account's queue is still on its way.
  it.each([
    ["its crops", () => Promise.resolve(served(["a2", "a3"]))],
    [
      "its refusal",
      async () => Promise.reject(await failedWith(429, NOT_CONFIRMED)),
    ],
  ])(
    "lands nothing of an ask for more that a sign-in overtook: %s",
    async (_, outcome) => {
      reader.value = { uid: "me" };
      let land!: () => void;
      const askedForMoreBack = new Promise<void>((resolve) => {
        land = resolve;
      }).then(outcome);
      // One crop, so the queue asks for more at once.
      mockAuthRequest
        .mockResolvedValueOnce(served(["a1"]))
        .mockReturnValueOnce(askedForMoreBack);
      const reading = useDeclarationQueue();
      await reading.start();
      await flushPromises();
      expect(askedForMore()).toBe(2);
      expect(reading.refilling.value).toBe(true);

      reading.reset();
      const accountQueue = later<DeclarationQueue>();
      mockAuthRequest.mockReturnValueOnce(accountQueue.response);
      const starting = reading.start();
      expect(reading.refilling.value).toBe(false);

      land();
      await askedForMoreBack.catch(() => null);
      await flushPromises();
      accountQueue.land(served(["b1", "b2", "b3"]));
      await starting;

      expect(reading.loadState.value).toBe("ready");
      expect(reading.refusal.value).toBeNull();
      expect(ids(reading.queue.value)).toEqual(["b1", "b2", "b3"]);
    },
  );
});

describe("claimStoredReadings", () => {
  it("hands the stored reader id to the account and forgets it once the server has it", async () => {
    window.localStorage.setItem(READER_KEY, "reader-1");
    mockAuthRequest.mockResolvedValueOnce({ claimed: 4 });

    await expect(claimStoredReadings()).resolves.toBe(4);

    expect(mockAuthRequest).toHaveBeenCalledExactlyOnceWith(
      "/api/declarations/claim",
      { method: "POST", body: { readerId: "reader-1" }, timeout: 20_000 },
    );
    expect(window.localStorage.getItem(READER_KEY)).toBeNull();
  });

  it("keeps the id for another try when the claim fails", async () => {
    window.localStorage.setItem(READER_KEY, "reader-1");
    mockAuthRequest.mockRejectedValueOnce(new Error("503"));

    await expect(claimStoredReadings()).rejects.toThrow("503");

    expect(window.localStorage.getItem(READER_KEY)).toBe("reader-1");
  });

  // Moved now, the readings would never vote; they move once the address is
  // confirmed, on a later signed-in visit.
  it("keeps the id when the server turns the claim down for an address nobody confirmed, and lets it go once a later claim goes through", async () => {
    window.localStorage.setItem(READER_KEY, "reader-1");
    reader.value = { uid: "me", emailVerified: false };
    mockAuthRequest.mockRejectedValueOnce(
      await failedWith(403, CLAIM_NOT_CONFIRMED),
    );

    const refused = await claimStoredReadings().then(
      () => null,
      (err: unknown) => err,
    );

    expect(refusalOf(refused)).toEqual({
      status: 403,
      message: CLAIM_NOT_CONFIRMED,
    });
    expect(window.localStorage.getItem(READER_KEY)).toBe("reader-1");

    reader.value = {
      uid: "me",
      emailVerified: true,
      getIdToken: async () => "token",
    };
    mockAuthRequest.mockResolvedValueOnce({ claimed: 3 });

    await expect(claimStoredReadings()).resolves.toBe(3);

    expect(mockAuthRequest).toHaveBeenLastCalledWith(
      "/api/declarations/claim",
      { method: "POST", body: { readerId: "reader-1" }, timeout: 20_000 },
    );
    expect(window.localStorage.getItem(READER_KEY)).toBeNull();
  });

  // Firebase reloads the account with the page, so `emailVerified` is now;
  // the token is up to an hour old, and the server reads the token.
  it("claims on a fresh token for an account whose address is confirmed", async () => {
    window.localStorage.setItem(READER_KEY, "reader-1");
    const getIdToken = vi.fn(async (_force?: boolean) => "token");
    reader.value = { uid: "me", emailVerified: true, getIdToken };
    mockAuthRequest.mockResolvedValueOnce({ claimed: 3 });

    await claimStoredReadings();

    expect(getIdToken).toHaveBeenCalledExactlyOnceWith(true);
    expect(getIdToken.mock.invocationCallOrder[0]).toBeLessThan(
      mockAuthRequest.mock.invocationCallOrder[0]!,
    );
  });

  it("claims on the token there is for an account whose address is not confirmed: a fresh one would say the same", async () => {
    window.localStorage.setItem(READER_KEY, "reader-1");
    const getIdToken = vi.fn(async (_force?: boolean) => "token");
    reader.value = { uid: "me", emailVerified: false, getIdToken };
    mockAuthRequest.mockRejectedValueOnce(
      await failedWith(403, CLAIM_NOT_CONFIRMED),
    );

    await expect(claimStoredReadings()).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(getIdToken).not.toHaveBeenCalled();
  });

  it("asks nothing of a browser that never read without an account", async () => {
    await expect(claimStoredReadings()).resolves.toBe(0);

    expect(mockAuthRequest).not.toHaveBeenCalled();
  });
});

/** A private window can refuse storage outright: every call on localStorage
 * throws. Such a reader still reads, uncounted like any reader without an
 * account, under an id held in memory while the page is open - the server
 * answers a request with neither a token nor a reader id with a 401.
 *
 * Last in the file: the id lives in the module, as it does in the page, and
 * the claim at the end of the second test is what lets it go. */
describe("a browser that refuses storage", () => {
  const refuse = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  const refusing = {
    length: 0,
    key: refuse,
    clear: refuse,
    getItem: vi.fn(refuse),
    setItem: vi.fn(refuse),
    removeItem: refuse,
  } satisfies Storage;

  beforeEach(() => {
    vi.stubGlobal("localStorage", refusing);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("still reads, every request under one id the page holds in memory", async () => {
    const reading = useDeclarationQueue();
    await reading.start();
    await reading.answer(crop("a1"), { verdict: "date", value: "1979-07-15" });

    expect(reading.loadState.value).toBe("ready");
    expect(ids(reading.queue.value)).toEqual(["a2", "a3"]);
    expect(seen).toHaveLength(2);
    const [next, answer] = seen;
    expect(next!.authorization).toBeNull();
    expect(next!.readerId).toMatch(UUID);
    expect(answer!.authorization).toBeNull();
    expect(answer!.readerId).toBe(next!.readerId);
    // It was offered to the browser, which kept nothing.
    expect(refusing.setItem).toHaveBeenCalledWith(READER_KEY, next!.readerId);
  });

  // Signing in from the app bar keeps the page, and the page the id.
  it("hands that id to an account signed in before the page is left, once", async () => {
    const reading = useDeclarationQueue();
    await reading.start();
    const readerId = seen[0]!.readerId;
    expect(readerId).toMatch(UUID);

    reader.value = { uid: "me" };
    mockAuthRequest.mockResolvedValueOnce({ claimed: 1 });
    await expect(claimStoredReadings()).resolves.toBe(1);

    expect(mockAuthRequest).toHaveBeenCalledExactlyOnceWith(
      "/api/declarations/claim",
      { method: "POST", body: { readerId }, timeout: 20_000 },
    );
    // Claimed, so let go: there is nothing left to claim.
    await expect(claimStoredReadings()).resolves.toBe(0);
    expect(mockAuthRequest).toHaveBeenCalledTimes(1);
  });
});
