<template>
  <HomeHeading
    title="Co nowego"
    subtitle="Ostatnie stanowiska i okrągłe staże, od najświeższego. Kliknij kafelek, żeby zobaczyć stronę tej osoby."
  />

  <!-- Always a button, never an intersect sentinel. An auto-loading feed makes
       the page infinite, and everything under it - the footer, which is where
       the contact address and the source links live - is pushed further away
       every time the reader scrolls towards it, so it can never be reached at
       all. Asking from the first page is also the cheaper default: a reader who
       scrolls past the first screen on their way somewhere else costs nothing. -->
  <v-infinite-scroll
    v-if="items.length > 0"
    class="event-feed"
    data-testid="home-event-feed"
    empty-text="To już wszystko, co wiemy."
    load-more-text="Pokaż więcej"
    mode="manual"
    @load="loadMore"
  >
    <div class="event-feed__grid">
      <!-- One `v-for` over the merged list rather than one per kind, which is
           the whole point of merging: the cards are in date order across the
           streams, so nothing can group them by type without also losing that
           order. A `template` here and not a wrapper div - the grid's items
           have to be the cards themselves.
           `--folded` marks the second half of the first page, which a narrow
           screen keeps out of sight until the first „Pokaż więcej” - see
           `folded`. -->
      <template v-for="(item, index) in shownItems" :key="item.key">
        <CardEmployment
          v-if="item.kind === 'employment'"
          :employment="item.employment"
          :class="{ 'event-feed__card--folded': folded && index >= ROWS }"
        />
        <CardServiceMilestone
          v-else
          :milestone="item.milestone"
          festive
          :class="{ 'event-feed__card--folded': folded && index >= ROWS }"
        />
      </template>
    </div>
  </v-infinite-scroll>

  <!-- Only ever seen on a client-side navigation into the home page: under SSR
       Nuxt settles the fetch before it renders, so the list arrives with the
       document. -->
  <div v-else-if="status === 'pending'" class="text-center py-8">
    <v-progress-circular indeterminate />
  </div>

  <!-- Not the infinite scroll's own `empty-text`: that one ends a list somebody
       has scrolled, and this is the whole section having nothing to show -
       which on a working site only happens against a fresh local stack. -->
  <v-alert
    v-else
    data-testid="home-event-feed-empty"
    text="Nie znamy jeszcze żadnego zatrudnienia z datą rozpoczęcia ani okrągłego stażu."
    type="info"
    variant="tonal"
  />
</template>

<script lang="ts" setup>
import { authFetch } from "~/composables/auth";
import { interleaveByDate } from "~~/shared/eventFeed";
import type { DatedEvent } from "~~/shared/eventFeed";
import type {
  RecentEmployment,
  RecentEmployments,
} from "~~/server/api/edges/recentEmployments.get";
import type {
  ServiceMilestone,
  ServiceMilestones,
} from "~~/server/api/edges/serviceMilestones.get";

/** Everything the feed can draw.
 *
 * A discriminated union rather than a common card shape, because the cards do
 * not have a common shape: an employment says who took which post, a milestone
 * says how many years somebody has now served across all of them, and flatting
 * both into one row type would mean a card full of fields that are null for
 * every other kind. The next event we find gets a `kind` of its own and a
 * branch in the template above.
 */
type FeedItem = DatedEvent &
  (
    | { kind: "employment"; employment: RecentEmployment }
    | { kind: "milestone"; milestone: ServiceMilestone }
  );

/** How many employments one request asks for. More than the first page
 * shows (`FIRST_PAGE`), so that the first page always has the cards to fill
 * its rows whatever the milestones add, and a desktop's first „Pokaż więcej”
 * has some in hand before it has to ask for more. */
const PAGE_SIZE = 20;

/** Rows of cards the feed opens on, and rows each „Pokaż więcej” adds - on a
 * desktop's two columns and a phone's one alike.
 *
 * Counted in rows, because the length of the page is what readers asked about:
 * the whole first request used to be drawn, 20 employments and every
 * anniversary between them - 37 cards on 2026-09-29, over twelve screens on a
 * 393x650 phone and four and a half on a 1440x795 desktop before the footer
 * came into view. „Nie da się zobaczyć co jest na dole strony”, and from the
 * phone „za dużo kandydatów pokazuje, zmniejszyłbym to 4 razy”. */
const ROWS = 8;

/** Cards on the first page: `ROWS` rows of the desktop's two columns. The
 * server renders this many for every reader - it has no viewport to ask, and a
 * count that depended on one would make the page jump as it hydrated - and a
 * narrow screen folds the half it has no rows for out of sight. */
const FIRST_PAGE = ROWS * 2;

/** The width the grid below drops to one column at: under Vuetify's `md`, as
 * in the style block, which has to say it again because css cannot read this.
 * Only ever asked in the click handler, where there is a window to answer. */
