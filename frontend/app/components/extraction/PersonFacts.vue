<template>
  <!-- Nothing matched and nothing withheld: no heading either, the same rule
       SuccessionPersonChanges follows. Most people in the graph are named in
       no analysed article at all, and a section that announces itself over
       empty space reads as a page that failed to load. An error is silent for
       the same reason - see `total` below.

       `px-2` arrives with the shell, and this section had been missing it: its
       heading started 8px left of the three above it on a person's page, which
       nobody had spotted while every section carried its own copy of the
       heading rules. -->
  <PageSection
    v-if="total > 0"
    title="Fakty z artykułów"
    :icon="mdiTextSearchVariant"
    class="mt-4"
    data-testid="person-extractions"
  >
    <template #lead>
      <!-- Said out loud, because the cards look like the rest of the page and
           are not the same kind of claim: the register above is sourced and
           reviewed, these are a model's reading of a newspaper, matched to
           this person by name and not yet judged by anybody. -->
      <p v-if="user" class="k-lead" data-testid="person-extractions-lead">
        Automatycznie wyszukane w prasie i przypisane do tej osoby po imieniu i
        nazwisku. Mogą być błędne - oceń je przyciskami przy każdej karcie, a
        jeśli fakt dotyczy kogoś innego, zgłoś to przyciskiem „To nie ta osoba”.
      </p>
      <p v-else class="k-lead" data-testid="person-extractions-count">
        Znaleźliśmy
        <strong>{{ polishCounting(total, ...FACT_FORMS) }}</strong>
        o tej osobie w artykułach prasowych. Ponieważ nie są jeszcze sprawdzone,
        pokazujemy je tylko zalogowanym osobom.
      </p>
    </template>

    <!-- One chip per type this person actually has, with how many of each.
         Only when there is more than one: a filter with a single option
         filters nothing, and most people are written about in one register. -->
    <v-chip-group
      v-if="user && typeCounts.length > 1"
      v-model="selectedType"
      mandatory
      density="compact"
      class="mb-1"
      data-testid="person-extractions-filter"
    >
      <v-chip value="all" size="small" variant="outlined">
        Wszystkie ({{ facts.length }})
      </v-chip>
      <v-chip
        v-for="entry in typeCounts"
        :key="entry.type"
        :value="entry.type"
        :color="FACT_TYPE_COLORS[entry.type]"
        size="small"
        variant="outlined"
        :data-testid="`person-extractions-filter-${entry.type}`"
      >
        {{ FACT_TYPE_LABELS[entry.type] }} ({{ entry.count }})
      </v-chip>
    </v-chip-group>

    <template v-if="user">
      <template v-for="bucket in buckets" :key="bucket.key">
        <!-- Only titled when there is something on both sides of the line: a
             heading saying „nobody has checked these" over every card the
             person has is the lead paragraph again, in smaller type. -->
        <h4
          v-if="bucket.heading"
          class="facts-bucket"
          :data-testid="`person-extractions-${bucket.key}`"
        >
          {{ bucket.heading }}
        </h4>
        <v-row>
          <v-col
            v-for="fact in bucket.facts"
            :key="fact.id ?? fact.url"
            cols="12"
            md="6"
          >
            <!-- h-100 so two cards in a row end level, whatever the quotes do -
                 CompanySuccessionChanges settles ragged columns the same way.
                 The verdict buttons are `ExtractionQuickVerdict` and not
                 `ExtractionVoteButtons`: the latter opens a vuefire
                 subscription per card, and this section mounts every card at
                 once rather than behind an expander the way /ekstrakcje does.
                 Both it and the card's own "To nie ta osoba" flag are single
                 writes and open nothing. -->
            <ExtractionCard :fact="fact" class="h-100" :muted="bucket.muted">
              <template #actions>
                <ExtractionQuickVerdict
                  v-if="fact.id"
                  :id="fact.id"
                  :votes="fact.stats?.votes"
                />
              </template>
            </ExtractionCard>
          </v-col>
        </v-row>
      </template>
    </template>

    <!-- Locked, in the shape of the thing being withheld.
         The blur is decoration over placeholder bars, not over the facts: the
         endpoint is asked for the count alone (`countOnly`), so the sentences
         never reach this page. Blurring real text would put unverified claims
         about a named person into the html of their canonical, indexed url and
         call it hidden - `filter` is a paint instruction, not an access rule. -->
    <div v-else class="locked" data-testid="person-extractions-locked">
      <div class="locked__blur" aria-hidden="true">
        <div v-for="i in 2" :key="i" class="locked__card">
          <div class="locked__bar locked__bar--name" />
          <div class="locked__bar locked__bar--chip" />
          <div class="locked__bar" />
          <div class="locked__bar locked__bar--short" />
        </div>
      </div>

      <div class="locked__gate">
        <v-btn color="primary" variant="flat" :to="loginLink">
          Zaloguj się lub załóż konto
        </v-btn>
      </div>
    </div>

    <p
      v-if="user && hidden > 0"
      class="k-lead mt-2"
      data-testid="person-extractions-hidden"
    >
      Pokazujemy {{ facts.length }} najnowszych z {{ total }}.
    </p>
  </PageSection>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mdiTextSearchVariant } from "@mdi/js";
import { useExtractions } from "~/composables/extractions";
import { polishCounting } from "~/composables/polish";
import { useAuthState } from "~/composables/auth";
import {
  FACT_TYPE_COLORS,
  FACT_TYPE_LABELS,
  factReviewState,
  type FactReviewState,
} from "~/utils/extraction";
import type { ExtractionFact, ExtractionFactType } from "~~/shared/model";

