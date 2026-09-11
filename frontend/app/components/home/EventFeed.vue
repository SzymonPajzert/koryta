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
           have to be the cards themselves. -->
      <template v-for="item in items" :key="item.key">
        <CardEmployment
          v-if="item.kind === 'employment'"
          :employment="item.employment"
        />
        <CardServiceMilestone v-else :milestone="item.milestone" festive />
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

/** How many employments a page carries. Two columns on a desktop, so an even
 * number leaves no half row behind while the next one is loading. */
const PAGE_SIZE = 20;

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

type LoadOptions = { done: (status: "ok" | "empty" | "error") => void };

/** Requests one click is allowed to make before it gives up and returns.
 *
 * The endpoint stops scanning at a fixed budget and answers short rather than
 * reading the whole collection, so a page can come back with no cards and a
 * cursor - and a button that loads nothing looks broken. Bounded, because the
 * same answer repeated is what an infinite feed used to do on its own, once per
 * animation frame. */
const MAX_REQUESTS_PER_LOAD = 3;

/** The next page of employments, once the reader has asked for one.
 *
 * Only the employments page. The milestones came whole and are already placed;
 * scrolling reaches further back in time, and there is nothing behind the
 * window they were computed over.
 *
 * Plain `$fetch` rather than `authFetch`, which is a `useFetch` and so cannot
 * be called for a page somebody asked for with a click. Nothing is lost by it:
 * the endpoint answers with published employments whoever asks, and `latest`
 * would only skip the response cache.
 */
async function loadMore({ done }: LoadOptions) {
  if (!cursor.value) {
    done("empty");
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
      if (!next.nextCursor) {
        done("empty");
        return;
      }
      if (next.employments.length > 0) break;
    }
    done("ok");
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
</style>
