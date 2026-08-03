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
        <div v-if="!loading" class="text-caption text-medium-emphasis">
          Pozostało do oceny: {{ remaining }}
        </div>
      </div>
    </div>

    <div v-if="loading" class="d-flex justify-center py-8">
      <v-progress-circular indeterminate color="primary" size="48" />
    </div>

    <!-- A failed fetch leaves the same empty list as a cleared backlog, and the
         SSR one never reaches the network tab — so say which it was. -->
    <div v-else-if="error" class="py-8 text-center">
      <v-alert type="error" variant="tonal">
        Nie udało się załadować faktów do kategoryzacji.
      </v-alert>
    </div>

    <!-- A shared card is worth showing even when nothing is left to review. -->
    <div
      v-else-if="!currentFact && allFacts.length === 0"
      class="py-8 text-center"
    >
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

        <!-- Two ways to run out: the loaded page is spent (more waits behind
             it), or the backlog itself is empty. -->
        <div v-else-if="remaining > 0" class="text-center py-8">
          <v-icon size="64" color="primary" class="mb-4">{{
            mdiCheckAll
          }}</v-icon>
          <div class="text-h6">Ta porcja przejrzana!</div>
          <div class="text-body-2 text-medium-emphasis mt-1">
            Zostało jeszcze {{ remaining }} do oceny.
          </div>
          <v-btn class="mt-4" color="primary" variant="tonal" @click="loadMore">
            Wczytaj kolejne
          </v-btn>
        </div>

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

        <!-- Comment: opened by the button above and never by a verdict, so the
             card the reviewer is commenting on is one they asked to hold. The
             verdict that follows saves it and moves on. -->
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
            <span class="text-caption text-medium-emphasis py-2">
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
  mdiCheckAll,
  mdiCheckCircleOutline,
  mdiCloseCircleOutline,
  mdiCommentTextOutline,
  mdiHelpCircleOutline,
} from "@mdi/js";
import { useDisplay } from "vuetify";
import { collection, query, where } from "firebase/firestore";
import { useCollection, useCurrentUser, useIsCurrentUserLoaded } from "vuefire";
import { useExtraction, useExtractions } from "~/composables/extractions";
import { castVoteOnce, saveCommentOnce } from "~/composables/votes";
import { factSubject } from "~/utils/extraction";
import type { ExtractionFact, VoteDocument } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});
useHead({
  title: "Kategoryzacja faktów - koryta.pl",
});

// One page of the unreviewed backlog at a time — enough swipes that few
// sittings reach the end of it — and `total` says what waits behind.
const PAGE_SIZE = 200;
const page = ref(0);
const { data, pending, error } = useExtractions({
  reviewed: "no",
  limit: PAGE_SIZE,
  page,
});
const route = useRoute();
const router = useRouter();
const { smAndUp } = useDisplay();

// The URL tracks the current card from here on (see syncUrlToFact), so the
// shared id is read once, at load. Fetching it by id is what keeps a link
// working after somebody reviews the fact: the page above holds unreviewed
// facts only.
const sharedId = typeof route.query.fact === "string" ? route.query.fact : null;
const { fact: linkedFact, settled: linkedSettled } = useExtraction(sharedId);

// All votable facts (an id is required to vote), newest ingest first — the
// API returns the page ordered by createdAt descending.
const allFacts = computed<ExtractionFact[]>(() =>
  (data.value?.facts ?? []).filter((f) => f.id),
);

const user = useCurrentUser();
const isAuthLoaded = useIsCurrentUserLoaded();
const db = appFirestore();
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

// One reviewer per fact — a fact any user has reviewed counts as done, so
// concurrent reviewers spread over the backlog instead of piling up — is now
// the `reviewed: "no"` filter's job, and what is left to merge here is this
// reviewer's own verdicts, which the aggregate may not have caught up with.
const votedIds = computed(
  () => new Set([...serverVotedIds.value, ...sessionVotedIds.value]),
);

// The votes collection also holds other node types, so count only facts on
// this page.
const votedOnPage = computed(
  () => allFacts.value.filter((f) => votedIds.value.has(f.id!)).length,
);

// The server counted what was unreviewed when the page was fetched, so verdicts
// it has not caught up with — this session's, or ones the trigger has yet to
// aggregate — are still in that total. They are exactly the loaded facts we
// already know a vote for.
const remaining = computed(() =>
  Math.max(0, (data.value?.total ?? 0) - votedOnPage.value),
);

// Walking the offset, rather than refetching page 0, is what guarantees cards
// the reviewer has not just judged: the aggregate this filter reads lags the
// vote trigger, so page 0 can still hold the facts they spent the last hour on.
// The cost is that once the trigger does catch up the offset overshoots and
// skips a stretch of backlog — which the next visit, starting at page 0 again,
// serves first.
function loadMore() {
  page.value += 1;
}

// Hold the spinner until facts and the user's existing votes are in, else the
// first card flashes an already-reviewed fact.
const votesReady = computed(
  () => isAuthLoaded.value && (!user.value || !votesPending.value),
);
// SSR can't know the user's votes, so render the spinner — matching the
// client's first (hydration) render; rendering the card instead would cause a
// hydration mismatch.
const loading = computed(
  () =>
    import.meta.server ||
    pending.value ||
    !votesReady.value ||
    !linkedSettled.value,
);

// The fact currently under review, tracked by id (not index) so we can jump to
// a related fact next while keeping context — see recordVote(). The shared
// card is not in the page when somebody has already reviewed it, so it is
// looked up alongside.
const currentId = ref<string | null>(null);
const currentFact = computed<ExtractionFact | undefined>(
  () =>
    allFacts.value.find((f) => f.id === currentId.value) ??
    (linkedFact.value?.id === currentId.value
      ? (linkedFact.value ?? undefined)
      : undefined),
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

// The comment box is opt-in per card, and only the comment button opens it: a
// verdict that held the card back instead of advancing read as a dead button —
// "klikam i swipuje i nic się nie dzieje" — since on a phone the box it opened
// was below the fold. Whatever is typed here is saved by the verdict that
// follows.
const comment = ref("");
const commentOpen = ref(false);

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
  advance();
}

function advance() {
  const fact = currentFact.value;
  const text = comment.value.trim();
  if (fact?.id && text) saveCommentOnce(fact.id, text, "extraction");

  comment.value = "";
  commentOpen.value = false;

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

// Pick a card whenever the loaded page changes: on first load, honouring
// ?fact=<id> so a card is shareable, and again after `loadMore` swaps the page
// underneath us. Waits for persisted votes so the first card is unreviewed.
const initialized = ref(false);
watch(
  [allFacts, loading],
  ([facts, isLoading]) => {
    if (isLoading) return;

    if (!initialized.value) {
      initialized.value = true;
      // A shared card jumps the queue, reviewed or not.
      if (linkedFact.value?.id) {
        currentId.value = linkedFact.value.id;
        return;
      }
    } else if (currentFact.value) {
      // Mid-review on a card we can still show: leave the reviewer on it.
      return;
    }

    currentId.value = facts.find((f) => !votedIds.value.has(f.id!))?.id ?? null;
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
