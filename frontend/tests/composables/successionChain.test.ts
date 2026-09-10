// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick } from "vue";
import type { SuccessionChainStep } from "../../server/api/edges/succession-chain.get";
import { useSuccessionChain } from "../../app/composables/successionChain";

/** The stubbed endpoint, and what it has been asked.
 *
 * Built inside `vi.hoisted` because `vi.mock` is lifted above every import in
 * the file: the factory below runs while the composable module is being
 * imported, which is before a plain `const` at the top of this file would have
 * been initialised at all.
 *
 * The request count is the whole promise of this composable - one per distinct
 * person, ever, so that a chain of N people costs N reads and collapsing a
 * branch and opening it again costs none. Nothing else here is worth asserting
 * as hard as `asked` is.
 */
const { asked, answers, authRequest } = vi.hoisted(() => {
  /** Every person the composable has asked about, in order. */
  const asked: string[] = [];
  /** What the endpoint answers, by person id. A person missing from here is a
   * request that rejects, which is how the error path is reached. */
  const answers = new Map<string, SuccessionChainStep>();
  const authRequest = vi.fn(
    async (_url: string, options: { query?: { personId?: string } } = {}) => {
      const personId = options.query?.personId ?? "";
      asked.push(personId);
      const answer = answers.get(personId);
      if (!answer) throw new Error(`no answer for ${personId}`);
      return answer;
    },
  );
  return { asked, answers, authRequest };
});

// Both aliases: the composable imports through `~`, and depending on which of
// the two roots vitest resolves first the other specifier would load the real
// module and send a request at a nitro server that is not running.
vi.mock("~/composables/auth", () => ({ authRequest }));
vi.mock("~~/app/composables/auth", () => ({ authRequest }));

function step(
  personId: string,
  fields: Partial<SuccessionChainStep> = {},
): SuccessionChainStep {
  return {
    personId,
    personName: `Osoba ${personId}`,
    parties: [],
    published: true,
    posts: [],
    predecessors: [],
    successors: [],
    hidden: 0,
    ...fields,
  };
}

/** A candidate as the endpoint hands one over. Only the fields the composable
 * reads are filled in; everything else on the card is item 3's business. */
function candidate(personId: string) {
  return {
    personId,
    personName: `Osoba ${personId}`,
    parties: [],
    published: true,
    via: [],
    closestGapDays: 0,
  };
}

/** Lets every pending `authRequest` settle and the computeds recompute.
 *
 * Two ticks rather than one: the request resolves on a microtask, and the
 * `computed` over `open`/`steps` is only read again after Vue has flushed.
 */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

