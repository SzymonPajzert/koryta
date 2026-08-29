<template>
  <ClientOnly>
    <div class="w-100 align-self-center">
      <div class="d-flex align-center flex-wrap ga-2 mb-2 mb-md-4">
        <h1 class="text-h6 text-md-h4">Eksploruj nowe osoby</h1>
        <v-spacer />
        <v-btn
          variant="text"
          size="small"
          class="text-none"
          :prepend-icon="mdiTable"
          to="/eksploruj/tabela?visibility=private&hideVoted=no_votes&sortBy=stats.votes.interesting&sortDesc=true"
        >
          Tabela
        </v-btn>
        <v-btn
          variant="text"
          size="small"
          class="text-none"
          :prepend-icon="mdiChartLine"
          to="/eksploruj/statystyki"
        >
          Statystyki
        </v-btn>
      </div>

      <!-- The job, in two sentences, above everything that does it.
           „Niejasne jest, co to znaczy, że osoba jest interesująca” is what an
           alpha tester said after working through this page: the steps below
           said what to click and the vote control said -5 to +5, and between
           them nothing said what the reader was being asked to decide. It is
           the first thing on the page now because somebody who does not know
           what the queue is for cannot get it from anywhere further down. -->
      <p class="text-body-2 mb-4 lede" data-testid="queue-brief">
        Kolejka pokazuje osoby, o których wiemy, że mają posadę w spółce albo
        instytucji publicznej. Twoje zadanie: sprawdzić, czy tę posadę tłumaczy
        polityka - partia, kampania, rodzina, znajomość z ratusza - i
        zagłosować. <strong>Głos w górę</strong> znaczy „moim zdaniem ta osoba
        powinna być oznaczona jako koryciarz”, <strong>głos w dół</strong> -
        „moim zdaniem nie powinna”. Niczego tym nie publikujesz: głosy i notatki
        układają kolejkę i to na nich pracuje redakcja.
      </p>

      <ExploreProgressBar hide-cta :query="progressQuery" class="mb-4" />

      <!-- Everything that decides who is in the queue, in one strip. The order
           toggle, the category and the score threshold used to sit on two rows
           either side of the progress bar, which read as three unrelated
           controls rather than as one filter. -->
      <v-card variant="outlined" class="pa-3 mb-4" data-testid="queue-filters">
        <div class="d-flex align-center flex-wrap ga-3">
          <!-- The labels shorten and the icons go on a phone: at 375px the
               full pair is 344px wide inside a 319px card, and the toggle
               does not wrap - the second button hung out over the edge. -->
          <v-btn-toggle
            v-model="filterOrder"
            mandatory
            divided
            variant="outlined"
            density="comfortable"
            class="order-toggle"
          >
            <v-btn
              value="recent"
              class="text-none"
              :prepend-icon="mdiClockFast"
            >
              <span class="label-long">Najnowsze zatrudnienia</span>
              <span class="label-short">Najnowsze</span>
            </v-btn>
            <v-btn
              value="votes"
              class="text-none"
              :prepend-icon="mdiStarOutline"
            >
              Najwyżej oceniane
            </v-btn>
          </v-btn-toggle>

          <v-spacer />

          <v-text-field
            v-if="orderRecent"
            v-model="minVotes"
            type="number"
            :min="0"
            label="Min. suma głosów"
            variant="outlined"
            density="compact"
            hide-details
            style="max-width: 170px"
          />

          <v-select
            v-model="filterCategory"
            :items="availableCategories"
            label="Typ podmiotu"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            style="min-width: 200px; max-width: 260px"
          />
        </div>

        <div class="text-caption text-medium-emphasis mt-2">
          {{ queueDescription }}
          <template v-if="!pending && totalItems">
            W kolejce:
            {{ polishCounting(totalItems, "osoba", "osoby", "osób") }}.
          </template>
        </div>
      </v-card>

      <!-- What to do, as three steps rather than as five sentences. The list
           ticks itself off as the reader works, so the block is both the
           instructions and the progress through them - the long version is a
           click away for whoever needs it, and stays out of the way of
           everybody who has done this before. -->
      <v-card
        variant="outlined"
        class="steps mb-4"
        :class="{ 'steps--done': allActionsDone }"
        data-testid="explore-steps"
      >
        <div class="d-flex align-center flex-wrap ga-2 pa-3">
          <ol class="steps__list">
            <li
              v-for="(step, index) in steps"
              :key="step.key"
              class="step"
              :class="{ 'step--done': step.done }"
              :title="step.hint"
            >
              <v-icon
                v-if="index > 0"
                :icon="mdiChevronRight"
                size="16"
                class="step__sep"
                aria-hidden="true"
              />
              <span class="step__badge">
                <v-icon v-if="step.done" :icon="mdiCheck" size="14" />
                <template v-else>{{ index + 1 }}</template>
              </span>
              <span class="step__label">{{ step.label }}</span>
            </li>
          </ol>

          <span
            v-if="allActionsDone"
            class="d-flex align-center ga-1 ml-2 text-body-2 text-success font-weight-medium"
          >
            <v-icon :icon="mdiCheckCircle" size="18" />
            Gotowe
          </span>

          <v-spacer />

          <v-btn
            variant="text"
            size="small"
            class="text-none"
            :prepend-icon="mdiHelpCircleOutline"
            :append-icon="showInstructions ? mdiChevronUp : mdiChevronDown"
            @click="showInstructions = !showInstructions"
          >
            Jak to działa?
          </v-btn>

          <!-- Filled, not outlined. `primary` is sage, which as ink on white
               is 1.85:1 on this theme - the same reason `card/Employment.vue`
               keeps it for surfaces and never for text. As a fill it carries
               black type at 10:1, and this is the one button the page is
               built around. -->
          <v-btn
            variant="flat"
            class="text-none"
            :color="allActionsDone ? 'success' : 'primary'"
            :append-icon="mdiArrowRight"
            :loading="pending"
            data-testid="next-person"
            @click="nextPerson"
          >
            Następna osoba
          </v-btn>
        </div>

        <v-expand-transition>
          <div v-if="showInstructions" class="px-3 pb-3">
            <v-divider class="mb-3" />
            <ol class="steps__detail">
              <li
                v-for="step in steps"
                :key="step.key"
                :class="{ 'text-medium-emphasis': step.done }"
              >
                <strong>{{ step.label }}.</strong> {{ step.hint }}
              </li>
            </ol>
            <p class="text-caption text-medium-emphasis mb-0 mt-2">
              Kiedy skończysz, kliknij „Następna osoba”. Żaden krok nie jest
              obowiązkowy - jeśli o kimś nic nie ma, po prostu przejdź dalej.
            </p>
          </div>
        </v-expand-transition>
      </v-card>

      <!-- `table-card` is not styled by anything here any more; it is the
           handle tests/e2e/nowe_table_fits.spec.ts and explore_nowe.spec.ts
           reach the table through. -->
      <v-card class="table-card mb-4">
        <ExploreTable
          :page="page"
          :headers="headers"
          :items="tableItems"
          :total-items="totalItems"
          :pending="pending"
          :items-per-page="1"
          :sort-by="sortBy"
          disable-focus
          score-with-name
          hide-default-footer
          no-data-text="Brak danych do wyświetlenia. Prawdopodobnie przejrzałeś wszystkie nowe powiązania."
          @action:explored="actionExplored = true"
          @action:voted="actionVoted = true"
        />
      </v-card>

      <template v-if="focusedPerson">
        <!-- The record first. Where somebody has worked and what they ran for
             is what the reader is being asked to judge; the searches next to
             the note below are written against it, and reading them in the
             other order meant scrolling past both to find out who this is. -->
        <v-card class="mb-4 pa-2 pa-md-3" data-testid="explore-relations">
          <CardEmploymentHistory
            v-if="focusedEdges.length"
            :key="focusedPerson.id"
            :edges="focusedEdges"
            :can-correct="canEditRelations"
            :can-remove="canRemoveRelations"
            @edit="openEdit"
            @remove="openRemove"
          />
          <div v-else class="pa-2">
            <div class="sec-head mb-1">
              <v-icon
                :icon="mdiTimelineTextOutline"
                size="18"
                class="sec-head__icon"
              />
              <h3 class="text-h6">Historia powiązań</h3>
            </div>
            <p class="k-lead mb-0">
              Nie znamy jeszcze żadnych powiązań tej osoby - tym bardziej warto
              poszukać.
            </p>
          </div>
        </v-card>

        <DialogEditRelationHost
          v-model="editOpen"
          v-model:outcome="editedOutcome"
          :edge="editEdge"
          :label="editLabel"
          :can-apply="canApplyEdits"
          @saved="onEdgeEdited"
        />

        <DialogRemoveEdgeHost
          v-model="removeOpen"
          v-model:shown="removedShown"
          :edge="removeEdge"
          :label="removeLabel"
          @removed="onEdgeRemoved()"
        />

        <v-row>
          <v-col cols="12" md="6">
            <v-card class="mb-4">
              <CardExplorePerson
                :key="focusedPerson.id"
                :person="focusedPerson"
                :region="undefined"
                :company="undefined"
                :work-locations="workLocations"
              />

              <ChartPersonLocations
                v-if="mapLocations.length"
                :key="`map-${focusedPerson.id}`"
                :locations="mapLocations"
              />

              <div class="pa-4 pt-0">
                <ExploreProposeChange
                  :key="focusedPerson.id"
                  :person="focusedPerson"
                />
              </div>
            </v-card>
          </v-col>

          <!-- The notes carry their own heading and sit on the page background
               everywhere else they appear. Here they are one of two columns,
               so they get the same surface as the card beside them - a bare
               section next to a raised card read as an unfinished half. -->
          <v-col cols="12" md="6">
            <v-card class="mb-4 pa-2 pa-md-3">
              <NoteEditor
                :key="focusedPerson.id"
                :node-id="focusedPerson.id"
                @saved="actionNoted = true"
              />
            </v-card>
          </v-col>
        </v-row>
      </template>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import {
  mdiArrowRight,
  mdiChartLine,
  mdiCheck,
  mdiCheckCircle,
  mdiChevronDown,
  mdiChevronRight,
  mdiChevronUp,
  mdiClockFast,
  mdiHelpCircleOutline,
  mdiStarOutline,
  mdiTable,
  mdiTimelineTextOutline,
} from "@mdi/js";
import { ref, computed, watch } from "vue";
import { useListWithStats } from "~/composables/entity/listWithStats";
import { useQueryFilters } from "~/composables/queryFilters";
import { polishCounting } from "~/composables/polish";
import { voteMeaning } from "~/composables/votes";
import { companyCategories } from "~~/shared/companyCategories";
import type { PersonRich } from "~~/shared/model";
import type { Query } from "~~/server/api/nodes/index.get";

