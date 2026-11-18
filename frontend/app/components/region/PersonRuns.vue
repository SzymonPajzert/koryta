<template>
  <!-- The person the reader came from, at the top of the place they stood
       in: each run of theirs here, and the way to the list it was on. A card
       with the sage edge, as any card carrying a claim about somebody. -->
  <section
    class="k-card k-card--accent person-runs"
    aria-labelledby="person-runs-title"
    data-testid="person-runs"
  >
    <div class="person-runs__head">
      <SuccessionInitials :name="person.personName" tone="in" />
      <div class="person-runs__who">
        <!-- The name and its parties on one line, as a board card has them:
             a chip at the card's far edge read as somebody else's. -->
        <div class="person-runs__name-line">
          <h2 id="person-runs-title" class="text-h6 person-runs__name">
            <NuxtLink
              :to="personUrl"
              :rel="person.published ? undefined : 'nofollow'"
              class="link-plain"
              >{{ person.personName }}</NuxtLink
            >
          </h2>
          <PartyChip v-for="party in person.parties" :key="party" :party />
          <ChipHiddenParty v-if="person.partyHidden" />
        </div>
        <div class="person-runs__lead">
          Starty w wyborach {{ locative }}: {{ runCount }}
        </div>
      </div>
    </div>

    <!-- Focusable only where „Pokaż wszystkie starty” sends the focus: the
         first run it opens. -->
    <ol :id="listId" ref="list" class="person-runs__list">
      <li
        v-for="(run, place) in shownRuns"
        :key="run.edgeId"
        class="person-run"
        :tabindex="place === RUNS_SHOWN ? -1 : undefined"
        :data-testid="`person-run-${run.edgeId}`"
      >
        <div class="person-run__text">
          <div class="person-run__line">
            <span class="person-run__election">{{ run.title }}</span>
            <!-- Each office with its own result: a mayor's race can be lost
                 and the council seat on the same list won. -->
            <template v-for="(each, index) in run.offices" :key="index">
              <span v-if="each.office" class="text-caption font-weight-bold">
                {{ each.office }}
              </span>
              <v-chip
                v-if="each.elected"
                size="x-small"
                color="success"
                variant="flat"
              >
                Z mandatem
              </v-chip>
            </template>
          </div>
          <div class="person-run__committee">
            {{ run.committee || "Komitet nieznany" }}
          </div>
        </div>

        <!-- At the row's end, where the history's rows keep what can be done
             with them; under the run on a phone. -->
        <div v-if="run.list" class="person-run__action">
          <!-- The list opens here, under its run, and the reader stays at
               the top of the page (Szymon, 2026-11-18). -->
          <template v-if="othersOn(run) > 0">
            <v-btn
              variant="tonal"
              size="small"
              :append-icon="isOpen(run.edgeId) ? mdiChevronUp : mdiChevronDown"
              :aria-expanded="isOpen(run.edgeId)"
              :aria-controls="`person-run-${run.edgeId}-lista`"
              :data-testid="`person-run-list-${run.edgeId}`"
              @click="toggle(run.edgeId)"
            >
              Kto jeszcze był na tej liście: {{ othersOn(run) }}
            </v-btn>
          </template>
          <span v-else class="person-run__alone">
            Z tej listy nie znamy nikogo więcej.
          </span>
        </div>

        <RegionListMembers
          v-if="run.list && isOpen(run.edgeId)"
          :id="`person-run-${run.edgeId}-lista`"
          class="person-run__members"
          :members="run.list.members"
          :highlight-id="person.personId"
        />
      </li>
    </ol>
    <!-- The newest few, then the rest on request: one person has stood in
         one region sixteen times (Województwo lubelskie, 2026-11-11). -->
    <button
      v-if="foldedRuns > 0"
      type="button"
      class="person-runs__more"
      aria-expanded="false"
      :aria-controls="listId"
      data-testid="person-runs-more"
      @click="unfold"
    >
      Pokaż wszystkie starty ({{ runCount }})
    </button>
  </section>
</template>

<script setup lang="ts">
import { mdiChevronDown, mdiChevronUp } from "@mdi/js";
import { generateEntityUrl } from "~~/shared/slugs";
import type {
  ListMember,
  PersonRun,
  RegionKind,
} from "~~/shared/electionLists";

const props = defineProps<{
  person: ListMember;
  runs: PersonRun[];
  kind?: RegionKind;
}>();