describe("useSuccessionChain", () => {
  beforeEach(() => {
    asked.length = 0;
    // Emptied in place rather than reassigned: the mock factory closed over
    // this map before the first import, so a fresh one would never be read.
    answers.clear();
    authRequest.mockClear();
  });

  it("asks about the focus person once, and about nobody else", async () => {
    answers.set(
      "a",
      step("a", {
        predecessors: [candidate("b")],
        successors: [candidate("c")],
      }),
    );

    const chain = useSuccessionChain("a");
    await settle();

    expect(asked).toEqual(["a"]);
    expect(chain.loading.value).toBe(false);
    expect(chain.failed.value).toBe(false);
    expect(chain.nodes.value).toHaveLength(1);
    expect(chain.nodes.value[0]!.key).toBe("root");
    expect(chain.nodes.value[0]!.personName).toBe("Osoba a");
    // Both sides are drawn from the answer, and neither has been fetched: the
    // register-wide cost of an eager prefetch is thousands of documents per
    // page, so expansion is a click.
    expect(
      chain.nodes.value[0]!.predecessors.map((c) => c.candidate.personId),
    ).toEqual(["b"]);
    expect(
      chain.nodes.value[0]!.successors.map((c) => c.candidate.personId),
    ).toEqual(["c"]);
  });

  it("sends `latest` with every request, because most people are unpublished", async () => {
    answers.set("a", step("a"));

    useSuccessionChain("a");
    await settle();

    expect(authRequest).toHaveBeenCalledWith("/api/edges/succession-chain", {
      method: "GET",
      query: { personId: "a", latest: true },
    });
  });

  it("costs one request per distinct person, however many nodes reach them", async () => {
    answers.set(
      "a",
      step("a", {
        predecessors: [candidate("b")],
        successors: [candidate("b")],
      }),
    );
    answers.set("b", step("b"));

    const chain = useSuccessionChain("a");
    await settle();

    // The same human on both sides of the focus person: two nodes, one read.
    chain.expand({ nodeKey: "root", direction: "predecessor", personId: "b" });
    chain.expand({ nodeKey: "root", direction: "successor", personId: "b" });
    await settle();

    expect(asked).toEqual(["a", "b"]);
    expect(chain.nodes.value.map((n) => n.key)).toEqual([
      "root",
      "root>p:b",
      "root>s:b",
    ]);
    // Both nodes are filled from the one answer.
    expect(chain.nodes.value[1]!.personName).toBe("Osoba b");
    expect(chain.nodes.value[2]!.personName).toBe("Osoba b");
  });

  it("costs nothing to collapse a branch and open it again", async () => {
    answers.set("a", step("a", { predecessors: [candidate("b")] }));
    answers.set("b", step("b"));

    const chain = useSuccessionChain("a");
    await settle();

    chain.expand({ nodeKey: "root", direction: "predecessor", personId: "b" });
    await settle();
    chain.collapse("root>p:b");
    await settle();
    chain.expand({ nodeKey: "root", direction: "predecessor", personId: "b" });
    await settle();

    expect(asked).toEqual(["a", "b"]);
    expect(chain.nodes.value.map((n) => n.key)).toEqual(["root", "root>p:b"]);
  });

  it("drops everything under a node it collapses", async () => {
    answers.set("a", step("a", { predecessors: [candidate("b")] }));
    answers.set("b", step("b", { predecessors: [candidate("c")] }));
    answers.set("c", step("c"));

    const chain = useSuccessionChain("a");
    await settle();
    chain.expand({ nodeKey: "root", direction: "predecessor", personId: "b" });
    await settle();
    chain.expand({
      nodeKey: "root>p:b",
      direction: "predecessor",
      personId: "c",
    });
    await settle();

    expect(chain.nodes.value.map((n) => n.key)).toEqual([
      "root",
      "root>p:b",
      "root>p:b>p:c",
    ]);

    chain.collapse("root>p:b");
    await settle();

    expect(chain.nodes.value.map((n) => n.key)).toEqual(["root"]);
  });

  it("refuses to follow a seat back to somebody already in the chain", async () => {
    // The register does record seats coming back to the same person, and that
    // is worth printing - it is only following it that would loop for ever.
    answers.set("a", step("a", { predecessors: [candidate("b")] }));
    answers.set("b", step("b", { successors: [candidate("a")] }));

    const chain = useSuccessionChain("a");
    await settle();
    chain.expand({ nodeKey: "root", direction: "predecessor", personId: "b" });
    await settle();

    const b = chain.nodes.value.find((n) => n.key === "root>p:b")!;
    const backToA = b.successors.find((c) => c.candidate.personId === "a")!;
    expect(backToA.expandable).toBe(false);
    // Still on the card, still named.
    expect(backToA.candidate.personName).toBe("Osoba a");

    chain.expand({
      nodeKey: "root>p:b",
      direction: "successor",
      personId: "a",
    });
    await settle();

    expect(chain.nodes.value.map((n) => n.key)).toEqual(["root", "root>p:b"]);
    expect(asked).toEqual(["a", "b"]);
  });

  it("marks a candidate that has been opened, and closes it on a second click", async () => {
    answers.set("a", step("a", { predecessors: [candidate("b")] }));
    answers.set("b", step("b"));

    const chain = useSuccessionChain("a");
    await settle();
    chain.expand({ nodeKey: "root", direction: "predecessor", personId: "b" });
    await settle();

    expect(chain.nodes.value[0]!.predecessors[0]!.expandedKey).toBe("root>p:b");

    chain.expand({ nodeKey: "root", direction: "predecessor", personId: "b" });
    await settle();

    expect(chain.nodes.value[0]!.predecessors[0]!.expandedKey).toBeNull();
    expect(chain.nodes.value.map((n) => n.key)).toEqual(["root"]);
  });

  it("keeps parents before children when two branches are open at once", async () => {
    // The order is the one both layouts draw in, and a tree that meets a child
    // before its parent has nowhere to put it. The trap is a second branch off
    // the focus person landing under the first branch's grandchildren.
    answers.set(
      "a",
      step("a", {
        predecessors: [candidate("b")],
        successors: [candidate("d")],
      }),
    );
    answers.set("b", step("b", { predecessors: [candidate("c")] }));
    answers.set("c", step("c"));
    answers.set("d", step("d"));

    const chain = useSuccessionChain("a");
    await settle();
    chain.expand({ nodeKey: "root", direction: "predecessor", personId: "b" });
    await settle();
    chain.expand({
      nodeKey: "root>p:b",
      direction: "predecessor",
      personId: "c",
    });
    await settle();
    chain.expand({ nodeKey: "root", direction: "successor", personId: "d" });
    await settle();

    expect(chain.nodes.value.map((n) => n.key)).toEqual([
      "root",
      "root>p:b",
      "root>p:b>p:c",
      "root>s:d",
    ]);
    expect(chain.nodes.value.map((n) => n.depth)).toEqual([0, 1, 2, 1]);

    // Every node comes after its own parent, which is the property the
    // layouts actually depend on.
    const seen = new Set<string>();
    for (const node of chain.nodes.value) {
      if (node.parentKey) expect(seen.has(node.parentKey)).toBe(true);
      seen.add(node.key);
    }
  });

  it("leaves one failed person as an error and the rest of the chain usable", async () => {
    answers.set(
      "a",
      step("a", {
        predecessors: [candidate("b")],
        successors: [candidate("d")],
      }),
    );
    answers.set("d", step("d"));
    // `b` deliberately has no answer, so its request rejects.

    const chain = useSuccessionChain("a");
    await settle();
    chain.expand({ nodeKey: "root", direction: "predecessor", personId: "b" });
    await settle();

    const b = () => chain.nodes.value.find((n) => n.key === "root>p:b")!;
    expect(b().status).toBe("error");
    expect(b().step).toBeNull();
    // One card failing is not the page failing.
    expect(chain.failed.value).toBe(false);

    chain.expand({ nodeKey: "root", direction: "successor", personId: "d" });
    await settle();
    expect(chain.nodes.value.find((n) => n.key === "root>s:d")!.status).toBe(
      "ready",
    );

    // And the failure is retryable: an error is not cached as an answer.
    answers.set("b", step("b"));
    chain.retry("root>p:b");
    await settle();

    expect(b().status).toBe("ready");
    expect(b().personName).toBe("Osoba b");
    expect(asked).toEqual(["a", "b", "d", "b"]);
  });

  it("is an error page, not an error card, when the focus person fails", async () => {
    const chain = useSuccessionChain("a");
    await settle();

    expect(chain.failed.value).toBe(true);
    expect(chain.loading.value).toBe(false);
    expect(chain.nodes.value[0]!.status).toBe("error");
  });

  it("is loading until the focus person's own request settles", async () => {
    let release: (() => void) | null = null;
    authRequest.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return step("a");
    });

    const chain = useSuccessionChain("a");
    await settle();
    expect(chain.loading.value).toBe(true);

    release!();
    await settle();
    expect(chain.loading.value).toBe(false);
  });
});
