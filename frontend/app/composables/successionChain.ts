import { computed, ref, type ComputedRef } from "vue";
import { authRequest } from "~/composables/auth";
import type {
  SuccessionCandidate,
  SuccessionChainStep,
} from "~~/server/api/edges/succession-chain.get";

export type ChainDirection = "predecessor" | "successor";

/** A candidate as one node draws them. */
export type ChainCandidateView = {
  candidate: SuccessionCandidate;
  /** The key of the node this candidate has been expanded into, or null. */
  expandedKey: string | null;
  /** False where this person is already an ancestor of the node the card sits
   * in. The register saying a seat came back to somebody is worth printing;
   * following it would loop for ever. */
  expandable: boolean;
};

/** One person at one place in the chain.
 *
 * Keyed by the path rather than by the person: two branches can legitimately
 * reach the same human, and collapsing one must not collapse the other. The
 * loaded answer is cached per person, so the two branches still cost one
 * request between them. */
export type ChainNode = {
  /** The path from the focus person to here: `"root"`, then
   * `"root>p:<personId>"`, then `"root>p:<personId>>s:<personId>"`. Unique,
   * stable, and readable in a failing test. */
  key: string;
  personId: string;
  /** Empty until the request lands, and empty for good if the id names
   * nothing this reader may be told about. */
  personName: string;
  parentKey: string | null;
  /** Which side of the parent this node hangs off; null for the focus. */
  direction: ChainDirection | null;
  /** 0 for the focus, then 1, 2, … away from it. */
  depth: number;
  status: "pending" | "ready" | "error";
  /** The answer for this person, or null while it is on its way. */
  step: SuccessionChainStep | null;
  predecessors: ChainCandidateView[];
  successors: ChainCandidateView[];
};

export type ExpandPayload = {
  nodeKey: string;
  direction: ChainDirection;
  personId: string;
};

/** What the chain holds about a node before the answer for it has arrived:
 * where it hangs, and whose it is. Everything else on `ChainNode` is derived
 * from the per-person caches below, which is what makes a re-expansion free -
 * the open list is the only thing an expansion writes. */
type OpenNode = {
  key: string;
  personId: string;
  parentKey: string | null;
  direction: ChainDirection | null;
  depth: number;
};

const ENDPOINT = "/api/edges/succession-chain";

/** The focus person's key. A constant rather than a computed: the chain grows
 * away from one person and never re-roots, and both layouts want to mark that
 * node without knowing how keys are built. */
const FOCUS_KEY = "root";

/** Every person the chain currently holds open, and the one request per person
 * that fills them.
 *
 * One composable for both layouts, because the layouts are a view of the same
 * chain: switching from columns to tree must not lose what somebody has
 * already opened, and it cannot if neither of them owns any of it.
 *
 * Requests go through `authRequest` rather than `authFetch`. `authFetch` wraps
 * `useFetch`, and a second call on one key aborts the first - which is exactly
 * what a chain does, N expansions against one endpoint. `authRequest` also
 * awaits `waitForAuthReady()` before it sends, which matters more here than
 * anywhere else on the site: most of the register has no page of its own - as
 * of the 2026-09-10 export 1,093 of 9,301 people - so a request that goes out
 * one tick before auth resolves comes back redacted to almost nothing, and an
 * almost empty chain looks like a broken page rather than a short answer.
 */