import { useEdges } from "~/composables/edges";
import { useEdgeRemoval } from "~/composables/edgeRemoval";
import { useEdgeEditing } from "~/composables/edgeEditing";

definePageMeta({
  affineLink: "BYOEeL1iG0mvIR3yz2pOs",
  middleware: "auth",
  maxWidth: 1300,
});
useHead({
  title: "Eksploruj Nowe - koryta.pl",
});

const page = ref(1);
const showInstructions = useCookie<boolean>("show-explore-new-instructions", {
  default: () => true,
});
const availableCategories = companyCategories.map((c) => ({
  title: c.title,
  value: c.value,
}));
const { stringFilter, choiceFilter, numberFilter } = useQueryFilters();
const filterCategory = stringFilter("category");
/** Read from the url and nowhere else - the page has no control for it. It is
 * how /eksploruj/szpitale asks for the people sitting on a hospital board now
 * rather than everybody who ever did, and it only means anything next to a
 * `category`, `place` or `companyTeryt` for `selected` to narrow. */
const filterCurrentlyEmployed = stringFilter("currentlyEmployed");

/** Which end of the queue to work through.
 *
 * `recent` is the default: somebody who started a job last month is worth
 * looking at while it is still news, and the pipeline's own rating is enough to
 * tell an interesting one from the rest. `votes` is the older behaviour - the
 * highest rated first, however long ago they were hired.
 */