const ONE_COLUMN = "(max-width: 959.98px)";

const EMPLOYMENTS_ENDPOINT = "/api/edges/recentEmployments";
const MILESTONES_ENDPOINT = "/api/edges/serviceMilestones";

/** The `useAsyncData` keys the first page is stored under, and so what the
 * server hands the browser in the payload. */
const EMPLOYMENTS_KEY = "home-recent-employments";
const MILESTONES_KEY = "home-service-milestones";

/** Every milestone in one request, because there are never many: the endpoint
 * computes a window a month either side of today and „recent” is the half of
 * that behind us - 19 of them on the 2026-09-09 export.
 *
 * It is also all of them the feed can ever need, however far the reader
 * scrolls. The window stops thirty days back, so no page of employments
 * reaching further can turn up a milestone this request did not already carry;
 * a milestone still held back is one waiting for the spine to reach its date,
 * not one waiting to be fetched.
 *
 * 50 is the endpoint's own ceiling. Past it the feed would quietly miss the
 * oldest few, which beats paging a second cursor through a component for a
 * case a month of anniversaries has never come close to.
 */
const MILESTONE_LIMIT = 50;

const route = useRoute();

/** `latest` is carried through from the page's own url rather than only being
 * added by `authFetch` for a signed in reader, because `authFetch` adds it in
 * the browser and this section is rendered on the server. Without it there is
 * no way to ask the home page for a feed newer than the response cache, which
 * is what somebody checking that an ingest landed actually wants. */
const latest = computed(() =>
  route.query.latest === undefined ? {} : { latest: route.query.latest },
);

const query = computed(() => ({ limit: PAGE_SIZE, ...latest.value }));

// Not awaited, and still server rendered: Nuxt settles every `useAsyncData` -
// which is what `authFetch` is underneath - before it serialises the page. The
// difference is on a client-side navigation into the home page, where awaiting
// would hold the whole route on this one section.
const { data, status } = authFetch<RecentEmployments>(EMPLOYMENTS_ENDPOINT, {
  query,
  // Named rather than left to key on the url: `useFetch` aborts the earlier
  // call when a second one lands on the same key, so an unnamed one ties this
  // section's fate to any other caller that happens to want the same page.
  key: EMPLOYMENTS_KEY,
});

// Deliberately not awaited and deliberately not guarded: `useFetch` puts a
// failure in `error` rather than throwing, so a milestone endpoint that is
// down leaves `data` null, `milestones` empty and a home page that is still a
// feed of jobs. The employments are the spine; the anniversaries are garnish
// and must not be able to take the section with them.
const { data: milestoneData } = authFetch<ServiceMilestones>(
  MILESTONES_ENDPOINT,
  {
    query: computed(() => ({
      limit: MILESTONE_LIMIT,
      scope: "recent",
      ...latest.value,
    })),
    key: MILESTONES_KEY,
  },
);

/** The pages after the first. The first stays in `data` so that a refetch -
 * which is what signing in triggers, `authFetch` adding `latest` to the query
 * - replaces it instead of being appended to what is already on screen. */
const more = ref<RecentEmployment[]>([]);
const cursor = ref<string | null>(null);

watch(
  data,
  () => {
    more.value = [];
    cursor.value = data.value?.nextCursor ?? null;
  },
  { immediate: true },
);

const employments = computed(() => [
  ...(data.value?.employments ?? []),
  ...more.value,
]);

/** The spine: the stream that pages, in the order the endpoint sent it.
 *
 * `start_date` is the date the feed places it by, not when the row was
 * written - the reader is being shown who has just taken a post. */
const employmentEvents = computed<FeedItem[]>(() =>
  employments.value.map((employment) => ({
    kind: "employment",
    key: `employment:${employment.id}`,
    date: employment.start_date,
    employment,
  })),
);

/** The guests. Keyed on the milestone's own id, which is already
 * `${personId}:${years}` - prefixed anyway, because a feed keyed across two
 * collections cannot rely on two id schemes never meeting. */
const milestoneEvents = computed<FeedItem[]>(() =>
  (milestoneData.value?.milestones ?? []).map((milestone) => ({
    kind: "milestone",
    key: `milestone:${milestone.id}`,
    date: milestone.date,
    milestone,
  })),
);

const items = computed(() =>
  interleaveByDate(employmentEvents.value, milestoneEvents.value, {
    // No cursor left means the employments have run out, which is when the
    // milestones older than the last of them are finally safe to draw.
    //
    // `pending` has to be excluded or the feed says "exhausted" before it has
    // asked anything: `cursor` starts null and only gets its value when the
    // first page lands. Whichever response arrives first would then be drawn
    // alone for a frame, and on a client-side navigation into the home page
    // that frame is a screen of nothing but anniversaries.
    spineExhausted: cursor.value === null && status.value !== "pending",
  }),
);