const personUrl = computed(() =>
  generateEntityUrl("person", props.person.personId, props.person.personName),
);

/** „w tym powiecie”: the place by its kind, which the page's own head
 * already names. */
const locative = computed(() => {
  switch (props.kind) {
    case "wojewodztwo":
      return "w tym województwie";
    case "powiat":
      return "w tym powiecie";
    case "miasto":
      return "w tym mieście";
    case "gmina":
      return "w tej gminie";
    default:
      return "w tym regionie";
  }
});

/** Runs, not rows: a row holds every office of one list. */
const runCount = computed(() =>
  props.runs.reduce((count, run) => count + run.offices.length, 0),
);

/** Everybody else on the run's list: the person is on it too. */
function othersOn(run: PersonRun): number {
  return (run.list?.members.length ?? 1) - 1;
}

/** How many runs show before „Pokaż wszystkie starty”. Never folding a
 * single one away: the button takes about the room it would. */
const RUNS_SHOWN = 5;
const unfolded = ref(false);
const shownRuns = computed(() =>
  unfolded.value || props.runs.length <= RUNS_SHOWN + 1
    ? props.runs
    : props.runs.slice(0, RUNS_SHOWN),
);
const foldedRuns = computed(() => props.runs.length - shownRuns.value.length);

/** For the button to say what it opens, the same on the server and in the
 * browser. */
const listId = useId();
const list = useTemplateRef<HTMLOListElement>("list");

/** Opening the rest takes the focused button away, which would drop a
 * keyboard or screen-reader user back to the top of the page. Focus goes to
 * the first run it opened instead, as a company's „Pokaż starsze” sends it to
 * the first card (succession/CompanyChanges.vue); `preventScroll`, because
 * the runs open downwards from where the reader already is. */
async function unfold() {
  unfolded.value = true;
  await nextTick();
  const rows = list.value?.querySelectorAll<HTMLElement>(
    ":scope > .person-run",
  );
  rows?.[RUNS_SHOWN]?.focus({ preventScroll: true });
}

const opened = ref(new Set<string>());

function isOpen(edgeId: string): boolean {
  return opened.value.has(edgeId);
}

function toggle(edgeId: string) {
  const next = new Set(opened.value);
  if (next.has(edgeId)) next.delete(edgeId);
  else next.add(edgeId);
  opened.value = next;
}
</script>

<style scoped>
.person-runs {
  padding: 16px 16px 4px 20px;
}

.person-runs__head {
  align-items: center;
  display: flex;
  gap: 12px;
}

.person-runs__who {
  flex: 1;
  min-width: 0;
}

.person-runs__name-line {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.person-runs__name {
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.person-runs__lead {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  line-height: 1.4;
  margin-top: 2px;
}

.person-runs__list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}

/* The run's words on the left, what to do with it at the row's end: the
   runs read down the card as one column, and the controls as another. */
.person-run {
  align-items: center;
  border-top: 1px solid var(--k-line);
  column-gap: 16px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 12px 0;
}

/* Focus only lands on a run from „Pokaż wszystkie starty”, as a reading
   position, not a control: a ring round the row would frame it like
   something to press. */
.person-run:focus {
  outline: none;
}

.person-run__line {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.person-run__election {
  font-size: var(--k-ui-size);
  font-weight: 700;
}

.person-run__committee {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-ui-size);
  line-height: 1.45;
  margin-top: 2px;
  overflow-wrap: anywhere;
}

.person-run__alone {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
}

/* The list under its run, the whole width of the card: its own ruled box,
   rounded a step less than the card around it so the corners nest. */
.person-run__members {
  border: 1px solid var(--k-line);
  border-radius: var(--k-r-control);
  grid-column: 1 / -1;
  margin-top: 12px;
  overflow: hidden;
}

.person-runs__more {
  border-top: 1px solid var(--k-line);
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-ui-size);
  font-weight: 600;
  padding: 12px 0;
  text-align: left;
  width: 100%;
}

.person-runs__more:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-neutral));
  outline-offset: 2px;
}

@media (hover: hover) {
  .person-runs__more:hover {
    text-decoration: underline;
  }
}

/* A phone has no room beside the run: the control goes under it. */
@media (max-width: 599.98px) {
  .person-run {
    grid-template-columns: minmax(0, 1fr);
  }

  .person-run__action {
    margin-top: 8px;
  }
}
</style>
