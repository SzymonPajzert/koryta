<template>
  <!-- The scroll lives here and nowhere else. `tests/visual/phoneWidth.ts`
       fails the 375px project the moment `documentElement.scrollWidth` passes
       `clientWidth`, and that suite does not run in quick-check - it goes red
       in CI, a day later, on a shot nobody changed. Vuetify sets
       `html { overflow-x: hidden }`, so a strip that overflows the page is not
       even reachable: it is silently clipped, which is what
       `app/pages/eksploruj/nowe.vue:660-676` records happening to a row of
       controls. `overflow-x: auto` on <html> is the other half of that story
       and is exactly what must not be done here. -->
  <div class="cols" data-testid="chain-columns">
    <div class="cols__strip">
      <section
        v-for="column in columns"
        :key="column.key"
        class="cols__col"
        data-testid="chain-column"
        :data-depth="column.depth"
        :data-direction="column.direction"
      >
        <!-- `data-key` is the chain's own path key, and it is the join
             between this card and the dot ChainGraph.vue drew for the same
             person above: the graph writes it as `data-key` on a node and as
             `data-from`/`data-to` on an arrow. Anything that wants to point
             from one picture at the other - a test, or a future click that
             scrolls the matching card into view - goes through it, so it must
             stay the node's key and not the person id. A person can sit in the
             chain twice, reached by two different routes; the id would name
             both of them. -->
        <article
          v-for="node in column.nodes"
          :key="node.key"
          class="chain-node"
          data-testid="chain-node"
          :data-key="node.key"
          :data-person="node.personId"
          :data-depth="node.depth"
        >
          <SuccessionChainPerson
            :node
            :is-focus="node.key === focusKey"
            @retry="emit('retry', $event)"
          />

          <!-- Only once the person's own answer has landed. An empty list is a
               statement - „nikogo tu nie znaleźliśmy” - and printing it while
               the request is still in flight would be a lie the spinner is
               already contradicting two lines above. -->
          <div v-if="node.status === 'ready'" class="chain-node__lists">
            <SuccessionChainCandidateList
              v-for="direction in DIRECTIONS"
              :key="direction"
              :candidates="
                direction === 'predecessor'
                  ? node.predecessors
                  : node.successors
              "
              :direction
              :node-key="node.key"
              :depth="node.depth + 1"
              @expand="emit('expand', $event)"
              @collapse="emit('collapse', $event)"
            />
          </div>
        </article>
      </section>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import type {
  ChainDirection,
  ChainNode,
  ExpandPayload,
} from "~/composables/successionChain";

const props = defineProps<{
  /** Every open node, parents before children. This component holds no state
   * of its own: the composable owns the chain, and the graph above is fed the
   * very same array, which is what makes expanding someone here grow the
   * picture there without a second request. */
  nodes: ChainNode[];
  /** The key of the person the page is about. Always `"root"` today; passed in
   * rather than assumed, so that the day a chain is re-rooted on someone the
   * reader opened, the middle column follows without a change here. */
  focusKey: string;
}>();

// `collapse` and `retry` both take one string, so `unified-signatures` asks for
// `(e: "collapse" | "retry", nodeKey: string)`. They are kept apart because the
// two ask the chain for opposite things - one throws a subtree away, the other
// asks for it again - and the merged signature would let a caller emit either
// name at a call site that only reasoned about one of them. The separate lines
// also carry a sentence each about what the event means, which a merged one
// cannot.
/* eslint-disable @typescript-eslint/unified-signatures */
const emit = defineEmits<{
  /** Grow the chain: hang `personId` under `nodeKey` on `direction`. */
  (e: "expand", payload: ExpandPayload): void;
  /** Drop `nodeKey` and everything under it. */
  (e: "collapse", nodeKey: string): void;
  /** Ask for `nodeKey`'s person again after their request failed. */
  (e: "retry", nodeKey: string): void;
}>();
/* eslint-enable @typescript-eslint/unified-signatures */

// Rendering the two lists from an array rather than writing the block twice is
// what guarantees a predecessor list and a successor list can never drift apart
// in markup or in the props they are given - only in the candidates they are
// handed.
const DIRECTIONS: ChainDirection[] = ["predecessor", "successor"];

/** Which side of the focus person a branch hangs on, and how far along it a
 * node stands. */
type Column = {
  key: string;
  /** Unsigned steps from the focus person - what the heading of the lists
   * inside it counts. */
  depth: number;
  /** "focus" for the middle column. */
  direction: ChainDirection | "focus";
  nodes: ChainNode[];
};

/** The chain, cut into columns by how far each node is from the focus person
 * and on which side of them it hangs.
 *
 * The side is decided by a branch's FIRST hop, not by the last one: a node
 * reached by opening a predecessor's successors is still part of the branch
 * that went left, and putting it on the right would tell the reader it is one
 * of the focus person's own successors, which it is not. The alternative -
 * summing the hops, so a step back and a step forward cancel - is truer about
 * the dates but collapses those nodes into the focus person's own column,
 * where there is no room for them and no honest label for them either. The
 * card carries the direction of its own hop in its heading, so a branch that
 * doubles back still says so where it happens.
 *
 * Built in one pass because `nodes` is ordered parents before children: a
 * node's side is already known by the time its children are read.
 */
const columns = computed<Column[]>(() => {
  const sides = new Map<string, ChainDirection | "focus">();
  const byIndex = new Map<number, Column>();

  for (const node of props.nodes) {
    const parentSide = node.parentKey ? sides.get(node.parentKey) : undefined;
    const side: ChainDirection | "focus" =
      node.direction === null
        ? "focus"
        : parentSide && parentSide !== "focus"
          ? parentSide
          : node.direction;
    sides.set(node.key, side);

    const index =
      side === "focus" ? 0 : side === "predecessor" ? -node.depth : node.depth;

    const column = byIndex.get(index);
    if (column) {
      column.nodes.push(node);
      continue;
    }
    byIndex.set(index, {
      key: `${side}-${node.depth}`,
      depth: node.depth,
      direction: side,
      nodes: [node],
    });
  }

  // Ascending by signed index, which is what puts the predecessors to the left
  // in decreasing depth, the focus in the middle and the successors to the
  // right in increasing depth.
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, column]) => column);
});
</script>

<style scoped>
.cols {
  /* The scroll box: the strip inside it is as wide as the chain, this is as
     wide as the page. Not `scrollbar-width: none` - a strip whose scrollbar
     was hidden behind a fade has already been reverted here once, for being
     unreachable by anything but a trackpad
     (form/EksplorujTabelaFilters.vue:131-137). */
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  padding-bottom: 6px;
}

.cols__strip {
  align-items: flex-start;
  display: flex;
  gap: 14px;
  /* A flex item's floor is its content, not zero, so without this the strip
     refuses to be narrower than its widest column and pushes the page out
     from the inside - the failure `expectFitsThePhone` is written to catch. */
  min-width: 0;
  /* Sized by the columns rather than by the box, which is what gives the box
     something to scroll. */
  width: max-content;
}

.cols__col {
  flex: 0 0 auto;
  min-width: 260px;
  /* A column of names does not want to be a paragraph: past this the cards
     read as a table row and the chain stops being scannable side to side. */
  max-width: 320px;
}

.chain-node + .chain-node {
  margin-top: 14px;
}

.chain-node__lists {
  margin-top: 10px;
}

/* A phone gets narrower columns rather than none: two of them almost fit at
   375px, which is the difference between a chain a thumb can walk and one that
   needs a swipe per person. */
@media (max-width: 599px) {
  .cols__col {
    min-width: 232px;
  }
}
</style>
