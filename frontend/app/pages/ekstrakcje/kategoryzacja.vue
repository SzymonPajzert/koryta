<template>
  <v-container class="kategoryzacja-container">
    <div class="mb-4">
      <v-btn
        variant="text"
        :prepend-icon="mdiArrowLeft"
        to="/ekstrakcje"
        class="ms-n4 mb-1"
      >
        Powrót
      </v-btn>
      <h1 class="text-h5">Kategoryzuj fakty</h1>
    </div>

    <div v-if="loading" class="d-flex justify-center py-8">
      <v-progress-circular indeterminate color="primary" size="48" />
    </div>

    <div v-else-if="allFacts.length === 0" class="py-8 text-center">
      <v-alert type="info" variant="tonal">
        Brak faktów do kategoryzacji.
      </v-alert>
    </div>

    <template v-else>
      <!-- Progress counter -->
      <div class="text-center mb-4 text-body-2 text-medium-emphasis">
        Oznaczono {{ reviewedCount }} z {{ allFacts.length }}
      </div>

      <!-- Swipe card area -->
      <div class="swipe-area mx-auto">
        <ExtractionSwipeCard
          v-if="currentFact"
          :key="currentFact.id"
          :fact="currentFact"
          @swiped="onSwiped"
        />

        <div v-else class="text-center py-8">
          <v-icon size="64" color="success" class="mb-4">{{
            mdiCheckAll
          }}</v-icon>
          <div class="text-h6">Wszystkie fakty przejrzane!</div>
          <v-btn class="mt-4" color="primary" variant="tonal" to="/ekstrakcje">
            Wróć do listy
          </v-btn>
        </div>
      </div>

      <!-- Desktop fallback buttons -->
      <div v-if="currentFact" class="mt-6">
        <div class="d-flex justify-center align-center ga-4">
          <v-btn
            color="error"
            variant="tonal"
            :size="smAndUp ? 'large' : 'default'"
            :prepend-icon="mdiCloseCircleOutline"
            @click="recordVote('incorrect')"
          >
            Niepoprawny
          </v-btn>
          <v-btn
            color="success"
            variant="tonal"
            :size="smAndUp ? 'large' : 'default'"
            :append-icon="mdiCheckCircleOutline"
            @click="recordVote('correct')"
          >
            Poprawny
          </v-btn>
        </div>
        <div class="d-flex justify-center mt-3">
          <v-btn
            color="warning"
            variant="text"
            :prepend-icon="mdiHelpCircleOutline"
            @click="recordVote('insufficient')"
          >
            Za mało informacji
          </v-btn>
        </div>
      </div>

      <!-- Related facts: pick which context to keep alongside the current fact -->
      <div v-if="currentFact" class="related-section mx-auto mt-8">
        <div class="d-flex align-center flex-wrap ga-1 mb-2">
          <span class="text-caption text-medium-emphasis me-1">
            Powiązane fakty:
          </span>
          <v-chip-group v-model="activeFilters" multiple class="py-0">
            <v-chip value="article" size="small" filter variant="outlined">
              Z tego artykułu
            </v-chip>
            <v-chip value="person" size="small" filter variant="outlined">
              O tej osobie
            </v-chip>
          </v-chip-group>
        </div>

        <template v-if="activeFilters.length">
          <ExtractionCard
            v-for="f in relatedFacts"
            :key="f.id"
            :fact="f"
            class="mb-3"
          />
          <div
            v-if="relatedFacts.length === 0"
            class="text-center text-caption text-medium-emphasis py-2"
          >
            Brak innych powiązanych faktów.
          </div>
        </template>
      </div>
    </template>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import {
  mdiArrowLeft,
  mdiCheckAll,
  mdiCheckCircleOutline,
  mdiCloseCircleOutline,
  mdiHelpCircleOutline,
} from "@mdi/js";
import { useDisplay } from "vuetify";
import { collection, getFirestore, query, where } from "firebase/firestore";
import {
  useCollection,
  useCurrentUser,
  useFirebaseApp,
  useIsCurrentUserLoaded,
} from "vuefire";
import { useExtractions } from "~/composables/extractions";
import { castVoteOnce } from "~/composables/votes";
import { factSubject } from "~/utils/extraction";
import type { ExtractionFact, VoteDocument } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});
useHead({
  title: "Kategoryzacja faktów - koryta.pl",
});

const { data, pending } = useExtractions();
const route = useRoute();
const router = useRouter();
const { smAndUp } = useDisplay();

// All votable facts (an id is required to vote), in fetch order.
const allFacts = computed<ExtractionFact[]>(() =>
  (data.value?.facts ?? []).filter((f) => f.id),
);

// Votes the signed-in user has already cast (live, across sessions), so a
// returning reviewer resumes where they left off instead of starting over.
const user = useCurrentUser();
const isAuthLoaded = useIsCurrentUserLoaded();
const db = getFirestore(useFirebaseApp(), "koryta-pl");
const votesQuery = computed(() => {
  // Client-only: the server render has no signed-in Firestore user.
  if (import.meta.server || !user.value) return null;
  return query(collection(db, "votes"), where("userUid", "==", user.value.uid));
});
const { data: userVotes, pending: votesPending } = useCollection<VoteDocument>(
  votesQuery,
  { ssrKey: "kategoryzacja-user-votes" },
);

