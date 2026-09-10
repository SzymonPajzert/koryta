<template>
  <figure class="graph" data-testid="chain-graph">
    <!-- The scroll box, and the only one. `tests/visual/phoneWidth.ts` fails
         the 375px project the moment `documentElement.scrollWidth` passes
         `clientWidth`, and that suite does not run in quick-check - it goes red
         in CI a day later, on a shot nobody touched. The svg below is capped at
         100% of this box so it can never push sideways; what it can do is get
         tall, which is what the vertical scroll here is for. -->
    <div class="graph__box">
      <svg
        v-if="layout.nodes.length"
        class="graph__svg"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        :style="{ maxWidth: `${layout.width}px` }"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        :aria-label="summary"
      >
        <defs>
          <!-- Two heads, because a batched hop is a weaker claim and has to
               look like one all the way to its point; a marker inherits
               nothing from the line it is attached to, so the dash on the
               shaft would otherwise end in a confident arrow. The ids are
               per instance - a document with two of these graphs in it would
               otherwise have the second one's markers resolve to the first
               one's. -->
          <marker
            :id="`${uid}-head`"
            markerHeight="6"
            markerWidth="6"
            orient="auto"
            refX="5"
            refY="3"
            viewBox="0 0 6 6"
          >
            <path class="graph__head" d="M0,0 L6,3 L0,6 Z" />
          </marker>
          <marker
            :id="`${uid}-head-batch`"
            markerHeight="6"
            markerWidth="6"
            orient="auto"
            refX="5"
            refY="3"
            viewBox="0 0 6 6"
          >
            <path class="graph__head graph__head--batch" d="M0,0 L6,3 L0,6 Z" />
          </marker>
        </defs>

        <!-- Every arrow before every node, so a line that passes close to a
             circle goes behind it rather than across the name. -->
        <line
          v-for="edge in arrows"
          :key="edge.key"
          class="graph__edge"
          :class="{ 'graph__edge--batch': edge.batched }"
          data-testid="chain-graph-edge"
          :data-from="edge.fromKey"
          :data-to="edge.toKey"
          :data-batched="edge.batched ? 'true' : 'false'"
          :marker-end="`url(#${edge.batched ? `${uid}-head-batch` : `${uid}-head`})`"
          :x1="edge.x1"
          :x2="edge.x2"
          :y1="edge.y1"
          :y2="edge.y2"
        >
          <title>{{ edge.title }}</title>
        </line>

        <g
          v-for="entry in layout.nodes"
          :key="entry.key"
          class="graph__node"
          data-testid="chain-graph-node"
          :data-key="entry.key"
          :data-person="entry.personId"
          :data-state="stateOf(entry)"
          @click="emit('select', entry.key)"
        >
          <title>{{ titleOf(entry) }}</title>
          <circle
            class="graph__dot"
            :class="`graph__dot--${stateOf(entry)}`"
            :cx="entry.x"
            :cy="entry.y"
            :data-testid="entry.focus ? 'chain-graph-focus' : undefined"
            :r="layout.nodeRadius"
          />
          <text
            class="graph__label"
            :class="{ 'graph__label--focus': entry.focus }"
            text-anchor="middle"
            :x="entry.x"
            :y="entry.y + layout.labelOffset"
          >
            {{ labelOf(entry) }}
          </text>
        </g>
      </svg>
    </div>

    <figcaption class="k-lead graph__caption">
      <span v-if="!layout.edges.length" data-testid="chain-graph-empty">
        Rozwiń kogoś w kolumnach poniżej, a łańcuch narysuje się tutaj.
      </span>
      <span v-else>
        Strzałka biegnie od poprzednika do następcy - w stronę, w którą
        przechodziło stanowisko.
      </span>
      <!-- The same caveat the columns print in prose, once for the picture
           rather than once per arrow: every candidate in a batch carries the
           same `batchSize`, so saying it per hop would say it six times about
           one decision. -->
      <span v-if="batched" data-testid="chain-graph-batch-note">
        Przerywana strzałka: tego samego dnia zmieniło się w tym organie kilka
        miejsc naraz, więc rejestr nie zapisuje, kto dokładnie kogo zastąpił.
      </span>
    </figcaption>
  </figure>
</template>

<script lang="ts" setup>
import { computed, useId } from "vue";
import type { ChainNode } from "~/composables/successionChain";
import {
  layoutSuccessionGraph,
  type GraphLayoutNode,
  type SuccessionGraphLayout,
} from "~/utils/successionGraphLayout";

/* A picture of the chain, above the columns that are the chain's controls.
 *
 * Dumb on purpose, and in the same way `ChainColumns.vue` is: the props are the
 * composable's own `nodes` array and nothing is kept between renders, so the
 * graph cannot show a person the columns do not, cannot fall behind an
 * expansion, and never sends a request. Everything about where a circle goes is
 * in `~/utils/successionGraphLayout`, which is a pure function - a graph is
 * only worth testing on coordinates, and coordinates are not testable through
 * markup.
 */

