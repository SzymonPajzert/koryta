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
    <!-- How the facts are judged, behind the heading's „(i)” as the notes'
         instructions are. „Ten tekst podobnie jak w notatce powinien być
         domyślnie schowany bo robi bloat” was said of the four sentences that
         stood here; none of them is deleted. Signed in only - it explains
         buttons a logged out reader is not shown. -->
    <template v-if="user" #info>
      Przypisane do tej osoby po imieniu i nazwisku. Kliknij fakt, żeby zobaczyć
      cytat z artykułu, i oceń go przyciskami pod cytatem, a jeśli dotyczy kogoś
      innego, zgłoś to przyciskiem „To nie ta osoba”. Ten sam fakt z kilku
      artykułów jest jednym wierszem, z cytatem z każdego z nich. Fakt, który
      się potwierdza, możesz przenieść do swojej notatki przyciskiem „Dodaj do
      notatki”, a zatrudnienie albo relację z drugą osobą zapisać w grafie
      przyciskiem „Utwórz powiązanie”.
    </template>

    <template #lead>
      <!-- Said out loud, because the facts look like the rest of the page and
           are not the same kind of claim: the register above is sourced and
           reviewed, these are a model's reading of a newspaper, matched to
           this person by name and not yet judged by anybody. That much stays
           in the open; the how-to is in the bubble above. -->
      <p v-if="user" class="k-lead" data-testid="person-extractions-lead">
        Automatycznie wyszukane w prasie - mogą być błędne.
      </p>
      <p v-else class="k-lead" data-testid="person-extractions-count">
        Znaleźliśmy
        <strong>{{ polishCounting(total, ...FACT_FORMS) }}</strong>
        o tej osobie w artykułach prasowych. Ponieważ nie są jeszcze sprawdzone,
        pokazujemy je tylko zalogowanym osobom.
      </p>
    </template>

    <!-- Where a new page starts reading from - see `goToPage`. -->
    <div ref="pageTop" class="facts-page-top" />

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
        Wszystkie ({{ groups.length }})
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
             heading saying „nobody has checked these" over every fact the
             person has is the lead paragraph again, in smaller type. Whether
             there is is decided over the whole list, not the page, so a page
             of nothing but unchecked facts still says which side it is on. -->
        <h4
          v-if="bucket.heading"
          class="facts-bucket"
          :data-testid="`person-extractions-${bucket.key}`"
        >
          {{ bucket.heading }}
        </h4>
        <!-- A line per claim, opened on a click - see `ExtractionFactRow`.
             Everything that costs something waits for a line to be opened,
             so a page of them mounts no buttons at all until somebody reads
             one. What opens is still cheap: the verdicts are
             `ExtractionQuickVerdict` rather than `ExtractionVoteButtons`,
             which would subscribe to the fact's vote document, and „Dodaj do
             notatki” reads this person's notes, which `NoteEditor` above has
             open anyway.

             „Utwórz powiązanie” is in every line that can become a relation:
             a note keeps the quote, a relation puts the fact in the graph, and
             „Brakuje chyba jeszcze promocji do krawędzi” was said of a page
             that offered the one and not the other. The same gate as the
             queue and the article's page - signed in, which every reader of
             these lines is - and the same draft: the relation waits for an
             administrator like one added with „Dodaj” above. -->
        <AdminRowList class="facts-list">
          <ExtractionFactRow
            v-for="group in bucket.groups"
            :key="group.key"
            :group="group"
            :node-id="nodeId"
            :muted="bucket.muted"
            @promoted="emit('promoted', $event)"
          />
        </AdminRowList>
      </template>

      <!-- „Pokazujemy 24 najnowszych z 66 -> dlaczego tylko 24? Nie ma sposobu
           na przejrzenie wszystkiego” - and from a phone, where 24 cards stood
           one under another: „max 6 było i dalej już strony, inaczej ciężko
           dojść do sekcji dyskusja”. Below the lines, where a reader who got
           to the end of a page is. The labels are Polish by hand: this app
           gives Vuetify no locale, and its own would read „Go to page 2”. -->
      <v-pagination
        v-if="pageCount > 1"
        :model-value="currentPage"
        :length="pageCount"
        density="comfortable"
        class="mt-2"
        aria-label="Strony faktów"
        page-aria-label="Przejdź do strony {0}"
        current-page-aria-label="Bieżąca strona, strona {0}"
        previous-aria-label="Poprzednia strona"
        next-aria-label="Następna strona"
        data-testid="person-extractions-pages"
        @update:model-value="goToPage"
      />
    </template>

    <!-- Locked, in the shape of the thing being withheld.
         The blur is decoration over placeholder bars, not over the facts: the
         endpoint is asked for the count alone (`countOnly`), so the sentences
         never reach this page. Blurring real text would put unverified claims
         about a named person into the html of their canonical, indexed url and
         call it hidden - `filter` is a paint instruction, not an access rule. -->
    <div v-else class="locked" data-testid="person-extractions-locked">
      <div class="locked__blur" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="locked__line">
          <div class="locked__bar locked__bar--icon" />
          <div class="locked__bar locked__bar--claim" />
          <div class="locked__bar locked__bar--meta" />
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
      Pokazujemy {{ facts.length }} najnowszych faktów z {{ total }}.
    </p>
  </PageSection>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { mdiTextSearchVariant } from "@mdi/js";