export function useSuccessionChain(rootPersonId: string): {
  /** Every open node, parents before children, in the order both layouts draw
   * them. */
  nodes: ComputedRef<ChainNode[]>;
  /** Always `"root"`. Named so a layout never has to know that. */
  focusKey: string;
  /** True until the focus person's own request settles. */
  loading: ComputedRef<boolean>;
  /** True when the focus person's own request failed - the whole page is then
   * an error, not one card. */
  failed: ComputedRef<boolean>;
  /** Grow the chain. A no-op when the payload is not expandable, and free when
   * that person's answer is already cached. */
  expand(payload: ExpandPayload): void;
  /** Drop a node and everything under it. The loaded answers stay cached, so
   * re-opening costs nothing. */
  collapse(nodeKey: string): void;
  /** Ask for a node's person again after their request failed. */
  retry(nodeKey: string): void;
} {
  /** The answers, one per person rather than one per node.
   *
   * This is the whole reason the chain costs N requests for N people and not
   * one per click: two branches that meet the same human, and a reader who
   * collapses a node and opens it again, all read out of here. A logged in
   * reader bypasses the response cache entirely (`editorFreshCachedEventHandler`),
   * so every request that is not saved here is real Firestore traffic - a mean
   * of 58 documents, a worst case of 454.
   */
  const steps = ref(new Map<string, SuccessionChainStep>());

  /** Where each person's request has got to. Separate from `steps` because a
   * person can be in flight or failed with no answer to store, and because
   * `load` reads it to decide whether to send at all. */
  const statuses = ref(new Map<string, "pending" | "ready" | "error">());

  /** The open nodes, parents before children.
   *
   * The order is the array's, not a sort: both layouts draw the list top to
   * bottom and a tree that renders a child before its parent has nowhere to
   * put it. `expand` keeps it by inserting each child directly after the last
   * descendant of its parent rather than at the end, so a second branch opened
   * off the focus person does not land underneath the first branch's
   * grandchildren.
   */
  const open = ref<OpenNode[]>([
    {
      key: FOCUS_KEY,
      personId: rootPersonId,
      parentKey: null,
      direction: null,
      depth: 0,
    },
  ]);

  /** Ask the register about one person, once.
   *
   * Returns without sending when that person is already answered or already on
   * their way, which is what makes collapse and re-expand free. A failed
   * person is not cached as an answer, so `retry` can send again.
   */
  async function load(personId: string): Promise<void> {
    const status = statuses.value.get(personId);
    if (status === "pending" || status === "ready") return;

    statuses.value.set(personId, "pending");
    try {
      const step = await authRequest<SuccessionChainStep>(ENDPOINT, {
        method: "GET",
        // `latest` is put here rather than left to `authFetch`'s `onRequest`,
        // which is where every other section on the site gets it. `onRequest`
        // returns early on the server, so an SSR request goes out anonymous,
        // the redacted answer is serialised into the payload and `useFetch`
        // never repeats it in the browser - the bug that kept telling a signed
        // in reader "nie pokazujemy jeszcze N zmian" about people they were
        // entitled to see (app/composables/successions.ts:25-38). This page is
        // behind `middleware: "auth"`, so a request from it is always a signed
        // in reader's, and this page is the one place that is worth showing
        // the whole chain to: only 1,093 of 9,301 people in the register have
        // a page of their own, so without `latest` most of a chain redacts
        // away - at Zwiazek Miast Polskich only two of Ryszard Grobelny's six
        // same-day predecessors can be named without it, which is precisely
        // the batch the reader came here to see.
        query: { personId, latest: true },
      });
      steps.value.set(personId, step);
      statuses.value.set(personId, "ready");
    } catch {
      // The card says so and offers `retry`; the rest of the chain is still
      // usable, which is why this is per person and not a page-level error
      // unless it is the focus person who failed.
      statuses.value.set(personId, "error");
    }
  }

  // Client only, and deliberately not `useAsyncData`: this request must not go
  // out during SSR at all.
  //
  // `<ClientOnly>` on the page suppresses the template, not `<script setup>`,
  // and `middleware: "auth"` returns early on the server (app/middleware/auth.ts) -
  // so without this guard every hard load of the route, including one from a
  // logged out visitor who is about to be bounced to `/login`, fired a
  // `latest=true` request from the server. That request carries no
  // Authorization header, and `latest` makes `editorFreshCachedEventHandler`
  // skip the six hour cache, so it was an uncached Firestore read - two queries
  // and 124 documents for Ryszard Grobelny, more for a longer career - served
  // to somebody who never sees the answer. The browser then repeated it.
  //
  // Nothing is lost by waiting for the client: the page renders no chain during
  // SSR anyway, and the reader has to be signed in for the answer to be worth
  // having.
  if (import.meta.client) void load(rootPersonId);

  /** The keys of every ancestor of `nodeKey`, plus its own person.
   *
   * Walked over `open` rather than parsed out of the key, even though the key
   * carries every id on the path: an id is only the last dash segment of a
   * slug elsewhere in this codebase for the same reason it would be wrong
   * here - parsing a composite string is a second encoding of the truth held
   * in the list.
   */
  function ancestorPeople(nodeKey: string): Set<string> {
    const people = new Set<string>();
    let key: string | null = nodeKey;
    while (key) {
      const node: OpenNode | undefined = open.value.find((n) => n.key === key);
      if (!node) break;
      people.add(node.personId);
      key = node.parentKey;
    }
    return people;
  }

  function childKey(
    parentKey: string,
    direction: ChainDirection,
    personId: string,
  ): string {
    return `${parentKey}>${direction === "predecessor" ? "p" : "s"}:${personId}`;
  }

  /** One candidate as the node it sits in draws them: whether it has been
   * opened, and whether it may be. */
  function viewOf(
    node: OpenNode,
    direction: ChainDirection,
    ancestors: Set<string>,
    candidate: SuccessionCandidate,
  ): ChainCandidateView {
    const key = childKey(node.key, direction, candidate.personId);
    return {
      candidate,
      expandedKey: open.value.some((n) => n.key === key) ? key : null,
      // A candidate who is already above this card is printed - the register
      // saying a seat came back to somebody is a fact worth seeing - but the
      // card offers "już w łańcuchu" instead of a button, because following it
      // would grow A → B → A for ever.
      expandable: !ancestors.has(candidate.personId),
    };
  }

  const nodes = computed<ChainNode[]>(() =>
    open.value.map((node) => {
      const step = steps.value.get(node.personId) ?? null;
      const status = statuses.value.get(node.personId) ?? "pending";
      const ancestors = ancestorPeople(node.key);
      return {
        key: node.key,
        personId: node.personId,
        personName: step?.personName ?? "",
        parentKey: node.parentKey,
        direction: node.direction,
        depth: node.depth,
        status,
        step,
        predecessors: (step?.predecessors ?? []).map((candidate) =>
          viewOf(node, "predecessor", ancestors, candidate),
        ),
        successors: (step?.successors ?? []).map((candidate) =>
          viewOf(node, "successor", ancestors, candidate),
        ),
      };
    }),
  );

  const loading = computed(
    () => (statuses.value.get(rootPersonId) ?? "pending") === "pending",
  );

  const failed = computed(() => statuses.value.get(rootPersonId) === "error");

  function collapse(nodeKey: string): void {
    // The focus person is the page; there is nothing to go back to if it is
    // dropped, and no layout offers the button.
    if (nodeKey === FOCUS_KEY) return;
    const prefix = `${nodeKey}>`;
    open.value = open.value.filter(
      (n) => n.key !== nodeKey && !n.key.startsWith(prefix),
    );
  }

  function expand(payload: ExpandPayload): void {
    const parent = open.value.find((n) => n.key === payload.nodeKey);
    if (!parent) return;

    // Refused rather than silently drawn: the ancestor check is the only thing
    // between this and an infinite chain, and a card whose person is already
    // above it shows "już w łańcuchu" for exactly this reason.
    if (ancestorPeople(parent.key).has(payload.personId)) return;

    const key = childKey(parent.key, payload.direction, payload.personId);
    // The same button both opens and closes, so a second click on an open card
    // toggles rather than adding the node twice.
    if (open.value.some((n) => n.key === key)) {
      collapse(key);
      return;
    }

    // Directly after the parent's last descendant, so the list stays in the
    // order both layouts draw: a child never precedes its parent, and a second
    // branch off one node does not land under the first branch's own children.
    let insertAt = open.value.findIndex((n) => n.key === parent.key) + 1;
    const prefix = `${parent.key}>`;
    while (
      insertAt < open.value.length &&
      open.value[insertAt]!.key.startsWith(prefix)
    ) {
      insertAt += 1;
    }

    open.value.splice(insertAt, 0, {
      key,
      personId: payload.personId,
      parentKey: parent.key,
      direction: payload.direction,
      depth: parent.depth + 1,
    });

    // Free when this person is already cached, which is the point of caching
    // by person rather than by node.
    void load(payload.personId);
  }

  function retry(nodeKey: string): void {
    const node = open.value.find((n) => n.key === nodeKey);
    if (!node) return;
    // Only a failed person is worth asking about again; `load` would refuse a
    // pending or ready one anyway, and clearing a ready one here would throw
    // away an answer every other node for that person is drawn from.
    if (statuses.value.get(node.personId) !== "error") return;
    statuses.value.delete(node.personId);
    void load(node.personId);
  }

  return {
    nodes,
    focusKey: FOCUS_KEY,
    loading,
    failed,
    expand,
    collapse,
    retry,
  };
}