const serverVotedIds = computed(() => {
  const ids = new Set<string>();
  for (const vote of userVotes.value) {
    const categoryVotes = vote.categoryVotes;
    if (categoryVotes.correct || categoryVotes.insufficient) {
      ids.add(vote.nodeId);
    }
  }
  return ids;
});

// Facts voted on in this session — merged with the persisted votes below.
const sessionVotedIds = ref(new Set<string>());

// One reviewer per fact: a fact any user has already reviewed (reviewCount
// comes from the API and may lag a few minutes behind) counts as done, so
// concurrent reviewers spread over the backlog instead of piling up.
const externallyReviewedIds = computed(() => {
  const ids = new Set<string>();
  for (const fact of allFacts.value) {
    if (fact.id && fact.reviewCount) ids.add(fact.id);
  }
  return ids;
});

const votedIds = computed(
  () =>
    new Set([
      ...externallyReviewedIds.value,
      ...serverVotedIds.value,
      ...sessionVotedIds.value,
    ]),
);

// The votes collection also holds votes on other node types, so count only the
// facts on this page.
const reviewedCount = computed(
  () => allFacts.value.filter((f) => votedIds.value.has(f.id!)).length,
);

// Hold the initial spinner until both the facts and the user's existing votes
// are in — otherwise the first card flashes an already-reviewed fact.
const votesReady = computed(
  () => isAuthLoaded.value && (!user.value || !votesPending.value),
);
// `import.meta.server`: SSR can't know the user's votes, so it renders the
// spinner — the same thing the client's first (hydration) render shows while
// auth is still restoring. Rendering the card on the server instead would
// cause a hydration mismatch.
const loading = computed(
  () => import.meta.server || pending.value || !votesReady.value,
);

// The fact currently under review, tracked by id (not index) so we can jump to
// a related fact next while keeping context — see recordVote().
const currentId = ref<string | null>(null);
const currentFact = computed<ExtractionFact | undefined>(() =>
  allFacts.value.find((f) => f.id === currentId.value),
);

// Two independent context toggles → four combinations.
type RelatedFilter = "article" | "person";
const activeFilters = ref<RelatedFilter[]>(["article"]);

function sameSubject(a: ExtractionFact, b: ExtractionFact): boolean {
  const subject = factSubject(a);
  return subject !== "—" && subject === factSubject(b);
}

// Unvoted facts related to the current one per the active filters. Filters are
// unioned, so enabling both widens the context (this article + this person).
const relatedFacts = computed<ExtractionFact[]>(() => {
  const fact = currentFact.value;
  if (!fact || activeFilters.value.length === 0) return [];
  const byArticle = activeFilters.value.includes("article");
  const byPerson = activeFilters.value.includes("person");
  return allFacts.value.filter(
    (f) =>
      f.id !== fact.id &&
      !votedIds.value.has(f.id!) &&
      ((byArticle && f.articleUrl === fact.articleUrl) ||
        (byPerson && sameSubject(f, fact))),
  );
});

type Verdict = "correct" | "incorrect" | "insufficient";

function recordVote(verdict: Verdict) {
  const fact = currentFact.value;
  if (!fact?.id) return;

  if (verdict === "insufficient") {
    // Separate axis: the reviewer can't decide from the available context.
    castVoteOnce(fact.id, "insufficient", 1);
  } else {
    // right = correct (+1), left = incorrect (-1)
    castVoteOnce(fact.id, "correct", verdict === "correct" ? 1 : -1);
  }

  sessionVotedIds.value = new Set(sessionVotedIds.value).add(fact.id);

  // Stay in context: if related facts remain, review one of those next so the
  // surrounding facts stay on screen; otherwise take the next unreviewed fact.
  const next =
    relatedFacts.value[0] ??
    allFacts.value.find((f) => !votedIds.value.has(f.id!));
  currentId.value = next?.id ?? null;
}

function onSwiped(direction: "left" | "right") {
  recordVote(direction === "right" ? "correct" : "incorrect");
}

// Deep-link: honour ?fact=<id> on load, then keep the URL in sync so the
// current card is always shareable. Initialization waits for the persisted
// votes too, so the first card picked is one the user hasn't reviewed yet.
const initialized = ref(false);
watch(
  [allFacts, loading],
  ([facts, isLoading]) => {
    if (initialized.value || isLoading || facts.length === 0) return;
    const target = route.query.fact;
    if (typeof target === "string" && facts.some((f) => f.id === target)) {
      // An explicitly shared card is shown even if it was already reviewed.
      currentId.value = target;
    } else {
      currentId.value =
        facts.find((f) => !votedIds.value.has(f.id!))?.id ?? null;
    }
    initialized.value = true;
  },
  { immediate: true },
);

function syncUrlToFact(fact: ExtractionFact | undefined) {
  const id = fact?.id;
  if (id && route.query.fact !== id) {
    router.replace({ query: { ...route.query, fact: id } });
  }
}

// Reflect subsequent fact changes (after each vote) in the URL...
watch(currentFact, syncUrlToFact);
// ...and sync the initial fact on mount. A plain watcher misses this when the
// data is already present at setup (SSR / warm cache), because currentFact is
// set before the watcher is armed, so there is no undefined→fact transition.
onMounted(() => syncUrlToFact(currentFact.value));
</script>

<style scoped>
.kategoryzacja-container {
  max-width: 600px;
}

.swipe-area {
  max-width: 480px;
}

.related-section {
  max-width: 480px;
}
</style>