const filterOrder = choiceFilter<"recent" | "votes">("order", "recent");
const orderRecent = computed(() => filterOrder.value === "recent");

/** The aggregate score a person needs to show up in `recent`. Three is where
 * the pipeline's rating starts to mean something - 1,050 of the ~5,200
 * unpublished people clear it, against a maximum observed score of 5 - so the
 * queue stays a shortlist rather than everyone ever ingested. */
const DEFAULT_MIN_VOTES = 3;
const filterMinVotes = numberFilter("minVotes");
/** Kept out of the url while it equals the default, like every other filter
 * here. Clearing the field therefore reads back as the default rather than as
 * "no minimum" - the two are the same absent-from-the-url state. */
const minVotes = computed<number, number | string | null>({
  get: () => filterMinVotes.value ?? DEFAULT_MIN_VOTES,
  set: (value) => {
    // The text field hands back a string, and an empty one once it is cleared.
    const parsed =
      typeof value === "number"
        ? value
        : Number.parseInt(String(value ?? ""), 10);
    filterMinVotes.value =
      !Number.isFinite(parsed) || parsed === DEFAULT_MIN_VOTES ? null : parsed;
  },
});

/** Who the queue is showing, in one line under the controls that decide it. */
const queueDescription = computed(() =>
  orderRecent.value
    ? `Osoby, które zaczęły pracę najpóźniej, z sumą ocen co najmniej ${minVotes.value} i bez głosu od żadnej osoby.`
    : "Osoby z najwyższą sumą ocen, bez głosu od żadnej osoby.",
);

