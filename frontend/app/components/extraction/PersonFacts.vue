<template>
  <!-- Nothing matched and nothing withheld: no heading either, the same rule
       SuccessionPersonChanges follows. Most people in the graph are named in
       no analysed article at all, and a section that announces itself over
       empty space reads as a page that failed to load. An error is silent for
       the same reason - see `total` below.

       `px-2` arrives with the shell, and this section had been missing it: its
       heading started 8px left of the three above it on a person's page, which
       nobody had spotted while every section carried its own copy of the
       heading rules.

       The id is what the search box opens this page at (`#fakty`), for a name
       these facts carry - see `factNamePick`. -->
  <PageSection
    v-if="total > 0"
    :id="FACT_SECTION_ID"
    ref="section"
    title="Fakty z artykułów"
    :icon="mdiTextSearchVariant"
    class="mt-4 person-facts"
    data-testid="person-extractions"
  >
    <!-- How the cards are judged, behind the heading's „(i)” as the notes'
         instructions are. „Ten tekst podobnie jak w notatce powinien być
         domyślnie schowany bo robi bloat” was said of the four sentences that
         stood here; none of them is deleted. Signed in only - it explains
         buttons on cards a logged out reader is not shown. -->
    <template v-if="user" #info>
      Przypisane do tej osoby po imieniu i nazwisku. Oceń je przyciskami przy
      każdej karcie, a jeśli fakt dotyczy kogoś innego, zgłoś to przyciskiem „To
      nie ta osoba”. Fakt, który się potwierdza, możesz przenieść do swojej
      notatki przyciskiem „Dodaj do notatki”.
    </template>

    <template #lead>
      <!-- Said out loud, because the cards look like the rest of the page and
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

    <!-- Opened from the search box on a name that has no page of its own:
         only the facts that name them, and a way back to all of them. Said
         in words, because the chips below count what is left and would
         otherwise read as everything this person has. -->
    <div
      v-if="user && mention"
      class="d-flex align-center flex-wrap ga-2 mb-2"
      data-testid="person-extractions-mention"
    >
      <span class="text-body-2">Tylko fakty, w których pada nazwisko</span>
      <v-chip
        size="small"
        closable
        close-label="Pokaż wszystkie fakty"
        @click:close="clearMention"
      >
        {{ mention.name }}
      </v-chip>
    </div>

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
        Wszystkie ({{ named.length }})
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
                 subscription per card, and this section mounts a whole page of
                 cards at once rather than behind an expander the way
                 /ekstrakcje does.
                 Both it and the card's own "To nie ta osoba" flag are single
                 writes and open nothing.

                 „Dodaj do notatki” does read a collection, but the same one on
                 every card - this person's notes, which `NoteEditor` above has
                 open anyway - so it is one target for the page rather than one
                 per fact. -->
            <ExtractionCard
              :fact="fact"
              class="h-100"
              :muted="bucket.muted"
              link-article
            >
              <template #actions>
                <ExtractionAddToNoteButton :fact="fact" :node-id="nodeId" />
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

      <!-- „Pokazujemy 24 najnowszych z 66 -> dlaczego tylko 24? Nie ma sposobu
           na przejrzenie wszystkiego” - and from a phone, where 24 cards stood
           one under another: „max 6 było i dalej już strony, inaczej ciężko
           dojść do sekcji dyskusja”. Below the cards, where a reader who got
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
import {
  computed,
  nextTick,
  ref,
  watch,
  type ComponentPublicInstance,
} from "vue";
import { useDisplay } from "vuetify";
import { mdiTextSearchVariant } from "@mdi/js";
import { useExtractions } from "~/composables/extractions";
import { polishCounting } from "~/composables/polish";
import { useAuthState } from "~/composables/auth";
import { FACT_NAME_QUERY, FACT_SECTION_ID } from "~/composables/omniSearch";
import { factNameKey, factNamesPerson } from "~~/shared/factNames";
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

/** How many of a person's facts are fetched: all of them for everybody
 * measured, and for anybody past it the count under the cards says how many are
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

/** Cards on one page. The desktop keeps the 24 it always showed; a phone gets
 * six, because there the cards stand one under another and 24 of them put the
 * discussion under this section out of reach. */
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

const router = useRouter();

/** The name the search box sent this page for (`?fakty=Piotr Ferster`):
 * somebody these facts name who has no page of their own - see
 * /api/search/facts.
 *
 * Null when the facts name nobody by it, a stale link included: filtering on
 * it then would leave an empty section under a heading that says there are
 * facts, so the page shows all of them instead. */
const mention = computed(() => {
  const raw = route.query[FACT_NAME_QUERY];
  const name = typeof raw === "string" ? raw.trim() : "";
  const key = factNameKey(name);
  if (!key || !facts.value.some((fact) => factNamesPerson(fact, key))) {
    return null;
  }
  return { name, key };
});