/** How many cards of the merged feed are in the grid. The same number on the
 * server and in the browser until somebody clicks, so hydration finds the
 * document it would have drawn itself.
 *
 * A cut through the merged list rather than a smaller `PAGE_SIZE`: the
 * anniversaries are what makes a page long or short - none some months, 17 on
 * 2026-09-29 - and eight employments would still have drawn nineteen cards
 * that day. The cut is also always stable: the merge only ever adds below the
 * last employment it has, so the top of the feed never moves under it. */
const shown = ref(FIRST_PAGE);

/** Whether a narrow screen still holds back the second half of the first page.
 *
 * Folded with css (`event-feed__card--folded`) rather than rendered short: a
 * phone gets the same sixteen cards in its document as a desktop and shows the
 * first `ROWS`, so the page it hydrates is the page it was sent, and nothing
 * shifts when the script arrives. The first „Pokaż więcej” unfolds them, on
 * any screen - on a wide one they were never hidden. */
const folded = ref(true);

const shownItems = computed(() => items.value.slice(0, shown.value));

/** Nothing left to show or to ask for. The cursor alone is not enough, because
 * cards can be in hand without being shown yet. */
const exhausted = () =>
  cursor.value === null && shown.value >= items.value.length;

type LoadOptions = { done: (status: "ok" | "empty" | "error") => void };

/** Requests one click is allowed to make before it gives up and returns.
 *
 * The endpoint stops scanning at a fixed budget and answers short rather than
 * reading the whole collection, so a page can come back with no cards and a
 * cursor - and a button that loads nothing looks broken. Bounded, because the
 * same answer repeated is what an infinite feed used to do on its own, once per
 * animation frame. */
const MAX_REQUESTS_PER_LOAD = 3;

/** `ROWS` more rows, once the reader has asked for them: from the cards already
 * in hand first, and from the next page of employments when those run short.
 *
 * Only the employments page is ever fetched. The milestones came whole and are
 * already placed; scrolling reaches further back in time, and there is nothing
 * behind the window they were computed over.
 *
 * Plain `$fetch` rather than `authFetch`, which is a `useFetch` and so cannot
 * be called for a page somebody asked for with a click. Nothing is lost by it:
 * the endpoint answers with published employments whoever asks, and `latest`
 * would only skip the response cache.
 */
async function loadMore({ done }: LoadOptions) {
  const oneColumn = window.matchMedia(ONE_COLUMN).matches;

  // A phone's first click shows the half of the first page it folded away.
  // Those are its next eight rows and already here - growing the cut as well
  // would put sixteen more under a reader who asked for the next few.
  if (folded.value) {
    folded.value = false;
    if (oneColumn && items.value.length > ROWS) {
      done(exhausted() ? "empty" : "ok");
      return;
    }
  }

  shown.value += ROWS * (oneColumn ? 1 : 2);
  if (items.value.length >= shown.value || !cursor.value) {
    done(exhausted() ? "empty" : "ok");
    return;
  }

  try {
    // A page can come back empty and still carry a cursor - the endpoint stops
    // scanning before it has filled one - so it is the cursor, not the count,
    // that says whether there is anything behind it. Asking again here rather
    // than handing an empty page back is the difference between a slow load and
    // one that appears to have done nothing.
    for (let request = 0; request < MAX_REQUESTS_PER_LOAD; request++) {
      const next: RecentEmployments = await $fetch<RecentEmployments>(
        EMPLOYMENTS_ENDPOINT,
        {
          query: { ...query.value, cursor: cursor.value },
        },
      );
      more.value.push(...next.employments);
      cursor.value = next.nextCursor;
      if (!next.nextCursor || next.employments.length > 0) break;
    }
    // Not "empty" merely because the cursor ran out: the last page can bring
    // more cards than this click shows, and those are the next click's.
    done(exhausted() ? "empty" : "ok");
  } catch {
    done("error");
  }
}
</script>

<style scoped>
/* The infinite scroll makes its root a scroll container, and a v-row's
   negative margins would hang 12px past it and raise a horizontal scrollbar
   inside the section. A grid with a gap owes nothing to the edges. */
.event-feed__grid {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
}

/* Vuetify's `md`, i.e. what `useDisplay().mdAndUp` answers true for. Written as
   a media query rather than read from `useDisplay` because the server has no
   viewport to answer with: the composable says "small" while rendering and the
   real width only on hydration, which is a layout that visibly jumps. */
@media (min-width: 960px) {
  .event-feed__grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* One column: the first page's second half waits for „Pokaż więcej”, so a
   phone opens on as many rows as a desktop does. Hidden here rather than left
   out of the render, for the reason the columns above are a media query. The
   width is `ONE_COLUMN` in the script. */
@media (max-width: 959.98px) {
  .event-feed__card--folded {
    display: none;
  }
}
</style>