// The card stack is paged in memory rather than through the url.
watch([filterCategory, filterOrder, minVotes], () => {
  page.value = 1;
});

const actionExplored = ref(false);
const actionNoted = ref(false);
const actionVoted = ref(false);

/** The three things a reader is here to do, in the order the page lays them
 * out, each with the sentence that used to be a bullet in the instructions
 * panel. `done` is what ticks the step off in the strip. */
const steps = computed(() => [
  {
    key: "explore",
    label: "Eksploruj",
    done: actionExplored.value,
    hint:
      "Kliknij „Eksploruj” w wierszu tabeli - otworzą się wyszukiwarki z " +
      "informacjami o tej osobie. Szukasz jednego: czy coś łączy ją z " +
      "polityką. Jeśli nic się nie otwiera, wyłącz blokowanie wyskakujących " +
      "okien.",
  },
  {
    key: "note",
    label: "Notatka",
    done: actionNoted.value,
    hint:
      "Zapisz w sekcji „Notatki” to, co znalazłeś/aś, razem z linkiem do " +
      "źródła - pod nagłówkiem „Notatki” są przykłady, jak taka notatka " +
      "wygląda. Nawet „szukałem/am i nic nie ma” jest coś warte: następna " +
      "osoba nie zacznie od zera.",
  },
  {
    key: "vote",
    label: "Głos",
    done: actionVoted.value,
    // What the arrows assert, in the same words `voteCategoryConfig` gives the
    // control itself - the reader should not find one wording in the
    // instructions and another in the tooltip.
    hint: `${voteMeaning("interesting")} Głosy układają kolejkę dla wszystkich.`,
  },
]);

const allActionsDone = computed(() => steps.value.every((step) => step.done));

watch(allActionsDone, (done) => {
  if (done) {
    showInstructions.value = false;
  }
});

/** Move on, by a random handful of places rather than by one.
 *
 * Several people work through the same queue at once, and stepping by exactly
 * one would put all of them on the same person. At least one, though: the
 * random step used to round rather than floor, so a tenth of the clicks left
 * the reader on the person they had just finished with.
 */
function nextPerson() {
  page.value += 1 + Math.floor(Math.random() * 5);
}

watch(page, () => {
  actionExplored.value = false;
  actionNoted.value = false;
  actionVoted.value = false;
});

/** The column the api sorts on. Both modes read top-down, so the direction is
 * always descending. In `votes` mode the key names a column this table no
 * longer draws - the total moved under the name - which costs nothing: every
 * header here is `sortable: false`, so there is no arrow to put anywhere and
 * the value is only ever passed on to the api. */
const sortKey = computed(() =>
  orderRecent.value ? "latestEmploymentStart" : "stats.votes.interesting",
);

const sortBy = computed(() => [{ key: sortKey.value, order: "desc" as const }]);