const { nodeId } = defineProps<{
  /** The person whose page this is. Matched on the id the pipeline resolved at
   * ingest, never on the name: two people share one often enough that a name
   * would hand this page somebody else's facts. */
  nodeId: string;
}>();

/** Enough to be worth reading, few enough that the page stays a page. Nobody
 * in the graph is near it today; the count below says so when somebody is. */
const LIMIT = 24;

/** Singular, plural and genitive plural, as `polishCounting` takes them. */
const FACT_FORMS: [string, string, string] = ["fakt", "fakty", "faktów"];

const route = useRoute();
const { user } = useAuthState();

const loginLink = computed(
  () => `/login?redirect=${encodeURIComponent(route.fullPath)}`,
);

// A logged out reader is counted, not served: `countOnly` skips the read that
// would fetch the documents. The query is a getter, so signing in swaps it and
// refetches rather than leaving the page on the teaser.
const { data, error } = useExtractions({
  personNodeId: () => nodeId,
  countOnly: () => !user.value,
  limit: LIMIT,
});

/** An error renders as an absent section rather than a broken one.
 *
 * This query needs a composite index (personNodeId, createdAt DESC) that has to
 * be deployed by hand, so "the endpoint is failing" is a state this section can
 * genuinely be in on a fresh environment - and a person's page is public and
 * has to survive it. */
const total = computed(() => (error.value ? 0 : (data.value?.total ?? 0)));
const facts = computed<ExtractionFact[]>(() =>
  error.value ? [] : (data.value?.facts ?? []),
);
const hidden = computed(() => Math.max(0, total.value - facts.value.length));

/** „all" rather than undefined, so the chip row can be `mandatory` and the
 * unfiltered state is a chip you can see rather than the absence of one. */
const selectedType = ref<ExtractionFactType | "all">("all");

/** Only the types this person actually has, in the order the labels are
 * declared, so the row reads the same way on every page. Counted over what was
 * fetched rather than over `total`, which is what the chips are filtering. */
const typeCounts = computed(() =>
  (Object.keys(FACT_TYPE_LABELS) as ExtractionFactType[])
    .map((type) => ({
      type,
      count: facts.value.filter((fact) => fact.fact_type === type).length,
    }))
    .filter((entry) => entry.count > 0),
);

// Signing in swaps the count-only request for the real one, so the set of
// types arrives after the first render; a selection that is no longer offered
// would leave an empty grid under a heading.
watch(typeCounts, (entries) => {
  if (
    selectedType.value !== "all" &&
    !entries.some((entry) => entry.type === selectedType.value)
  ) {
    selectedType.value = "all";
  }
});

const shownFacts = computed<ExtractionFact[]>(() =>
  selectedType.value === "all"
    ? facts.value
    : facts.value.filter((fact) => fact.fact_type === selectedType.value),
);

/** What nobody has judged first, then what readers rejected. `sort` is stable,
 * so inside each rank the endpoint's newest-first order survives. */
const OPEN_RANK: Record<FactReviewState, number> = {
  confirmed: -1,
  unreviewed: 0,
  disputed: 1,
};

const confirmedFacts = computed(() =>
  shownFacts.value.filter((fact) => factReviewState(fact) === "confirmed"),
);
const openFacts = computed(() =>
  shownFacts.value
    .filter((fact) => factReviewState(fact) !== "confirmed")
    .sort(
      (a, b) => OPEN_RANK[factReviewState(a)] - OPEN_RANK[factReviewState(b)],
    ),
);

/** The blocks the cards are laid out in.
 *
 * Two rows rather than one list with a divider in it: the grid is two columns
 * wide from md up, and a line drawn inside it would land halfway down a
 * column. One unlabelled block while everything is on the same side of the
 * line - a split needs both halves to mean anything, and today almost every
 * person's facts are entirely unjudged. */
const buckets = computed(() =>
  confirmedFacts.value.length > 0 && openFacts.value.length > 0
    ? [
        {
          key: "confirmed",
          heading: "Potwierdzone przez czytelników",
          muted: false,
          facts: confirmedFacts.value,
        },
        {
          key: "open",
          heading: "Jeszcze niesprawdzone",
          muted: true,
          facts: openFacts.value,
        },
      ]
    : [
        {
          key: "all",
          heading: "",
          muted: false,
          facts: shownFacts.value,
        },
      ],
);
</script>

<style scoped>
/* Sub-heading over a block of cards. Quieter than the section's own heading -
   it separates two halves of one list rather than announcing a new section. */
.facts-bucket {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  margin-top: 8px;
  text-transform: uppercase;
}

/* The heading and the lead are `PageSection`'s, drawn from the global rules in
   `app.vue`. What is left here is the shape of what is being withheld. */
.locked {
  position: relative;
}

.locked__blur {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
  /* Enough of the shape to read as "cards are behind this", little enough that
     nobody mistakes the bars for content. */
  filter: blur(4px);
  opacity: 0.55;
  pointer-events: none;
  user-select: none;
}

@media (min-width: 960px) {
  .locked__blur {
    grid-template-columns: 1fr 1fr;
  }
}

.locked__card {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}

.locked__bar {
  background: rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 3px;
  height: 10px;
  width: 100%;
}

.locked__bar--name {
  height: 14px;
  width: 45%;
}

.locked__bar--chip {
  align-self: center;
  height: 20px;
  width: 35%;
}

.locked__bar--short {
  width: 70%;
}

.locked__gate {
  align-items: center;
  display: flex;
  inset: 0;
  justify-content: center;
  position: absolute;
}
</style>