/** What the rest of the section works on: the facts naming `mention`, or all
 * of them. The chips count these, so they describe the list on screen. */
const named = computed<ExtractionFact[]>(() => {
  const current = mention.value;
  return current
    ? facts.value.filter((fact) => factNamesPerson(fact, current.key))
    : facts.value;
});

/** Back to every fact, on the same page and at the same place in it. */
function clearMention() {
  const query = Object.fromEntries(
    Object.entries(route.query).filter(([key]) => key !== FACT_NAME_QUERY),
  );
  router.replace({ query, hash: route.hash });
}

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
      count: named.value.filter((fact) => fact.fact_type === type).length,
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
    ? named.value
    : named.value.filter((fact) => fact.fact_type === selectedType.value),
);

/** What nobody has judged first, then what readers rejected. `sort` is stable,
 * so inside each rank the endpoint's newest-first order survives. */
const OPEN_RANK: Record<FactReviewState, number> = {
  confirmed: -1,
  unreviewed: 0,
  disputed: 1,
};

const isConfirmed = (fact: ExtractionFact) =>
  factReviewState(fact) === "confirmed";

const confirmedFacts = computed(() => shownFacts.value.filter(isConfirmed));
const openFacts = computed(() =>
  shownFacts.value
    .filter((fact) => factReviewState(fact) !== "confirmed")
    .sort(
      (a, b) => OPEN_RANK[factReviewState(a)] - OPEN_RANK[factReviewState(b)],
    ),
);

/** Whether there is something on both sides of the confirmed line. A split
 * needs both halves to mean anything, and today almost every person's facts
 * are entirely unjudged. */
const split = computed(
  () => confirmedFacts.value.length > 0 && openFacts.value.length > 0,
);

/** Every card in the order it is read, which is the order the pages cut. */
const ordered = computed(() =>
  split.value
    ? [...confirmedFacts.value, ...openFacts.value]
    : shownFacts.value,
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

const pageFacts = computed(() =>
  ordered.value.slice(
    (currentPage.value - 1) * pageSize.value,
    currentPage.value * pageSize.value,
  ),
);

// A kind picked is a new list, read from its start: left on page two of the
// unfiltered one, a reader who picks a kind with four facts would be shown an
// empty grid, or the clamp's last page.
watch(selectedType, () => {
  page.value = 1;
});

// Turning a phone, or narrowing a window across md, changes how many cards a
// page holds. The reader stays on the page with the card they were reading
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

/** Turns the page, and brings its first card into view.
 *
 * The pager is under the cards, so whoever uses it is at the bottom of the
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

const section = ref<ComponentPublicInstance | null>(null);

// Opened for a name, the page goes to the facts that name them: the section
// sits under the relations and the graph, a long way down a busy person's
// page, and the reader came for this. Once the facts have arrived - they are
// fetched after sign-in resolves, often after the page has loaded - and again
// for another name picked from the search box while on this page, but not on
// a refetch of the same one, which would drag a reader back up mid-scroll.
// Facts that arrive before the page has loaded are the `#fakty` in the url's
// to bring into view: the router scrolls a new page to its top as it finishes,
// over anything done here first.
watch(
  () => mention.value?.key,
  async (key) => {
    if (!key) return;
    page.value = 1;
    await nextTick();
    (section.value?.$el as HTMLElement | undefined)?.scrollIntoView({
      block: "start",
    });
  },
);

/** The blocks the cards on this page are laid out in.
 *
 * Two rows rather than one list with a divider in it: the grid is two columns
 * wide from md up, and a line drawn inside it would land halfway down a
 * column. One unlabelled block while everything is on the same side of the
 * line. A page holding one side of it only shows that block, heading and all,
 * so the unchecked facts on page two are still called that. */
const buckets = computed(() =>
  split.value
    ? [
        {
          key: "confirmed",
          heading: "Potwierdzone przez czytelników",
          muted: false,
          facts: pageFacts.value.filter(isConfirmed),
        },
        {
          key: "open",
          heading: "Jeszcze niesprawdzone",
          muted: true,
          facts: pageFacts.value.filter((fact) => !isConfirmed(fact)),
        },
      ].filter((bucket) => bucket.facts.length > 0)
    : [
        {
          key: "all",
          heading: "",
          muted: false,
          facts: pageFacts.value,
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

/* Clear of the sticky app bar when a new page scrolls to it - the allowance
   the help page gives its headings. The section's own is for being opened at
   from the search box, heading and all; the router reads it off `#fakty` too. */
.facts-page-top,
.person-facts {
  scroll-margin-top: 96px;
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