import { useExtractions } from "~/composables/extractions";
import { polishCounting } from "~/composables/polish";
import { useAuthState } from "~/composables/auth";
import {
  FACT_TYPE_COLORS,
  FACT_TYPE_LABELS,
  factGroupState,
  groupFacts,
  type FactGroup,
  type FactReviewState,
} from "~/utils/extraction";
import type { ExtractionFact, ExtractionFactType } from "~~/shared/model";

const { nodeId } = defineProps<{
  /** The person whose page this is. Matched on the id the pipeline resolved at
   * ingest, never on the name: two people share one often enough that a name
   * would hand this page somebody else's facts. */
  nodeId: string;
}>();

const emit = defineEmits<{
  /** A fact became a relation of this person. The page owns the list of their
   * relations, so re-reading it - to show the new draft - is its call. */
  promoted: [edgeId: string];
}>();

/** How many of a person's facts are fetched: all of them for everybody
 * measured, and for anybody past it the count under the list says how many are
 * left out. Counted on 2026-09-25: of the 150 person pages read most in six
 * months, 142 have 24 facts or fewer - for them this reads what the old limit of
 * 24 did - and the most among them is 115; the most found on anybody is 141.
 * Weighted by views that is five and a half reads a person view where it was
 * three and a half. Clear of 141 on purpose: a cap under it would bring „nie ma
 * sposobu na przejrzenie wszystkiego” back for the people written about most.
 *
 * The page is cut here rather than by the endpoint, which could serve one
 * (`page`). The type chips count, and the confirmed facts go first, over
 * everything this person has; asked for a page at a time, both would describe
 * that page alone - „Wszystkie (24)” over a person with 66, and a confirmed
 * fact left on page three for being older. The endpoint pages with a Firestore
 * offset, which bills every document it skips, so reaching the third page of
 * 24 would read 72 documents where this reads 66 once. A signed in reader is
 * served uncached either way. */
const LIMIT = 200;

/** Lines on one page. The desktop keeps the 24 cards it always showed; a phone
 * gets the six it was asked for - „max 6 było i dalej już strony” - when every
 * fact was a card standing under the last and 24 of them put the discussion
 * under this section out of reach. A closed line is a fraction of a card, so
 * both leave the list shorter than it was. */
const PAGE_SIZE = { desktop: 24, phone: 6 };

/** Singular, plural and genitive plural, as `polishCounting` takes them. */
const FACT_FORMS: [string, string, string] = ["fakt", "fakty", "faktów"];

const route = useRoute();
const { user } = useAuthState();
const { mdAndUp } = useDisplay();

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

/** Every claim the facts make, with the articles each was read from - see
 * `groupFacts`. What the reader is shown, so it is what everything below
 * counts, sorts and pages: two articles saying one thing are one line, one
 * chip count and one place on a page. */
const groups = computed<FactGroup[]>(() => groupFacts(facts.value));

/** „all" rather than undefined, so the chip row can be `mandatory` and the
 * unfiltered state is a chip you can see rather than the absence of one. */
const selectedType = ref<ExtractionFactType | "all">("all");

/** Only the types this person actually has, in the order the labels are
 * declared, so the row reads the same way on every page. Counted over what was
 * fetched rather than over `total`, which is what the chips are filtering, and
 * in lines: a claim is of one kind, since the kind is part of what makes two
 * facts one claim, so a chip keeps or drops whole lines. */
const typeCounts = computed(() =>
  (Object.keys(FACT_TYPE_LABELS) as ExtractionFactType[])
    .map((type) => ({
      type,
      count: groups.value.filter((group) => group.fact.fact_type === type)
        .length,
    }))
    .filter((entry) => entry.count > 0),
);

// Signing in swaps the count-only request for the real one, so the set of
// types arrives after the first render; a selection that is no longer offered
// would leave an empty list under a heading.
watch(typeCounts, (entries) => {
  if (
    selectedType.value !== "all" &&
    !entries.some((entry) => entry.type === selectedType.value)
  ) {
    selectedType.value = "all";
  }
});

const shownGroups = computed<FactGroup[]>(() =>
  selectedType.value === "all"
    ? groups.value
    : groups.value.filter(
        (group) => group.fact.fact_type === selectedType.value,
      ),
);

/** What nobody has judged first, then what readers rejected. `sort` is stable,
 * so inside each rank the endpoint's newest-first order survives. */
const OPEN_RANK: Record<FactReviewState, number> = {
  confirmed: -1,
  unreviewed: 0,
  disputed: 1,
};

/** A claim is confirmed once one article's quote of it is - see
 * `factGroupState`. */
const isConfirmed = (group: FactGroup) => factGroupState(group) === "confirmed";

const confirmedGroups = computed(() => shownGroups.value.filter(isConfirmed));
const openGroups = computed(() =>
  shownGroups.value
    .filter((group) => !isConfirmed(group))
    .sort(
      (a, b) => OPEN_RANK[factGroupState(a)] - OPEN_RANK[factGroupState(b)],
    ),
);