/** „12”, not the „12.4” `shared/stats.ts` computes.
 *
 * The tenth is false precision - it comes off edge dates that are missing a
 * day here and a month there - and printed as it arrives it also puts a dot
 * where Polish writes a comma. explore/Table.vue rounds the same figure for
 * the caption it draws under the companies, but it suppresses that caption on
 * a page which declares a „Lata pracy” column of its own, and it has no
 * `item.experience` slot - so this column was reaching Vuetify's default cell
 * and printing „12.4” after the caption had stopped.
 *
 * „poniżej roku” under one year, because rounding turns four months of work
 * into „0” - a row claiming the person has never worked anywhere. Nothing at
 * all when the total is missing, which is how the rest of the row prints what
 * it does not know.
 */
function experienceYears(experience: number | undefined) {
  if (!experience) return "";
  if (experience < 1) return "poniżej roku";
  return String(Math.round(experience));
}

/** Five columns, against the eleven this page used to declare - and it is the
 * card they have to fit inside, 1248px at a 1280 viewport, that decides how
 * many there is room for.
 *
 * "Osoba" and "Historia" are the merged pair /eksploruj/tabela draws; the cells
 * live in the shared explore/Table.vue, so this list has to name the same keys
 * or Vuetify falls back to stringifying an array of objects into the row.
 *
 * Three columns went for good. "Notatki" was a count of the notes the
 * NoteEditor twenty centimetres below prints in full, other people's included.
 * "Widoczność" was a constant: the queue hardcodes `visibility: "private"`,
 * which the api resolves with the same `pageIsPublic` predicate the chip
 * prints, so every row read "Szkic" - and it cost 142px of the budget.
 * "Głosy łącznie" is the one that is not dead - it is the key the `votes`
 * order sorts on and the number `minVotes` filters against - so it moved under
 * the name instead (`score-with-name` above) rather than going away.
 *
 * Nothing reactive left in here, so it is a plain array: `Widoczność` was the
 * only entry that depended on who was signed in, and this page is behind the
 * auth middleware anyway. */
const headers = [
  { title: "Osoba", key: "name", sortable: false },
  { title: "Historia", key: "latestEmploymentStart", sortable: false },
  {
    title: "Lata pracy",
    key: "experience",
    // Vuetify runs `value` over the row and prints what it returns; without it
    // the cell falls through to `item.experience` as it arrives.
    value: (item: PersonRich) => experienceYears(item.experience),
    sortable: false,
    align: "center" as const,
  },
  {
    title: "Twój głos",
    key: "userVote",
    sortable: false,
    align: "center" as const,
  },
  { title: "Eksploruj", key: "explore", sortable: false },
];

// Sorting on `latestEmploymentStart` leaves out the people who have no
// employment edge to date at all - 135 of the 1,050 above the default score.
// That is the point of the mode rather than a gap in it: "hired recently" has
// nothing to say about somebody with no known job.
const apiQuery = computed(
  () =>
    ({
      type: "person",
      limit: 1,
      page: page.value,
      sortBy: sortKey.value,
      sortDesc: "true",
      visibility: "private",
      hideVoted: "no_votes",
      category: filterCategory.value || undefined,
      currentlyEmployed:
        (filterCurrentlyEmployed.value as Query["currentlyEmployed"]) ||
        undefined,
      minVotes: orderRecent.value ? minVotes.value : undefined,
    }) as Query,
);

/** The bar counts the same people it always did: everybody the reader could be
 * asked to check, narrowed only by the filters that say who that is. The score
 * threshold decides the order of the queue, not its scope, so folding it in
 * would silently redefine "sprawdzono N z M" the moment the page loads - and
 * the denominator would move again every time somebody nudged the threshold. */
const progressQuery = computed(() => ({
  ...apiQuery.value,
  minVotes: undefined,
}));

// Same as /eksploruj/tabela: the template is a single <ClientOnly>, so nothing
// this returns is rendered on the server.
// Which region each employer sits in, so the search suggestions below can put
// the person in their local context and the map can draw it.
const { companyRegions, companyLocations } = useCompanyLocations();

const { tableItems, totalItems, pending } = await useListWithStats(
  apiQuery,
  "nowe-data",
  { server: false, companyLocations },
);

const focusedPerson = computed<PersonRich | undefined>(
  () => tableItems.value?.[0],
);
const focusedPersonId = computed(() => focusedPerson.value?.id);
const {
  sources: focusedSources,
  targets: focusedTargets,
  refresh: refreshFocusedEdges,
} = await useEdges(focusedPersonId);
const focusedEdges = computed(() => [
  ...(focusedSources.value || []),
  ...(focusedTargets.value || []),
]);