const props = defineProps<{
  /** Every open node, parents before children - the order the layout needs and
   * the order the columns stack. */
  nodes: ChainNode[];
  /** The key of the person the page is about. Handed in by the chain so that
   * no drawing has to know it is `"root"`. */
  focusKey: string;
}>();

const emit = defineEmits<{
  /** A circle was clicked. The page may do something with it or nothing; the
   * graph itself does not move, highlight or expand, because every node here
   * has a full card of its own in the columns below and that card is the
   * keyboard-reachable version of anything this could offer. */
  (e: "select", nodeKey: string): void;
}>();

/** Per instance, because a `url(#id)` reference resolves document-wide: two of
 * these graphs on one page would otherwise share one set of arrowheads, and
 * the second one's would be whatever the first one defined. */
const uid = useId();

/** Everything the geometry actually depends on, as one string.
 *
 * `layoutSuccessionGraph` reads only the shape of the chain - which nodes
 * exist, what hangs off what, on which side, how deep, and in what order - plus
 * the parent's own candidate list for the facts on an arrow. It never reads a
 * name or a status to decide a coordinate.
 *
 * The chain's `nodes` array, though, is rebuilt whenever a name or a status
 * changes as well: a person is inserted the moment they are clicked and again
 * when their answer lands. Keyed on the array itself, the 800 tick solve
 * therefore ran twice per expansion, and the second run could only ever
 * reproduce the first - measured at ~36ms each on a 30 node fan-out, which is
 * a fifth of a second of blocked main thread on a phone, spent landing the
 * coordinates that are already on screen.
 *
 * A parent is always settled before any child of it can exist, so the facts an
 * arrow carries are final by the time there is an arrow to carry them - which
 * is why they need no place in this signature.
 */
const structure = computed(() =>
  props.nodes
    .map(
      (node) =>
        `${node.key}|${node.parentKey ?? ""}|${node.direction ?? ""}|${node.depth}`,
    )
    .join("\n"),
);

/** The solved geometry, recomputed only when the shape changes.
 *
 * Held outside the computed rather than in it: a computed re-runs its body
 * whenever anything it read is invalidated, and this one has to read
 * `props.nodes` to solve at all, so the cache has to survive that.
 */
let solved: { signature: string; layout: SuccessionGraphLayout } | null = null;

const geometry = computed(() => {
  const signature = structure.value;
  if (!solved || solved.signature !== signature) {
    solved = {
      signature,
      layout: layoutSuccessionGraph(props.nodes, { focusKey: props.focusKey }),
    };
  }
  return solved.layout;
});

/** The geometry with today's names and statuses folded back in.
 *
 * Cheap - one map and one pass - and it is what keeps the cache above from
 * freezing a node at „wczytujemy…” for the life of the chain.
 */
const layout = computed<SuccessionGraphLayout>(() => {
  const base = geometry.value;
  const byKey = new Map(props.nodes.map((node) => [node.key, node]));
  return {
    ...base,
    nodes: base.nodes.map((entry) => {
      const node = byKey.get(entry.key);
      if (!node) return entry;
      return {
        ...entry,
        name: node.personName,
        status: node.status,
        // Mirrors `layoutSuccessionGraph`: settled and still nameless is the
        // reader not being told who this is, which is not the same fact as a
        // request still in flight.
        unnamable: node.status === "ready" && node.personName === "",
      };
    }),
  };
});

/** Which of the four things a circle can be, in one word.
 *
 * Pending and unnamable are different facts and get different glyphs, the way
 * `ChainPerson.vue` spends a spinner on one and an em dash on the other:
 * "we have not asked yet" and "you may not be told who this is" are not the
 * same answer, and an error is a third.
 */
function stateOf(entry: GraphLayoutNode): string {
  if (entry.status === "pending") return "pending";
  if (entry.status === "error") return "error";
  if (entry.unnamable) return "unknown";
  return entry.focus ? "focus" : "named";
}

/** Names run long - „Wojciech Szczęsny Kaczmarek” is 27 characters against a
 * column 150 units wide - and SVG text does not wrap or ellipsise itself. Cut
 * here rather than drawn over the neighbour; the whole name is in the `<title>`
 * and, at full size, on the card below. */
function labelOf(entry: GraphLayoutNode): string {
  if (entry.status === "pending") return "wczytujemy…";
  if (entry.status === "error") return "nie wczytano";
  if (!entry.name) return "—";
  // `trimEnd` so a cut that lands on a space does not leave the ellipsis
  // floating a character clear of the name.
  return entry.name.length > 20
    ? `${entry.name.slice(0, 19).trimEnd()}…`
    : entry.name;
}

function titleOf(entry: GraphLayoutNode): string {
  if (entry.status === "pending") return "Wczytujemy tę osobę…";
  if (entry.status === "error") return "Nie udało się wczytać tej osoby.";
  return entry.name || "Nie możemy pokazać, kto to jest.";
}