/** Whether there is something on both sides of the confirmed line. A split
 * needs both halves to mean anything, and today almost every person's facts
 * are entirely unjudged. */
const split = computed(
  () => confirmedGroups.value.length > 0 && openGroups.value.length > 0,
);

/** Every line in the order it is read, which is the order the pages cut. */
const ordered = computed(() =>
  split.value
    ? [...confirmedGroups.value, ...openGroups.value]
    : shownGroups.value,
);

const pageSize = computed(() =>
  mdAndUp.value ? PAGE_SIZE.desktop : PAGE_SIZE.phone,
);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(ordered.value.length / pageSize.value)),
);

/** 1-based, as `v-pagination` counts. Clamped where it is read rather than
 * corrected by a watcher, so a list that shrinks under the reader - the
 * refetch after signing in - never renders an empty page first. */
const page = ref(1);
const currentPage = computed(() => Math.min(page.value, pageCount.value));

const pageGroups = computed(() =>
  ordered.value.slice(
    (currentPage.value - 1) * pageSize.value,
    currentPage.value * pageSize.value,
  ),
);

// A kind picked is a new list, read from its start: left on page two of the
// unfiltered one, a reader who picks a kind with four facts would be shown an
// empty list, or the clamp's last page.
watch(selectedType, () => {
  page.value = 1;
});

// Turning a phone, or narrowing a window across md, changes how many lines a
// page holds. The reader stays on the page with the line they were reading
// first, rather than on whichever page now carries the old number.
// Where they were is clamped against the old size, not read off `currentPage`,
// which by now is clamped against the new one: page five of six, widened, would
// come out as page one of 24 rather than two.
watch(pageSize, (size, previous) => {
  const previousCount = Math.max(1, Math.ceil(ordered.value.length / previous));
  const firstShown = (Math.min(page.value, previousCount) - 1) * previous;
  page.value = Math.floor(firstShown / size) + 1;
});

const pageTop = ref<HTMLElement | null>(null);

/** Turns the page, and brings its first line into view.
 *
 * The pager is under the lines, so whoever uses it is at the bottom of the
 * page they are leaving, and the next one would open at its end. Only when the
 * top of the list has scrolled away, though: a short page is in view pager and
 * all, and jumping it would be the page moving on its own. */
async function goToPage(next: number) {
  page.value = next;
  await nextTick();
  const top = pageTop.value;
  if (top && top.getBoundingClientRect().top < 0) {
    top.scrollIntoView({ block: "start" });
  }
}

/** The blocks the lines on this page are laid out in.
 *
 * Two framed lists rather than one with a heading inside it, so each half is
 * its own run of lines under its own heading. One unlabelled block while
 * everything is on the same side of the line. A page holding one side of it
 * only shows that block, heading and all, so the unchecked facts on page two
 * are still called that. */
const buckets = computed(() =>
  split.value
    ? [
        {
          key: "confirmed",
          heading: "Potwierdzone przez czytelników",
          muted: false,
          groups: pageGroups.value.filter(isConfirmed),
        },
        {
          key: "open",
          heading: "Jeszcze niesprawdzone",
          muted: true,
          groups: pageGroups.value.filter((group) => !isConfirmed(group)),
        },
      ].filter((bucket) => bucket.groups.length > 0)
    : [
        {
          key: "all",
          heading: "",
          muted: false,
          groups: pageGroups.value,
        },
      ],
);
</script>

<style scoped>
/* Sub-heading over a block of lines. Quieter than the section's own heading -
   it separates two halves of one list rather than announcing a new section. */
.facts-bucket {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  margin-top: 8px;
  text-transform: uppercase;
}

/* Clear of the heading or the chips above it, and of the pager or the next
   block below. */
.facts-list {
  margin-block: 8px;
}

/* Clear of the sticky app bar when a new page scrolls to it - the allowance
   the help page gives its headings. */
.facts-page-top {
  scroll-margin-top: 96px;
}

/* The heading and the lead are `PageSection`'s, drawn from the global rules in
   `app.vue`. What is left here is the shape of what is being withheld. */
.locked {
  position: relative;
}

.locked__blur {
  /* The frame `AdminRowList` draws round the lines. */
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  /* Enough of the shape to read as "facts are behind this", little enough that
     nobody mistakes the bars for content. */
  filter: blur(4px);
  opacity: 0.55;
  pointer-events: none;
  user-select: none;
}

/* A closed line of the list, at its height. */
.locked__line {
  align-items: center;
  display: flex;
  gap: 12px;
  min-height: 44px;
  padding: 0 16px;
}

.locked__line + .locked__line {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.locked__bar {
  background: rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 3px;
  height: 10px;
}

.locked__bar--icon {
  border-radius: 50%;
  height: 16px;
  width: 16px;
}

.locked__bar--claim {
  height: 12px;
  width: 55%;
}

.locked__bar--meta {
  margin-left: auto;
  width: 15%;
}

.locked__gate {
  align-items: center;
  display: flex;
  inset: 0;
  justify-content: center;
  position: absolute;
}
</style>