/** Removing a relation from the queue itself. This is where a wrongly merged
 * person is most likely to be caught - it is the page for judging whether one
 * is worth publishing - so sending the reviewer off to the profile to clear the
 * relation, and then back, is a detour through the thing they are reviewing.
 * See `.agent/skills/relation-surfaces.md` for why this page and
 * /eksploruj/tabela get the same capabilities. */
const {
  canRemove: canRemoveRelations,
  removeOpen,
  removeEdge,
  removedShown,
  removeLabel,
  openRemove,
  onEdgeRemoved,
} = useEdgeRemoval({
  subjectName: () => focusedPerson.value?.name,
  refresh: refreshFocusedEdges,
});

/** And correcting one without leaving the queue. This is the page where a
 * wrong job title is actually noticed - it is the page for judging whether the
 * person is worth publishing - so sending the reviewer to the profile to fix it
 * and back is a detour through the thing they are reviewing. Same argument as
 * the removal above. */
const {
  canEdit: canEditRelations,
  canApply: canApplyEdits,
  editOpen,
  editEdge,
  editedOutcome,
  editLabel,
  openEdit,
  onEdgeEdited,
} = useEdgeEditing({
  subjectName: () => focusedPerson.value?.name,
  refresh: refreshFocusedEdges,
});

const { workLocations, mapLocations } = usePersonPlaces(
  focusedPerson,
  focusedEdges,
  companyRegions,
);
</script>

<style scoped>
/* No `overflow: visible` on the table card here, deliberately. /eksploruj/tabela
   deletes every scroll container between its sticky `<th>` and the page so the
   header can stick to the app bar, and pays for it with a second, unscoped rule
   putting `overflow-x: auto` on <html> - a whole page that scrolls sideways.
   This page copied the first half and not the second. With nothing left to
   scroll it and nothing left to clip it, the table painted at its min-content
   width straight out over the page background past the card's right edge, which
   is what was reported from a 2844px screen; on a 1280 laptop Vuetify's
   `html { overflow-x: hidden }` swallowed the same overhang instead, taking the
   vote control and the "Eksploruj" button - steps 3 and 1 of this page's own
   three - off canvas with no scrollbar anywhere to reach them.

   There was never anything to buy: the queue renders one row with the footer
   hidden, so a header that sticks has nothing to stick over. Vuetify's own
   `overflow: auto` on `.v-table__wrapper` stays, and whatever does not fit
   scrolls inside the card. */

/* ---- the queue filters ---- */

.label-short {
  display: none;
}

@media (max-width: 599px) {
  .label-long {
    display: none;
  }

  .label-short {
    display: inline;
  }

  /* Both labels shorten as far as they can and the pair still needs the room
     the icons take. The clock and the star say the same thing as the words
     next to them, so they are what goes. */
  .order-toggle :deep(.v-btn__prepend) {
    display: none;
  }
}

/* The brief. Full-strength ink rather than the `text-medium-emphasis` the rest
   of the page's captions carry: it is the one paragraph on this page that has
   to be read, and it sits above the fold on a phone. */
.lede {
  line-height: 1.6;
  max-width: 78ch;
}

/* ---- the three steps ---- */

.steps--done {
  border-color: rgba(var(--v-theme-success), 0.5);
}

.steps__list {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.step {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.87);
  display: flex;
  font-size: 0.875rem;
  gap: 6px;
  line-height: 1.4;
}

.step__sep {
  color: rgba(var(--v-theme-on-surface), 0.3);
  margin-right: 2px;
}

/* The number, and the tick that replaces it. Same box either way, so the row
   does not shift as the reader works through it. */
.step__badge {
  align-items: center;
  background: rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.6);
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-weight: 700;
  height: 22px;
  justify-content: center;
  width: 22px;
}

.step--done .step__badge {
  background: rgb(var(--v-theme-success));
  color: rgb(var(--v-theme-on-success));
}

.step--done .step__label {
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.steps__detail {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.8125rem;
  line-height: 1.55;
  margin: 0;
  max-width: 78ch;
  padding-left: 1.25rem;
}

.steps__detail li + li {
  margin-top: 4px;
}
</style>
