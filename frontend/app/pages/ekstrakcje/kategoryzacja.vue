<template>
  <v-container class="kategoryzacja-container">
    <!-- The card is the point of this page, so the header stays on two lines:
         the back button beside a title/progress stack rather than above it. -->
    <div class="d-flex align-center ga-2 mb-3">
      <v-btn
        variant="text"
        size="small"
        density="comfortable"
        :prepend-icon="mdiArrowLeft"
        to="/ekstrakcje"
        class="ms-n2 flex-shrink-0"
      >
        Powrót
      </v-btn>
      <div class="header-text">
        <h1 class="text-subtitle-1 font-weight-medium text-truncate">
          Kategoryzuj fakty
        </h1>
        <div
          v-if="!loading && allFacts.length"
          class="text-caption text-medium-emphasis"
        >
          Oznaczono {{ reviewedCount }} z {{ allFacts.length }}
        </div>
      </div>
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
        <!-- Four buttons have to share one row, so the icons go on wider
             screens only — a phone has room for the labels or the icons. -->
        <div class="d-flex justify-center align-center ga-2">
          <v-btn
            color="error"
            variant="tonal"
            :size="smAndUp ? 'large' : 'default'"
            :prepend-icon="smAndUp ? mdiCloseCircleOutline : undefined"
            @click="recordVote('incorrect')"
          >
            Błędny
          </v-btn>
          <v-btn
            color="warning"
            variant="tonal"
            :size="smAndUp ? 'large' : 'default'"
            :prepend-icon="smAndUp ? mdiHelpCircleOutline : undefined"
            @click="recordVote('insufficient')"
          >
            Nie wiem
          </v-btn>
          <v-btn
            color="success"
            variant="tonal"
            :size="smAndUp ? 'large' : 'default'"
            :append-icon="smAndUp ? mdiCheckCircleOutline : undefined"
            @click="recordVote('correct')"
          >
            Dobry
          </v-btn>
          <v-btn
            :size="smAndUp ? 'large' : 'default'"
            :icon="mdiCommentTextOutline"
            variant="text"
            :color="commentOpen ? 'primary' : undefined"
            aria-label="Skomentuj"
            @click="commentOpen = true"
          />
        </div>

        <!-- Comment: never advances on its own, so a verdict is still needed. -->
        <div v-if="commentOpen" class="comment-section mx-auto mt-4">
          <v-textarea
            v-model="comment"
            label="Komentarz (opcjonalny)"
            rows="3"
            auto-grow
            hide-details
            variant="outlined"
            density="comfortable"
            autofocus
          />
          <div class="d-flex justify-end mt-2">
            <v-btn
              v-if="verdictGiven"
              color="primary"
              variant="tonal"
              :append-icon="mdiArrowRight"
              @click="advance()"
            >
              Dalej
            </v-btn>
            <span v-else class="text-caption text-medium-emphasis py-2">
              Wybierz jeszcze ocenę powyżej.
            </span>
          </div>
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
  mdiArrowRight,
  mdiCheckAll,
  mdiCheckCircleOutline,
  mdiCloseCircleOutline,
  mdiCommentTextOutline,
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
import { castVoteOnce, saveCommentOnce } from "~/composables/votes";
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

// All votable facts (an id is required to vote), newest ingest first — the
// API returns the whole collection ordered by createdAt descending.
const allFacts = computed<ExtractionFact[]>(() =>
  (data.value?.facts ?? []).filter((f) => f.id),
);

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
    if (!vote.extractionId) continue;
    const categoryVotes = vote.categoryVotes;
    if (categoryVotes.correct || categoryVotes.insufficient) {
      ids.add(vote.extractionId);
    }
  }
  return ids;
});

// Facts voted on in this session — merged with the persisted votes below.
const sessionVotedIds = ref(new Set<string>());

// One reviewer per fact: a fact any user has already reviewed counts as done,
// so concurrent reviewers spread over the backlog instead of piling up.
// `reviewed` comes from the vote aggregate on the document, so it lags by the
// trigger round-trip plus the API cache.
const externallyReviewedIds = computed(() => {
  const ids = new Set<string>();
  for (const fact of allFacts.value) {
    if (fact.id && fact.reviewed) ids.add(fact.id);
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

// The votes collection also holds other node types, so count only facts on
// this page.
const reviewedCount = computed(
  () => allFacts.value.filter((f) => votedIds.value.has(f.id!)).length,
);

// Hold the spinner until facts and the user's existing votes are in, else the
// first card flashes an already-reviewed fact.
const votesReady = computed(
  () => isAuthLoaded.value && (!user.value || !votesPending.value),
);
// SSR can't know the user's votes, so render the spinner — matching the
// client's first (hydration) render; rendering the card instead would cause a
// hydration mismatch.
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

// The comment box is opt-in per card: either the reviewer asks for it, or an
// "incorrect" verdict opens it, since that is the one worth explaining. It never
// advances by itself — a verdict is always required.
const comment = ref("");
const commentOpen = ref(false);
// Whether a verdict was cast on the card on screen. Tracked separately from
// `votedIds`, which also counts other reviewers' verdicts and would offer
// "Dalej" on a deep-linked card this reviewer has not judged.
const verdictGiven = ref(false);

function recordVote(verdict: Verdict) {
  const fact = currentFact.value;
  if (!fact?.id) return;

  if (verdict === "insufficient") {
    // Separate axis: the reviewer can't decide from the available context.
    castVoteOnce(fact.id, "insufficient", 1, "extraction");
  } else {
    // right = correct (+1), left = incorrect (-1)
    castVoteOnce(
      fact.id,
      "correct",
      verdict === "correct" ? 1 : -1,
      "extraction",
    );
  }

  sessionVotedIds.value = new Set(sessionVotedIds.value).add(fact.id);
  verdictGiven.value = true;

  if (verdict === "incorrect") {
    // Hold the card so the reviewer can say what is wrong with it; "Dalej"
    // moves on whether or not they write anything.
    commentOpen.value = true;
    return;
  }
  advance();
}

function advance() {
  const fact = currentFact.value;
  const text = comment.value.trim();
  if (fact?.id && text) saveCommentOnce(fact.id, text, "extraction");

  comment.value = "";
  commentOpen.value = false;
  verdictGiven.value = false;

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

// Deep-link: honour ?fact=<id> on load, then keep the URL in sync so the card
// is shareable. Waits for persisted votes so the first card is unreviewed.
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

// Reflect subsequent fact changes (after each vote) in the URL
// and sync the initial fact on mount, which a plain watcher misses when the
// data is already present at setup (no undefined→fact transition).
watch(currentFact, syncUrlToFact);
onMounted(() => syncUrlToFact(currentFact.value));
</script>

<style scoped>
.kategoryzacja-container {
  max-width: 600px;
}

/* Let the title ellipsize instead of pushing the back button off the row. */
.header-text {
  min-width: 0;
}

/* A phone has the least room to spare above the card. */
@media (max-width: 599px) {
  .kategoryzacja-container {
    padding-top: 8px;
  }
}

.swipe-area {
  max-width: 480px;
}

.comment-section,
.related-section {
  max-width: 480px;
}
</style>
