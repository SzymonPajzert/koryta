import { describe, it, expect, vi, beforeEach } from "vitest";
import { onNodeWritten } from "../../functions/src/nodes";
import { generateChunksLower } from "~~/shared/search";

vi.mock("firebase-functions/v2/firestore", () => ({
  // The handler itself, so a test can hand it an event.
  onDocumentWritten: (_options: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  error: vi.fn(),
}));

type Data = Record<string, unknown>;

/** A write of `nodes/n1` from `before` to `after`, and what the trigger
 * wrote back onto it. */
async function write(before: Data | null, after: Data) {
  const update = vi.fn();
  const snapshot = (data: Data | null) => ({
    exists: data !== null,
    data: () => data,
    ref: { update },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (onNodeWritten as any)({
    data: { before: snapshot(before), after: snapshot(after) },
    params: { nodeId: "n1" },
  });
  return update;
}

/** A person whose stats already agree with whether the page is public, so
 * only the search index is left for the trigger to have an opinion on. */
const person = (name: string, extra: Data = {}): Data => ({
  type: "person",
  name,
  published: true,
  stats: { isApproved: true },
  ...extra,
});

describe("onNodeWritten, the search index", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rewrites an index cut the old way on a write that keeps the name", async () => {
    // Every hyphenated page stored before the parts were indexed: 658 of
    // 2026-10-11. The trigger used to look only at a rename, so a vote or an
    // ingest update left the page unfindable by "kamysz".
    const name = "Władysław Kosiniak-Kamysz";
    const old = generateChunksLower(name).slice(0, -5);
    const before = person(name, { nameChunksLower: old });

    const update = await write(before, { ...before, votes: 1 });

    expect(update).toHaveBeenCalledWith({
      nameChunksLower: generateChunksLower(name),
    });
  });

  it("writes nothing over an index that is up to date", async () => {
    // Its own write comes back through here, so this is what ends it.
    const name = "Władysław Kosiniak-Kamysz";
    const stored = person(name, { nameChunksLower: generateChunksLower(name) });

    expect(await write(stored, stored)).not.toHaveBeenCalled();
  });

  it("rewrites the index of a page renamed to the hyphen", async () => {
    // What the person ingest does to "Anna Nowak Rudnik" (`learnsName`).
    const update = await write(
      person("Anna Nowak Rudnik", {
        nameChunksLower: generateChunksLower("Anna Nowak Rudnik"),
      }),
      person("Anna Nowak-Rudnik", {
        nameChunksLower: generateChunksLower("Anna Nowak Rudnik"),
      }),
    );

    expect(update).toHaveBeenCalledWith({
      nameChunksLower: generateChunksLower("Anna Nowak-Rudnik"),
    });
  });

  it("indexes a page written without one", async () => {
    const update = await write(null, person("Anna Nowak"));

    expect(update).toHaveBeenCalledWith({
      nameChunksLower: generateChunksLower("Anna Nowak"),
    });
  });

  it("leaves the kinds search does not read alone", async () => {
    const update = await write(null, {
      type: "article",
      name: "Kosiniak-Kamysz o budżecie",
      stats: { isApproved: false },
    });

    expect(update).not.toHaveBeenCalled();
  });
});
