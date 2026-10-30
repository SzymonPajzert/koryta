import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import { getQuery, readBody } from "h3";
import {
  claimStoredReadings,
  useDeclarationQueue,
} from "../../app/composables/declarationQueue";
import type {
  DeclarationAnswerResult,
  DeclarationQueue,
  DeclarationTask,
} from "../../shared/declarations";

const { mockAuthRequest } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
}));
vi.mock("../../app/composables/auth", () => ({
  authRequest: mockAuthRequest,
}));

/** Who is reading: nobody unless a test signs somebody in. Read at the moment
 * a request goes out, so a plain holder is enough. */
const reader = vi.hoisted(() => ({
  value: null as { uid: string } | null,
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
  answered: {
    id: "a1",
    documentUrl: "https://bip.gmina-testowa.example/oswiadczenie-a1.pdf",
    host: "bip.gmina-testowa.example",
  },
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
  answered: {
    id,
    documentUrl: `https://bip.gmina-testowa.example/oswiadczenie-${id}.pdf`,
    host: "bip.gmina-testowa.example",
  },
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

registerEndpoint("/api/declarations/next", (event) => {
  seen.push({
    method: event.method,
    query: getQuery(event),
    readerId: event.headers.get("x-reader-id"),
    authorization: event.headers.get("authorization"),
  });
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

beforeEach(() => {
  seen = [];
  reader.value = null;
  mockAuthRequest.mockReset();
  window.localStorage.removeItem(READER_KEY);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The queue behind /oswiadczenia. Reading is open to readers without an
 * account (Szymon, bip-czytanie-r1): their requests carry this browser's
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
      documentUrl: "https://bip.gmina-testowa.example/oswiadczenie-a1.pdf",
      host: "bip.gmina-testowa.example",
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
      { method: "GET", query: { count: 3 }, timeout: 20_000 },
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