/** The arrows, with their ends pulled back out of the circles they join.
 *
 * A marker sits at the very end of its line, so an untrimmed arrow points at
 * the centre of a node and buries its head under the fill. Trimmed by the
 * radius the layout actually used rather than by a number restated here.
 */
const arrows = computed(() => {
  const byKey = new Map(layout.value.nodes.map((entry) => [entry.key, entry]));
  const trim = layout.value.nodeRadius + 3;

  return layout.value.edges.flatMap((edge) => {
    const from = byKey.get(edge.fromKey);
    const to = byKey.get(edge.toKey);
    if (!from || !to) return [];

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // Never zero in practice - a hop always crosses a column - but a fixture
    // can put two nodes in one place, and dividing by it would put NaN in the
    // markup rather than a short line.
    const length = Math.hypot(dx, dy) || 1;

    return [
      {
        ...edge,
        x1: from.x + (dx / length) * trim,
        y1: from.y + (dy / length) * trim,
        x2: to.x - (dx / length) * trim,
        y2: to.y - (dy / length) * trim,
        title: `${titleOf(from)} → ${titleOf(to)}${edge.label ? ` · ${edge.label}` : ""}`,
      },
    ];
  });
});

const batched = computed(() => layout.value.edges.some((edge) => edge.batched));

/** What a screen reader is told the picture is. The graph adds no fact the
 * columns underneath do not carry, so this is a summary rather than a
 * transcript - the transcript is the rest of the page. */
const summary = computed(() => {
  const names = layout.value.nodes
    .map((entry) => entry.name)
    .filter((name) => name);
  return `Łańcuch następstw: ${names.length ? names.join(", ") : "brak osób"}.`;
});
</script>

<style scoped>
/* `k-lead` is global (app.vue) and is not restated here; what follows is only
   this figure's own box. */

.graph {
  margin: 0 0 14px;
}

.graph__box {
  /* Roughly half a laptop viewport. A chain a reader has opened wide enough to
     need more than this is one whose columns are the thing they are reading,
     and a graph that pushed those off the bottom of the screen would be the
     overview costing more room than the detail. `overflow-x` is hidden rather
     than left to compute to `auto` off the line above it: the svg is capped at
     100% of this box, so there is never anything out there to reach, and an
     always-empty horizontal scrollbar under the picture is noise. */
  max-height: 440px;
  overflow-x: hidden;
  overflow-y: auto;
}

.graph__svg {
  display: block;
  /* Scaled down to fit a phone rather than scrolled sideways: the shape of the
     chain is what this is for, and the names it shrinks are on full-size cards
     directly below. Never scaled UP past the size the layout chose, which is
     what `max-width` (bound to the layout's own width) is for - a two-person
     chain stretched across a desktop would be two circles a screen apart. */
  height: auto;
  margin: 0 auto;
  width: 100%;
}

.graph__node {
  cursor: pointer;
}

.graph__dot {
  fill: rgb(var(--v-theme-surface));
  stroke: rgba(var(--v-theme-on-surface), 0.38);
  stroke-width: 1.5;
}

.graph__dot--focus {
  fill: rgb(var(--v-theme-primary));
  stroke: rgb(var(--v-theme-primary));
}

.graph__dot--named {
  fill: rgba(var(--v-theme-primary), 0.28);
  stroke: rgba(var(--v-theme-primary), 0.75);
}

/* Dashed and empty: nothing has come back for this person yet. The columns
   spend a spinner on the same state; an svg circle cannot spin without an
   animation, and this page has none. */
.graph__dot--pending {
  fill: none;
  stroke: rgba(var(--v-theme-on-surface), 0.3);
  stroke-dasharray: 3 3;
}

/* Settled, and the reader may not be told who it is. Grey rather than red -
   nothing failed, and 1,093 of 9,301 people in the register have a page at
   all, so this is an ordinary answer. */
.graph__dot--unknown {
  fill: rgba(var(--v-theme-on-surface), 0.08);
  stroke: rgba(var(--v-theme-on-surface), 0.24);
}

.graph__dot--error {
  fill: rgba(var(--v-theme-error), 0.12);
  stroke: rgb(var(--v-theme-error));
}

.graph__label {
  fill: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 11px;
}

.graph__label--focus {
  fill: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 700;
}

.graph__edge {
  stroke: rgba(var(--v-theme-on-surface), 0.42);
  stroke-width: 1.5;
}

/* The register filed a batch, so this arrow is one of several equally good
   answers rather than a handover it recorded. Drawn weaker on purpose; the
   caption says why. */
.graph__edge--batch {
  stroke: rgba(var(--v-theme-on-surface), 0.28);
  stroke-dasharray: 4 3;
}

.graph__head {
  fill: rgba(var(--v-theme-on-surface), 0.42);
}

.graph__head--batch {
  fill: rgba(var(--v-theme-on-surface), 0.28);
}

.graph__caption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 6px 0 0;
}
</style>
