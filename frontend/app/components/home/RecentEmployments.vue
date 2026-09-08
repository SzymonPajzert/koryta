<template>
  <HomeHeading
    title="Ostatnie zatrudnienia"
    subtitle="Kto ostatnio objął stanowisko. Kliknij, żeby zobaczyć stronę tej osoby."
  />

  <!-- `mode` is not a constant: the feed loads a couple of pages on its own and
       then asks. An unbounded intersect feed makes the page infinite, and
       everything under it - the footer, which is where the contact address and
       the source links live - is pushed further away every time the reader
       scrolls towards it, so it can never be reached at all. -->
  <v-infinite-scroll
    v-if="employments.length > 0"
    class="employment-feed"
    data-testid="recent-employments"
    empty-text="To już wszystkie zatrudnienia, jakie znamy."
    load-more-text="Pokaż więcej zatrudnień"
    :mode="mode"
    @load="loadMore"
  >
    <div class="employment-feed__grid">
      <CardEmployment
        v-for="employment in employments"
        :key="employment.id"
        :employment
      />
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
    data-testid="recent-employments-empty"
    text="Nie znamy jeszcze żadnego zatrudnienia z datą rozpoczęcia."
    type="info"
    variant="tonal"
  />
</template>

<script lang="ts" setup>
import { authFetch } from "~/composables/auth";
import type {
  RecentEmployment,
  RecentEmployments,
} from "~~/server/api/edges/recentEmployments.get";

/** How many cards a page carries. Two columns on a desktop, so an even number
 * leaves no half row behind while the next one is loading. */
const PAGE_SIZE = 20;

const ENDPOINT = "/api/edges/recentEmployments";

/** The `useAsyncData` key the first page is stored under, and so what the
 * server hands the browser in the payload. */
const FIRST_PAGE_KEY = "home-recent-employments";

const route = useRoute();

/** `latest` is carried through from the page's own url rather than only being
 * added by `authFetch` for a signed in reader, because `authFetch` adds it in
 * the browser and this section is rendered on the server. Without it there is
 * no way to ask the home page for a feed newer than the response cache, which
 * is what somebody checking that an ingest landed actually wants. */
const query = computed(() => ({
  limit: PAGE_SIZE,
  ...(route.query.latest === undefined ? {} : { latest: route.query.latest }),
}));

// Not awaited, and still server rendered: Nuxt settles every `useAsyncData` -
// which is what `authFetch` is underneath - before it serialises the page. The
// difference is on a client-side navigation into the home page, where awaiting
// would hold the whole route on this one section.
const { data, status } = authFetch<RecentEmployments>(ENDPOINT, {
  query,
  // Named rather than left to key on the url: `useFetch` aborts the earlier
  // call when a second one lands on the same key, so an unnamed one ties this
  // section's fate to any other caller that happens to want the same page.
  key: FIRST_PAGE_KEY,
});

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

type LoadOptions = { done: (status: "ok" | "empty" | "error") => void };

/** How many pages the feed fetches by itself before it starts asking.
 *
 * Two, so that scrolling past the first screen still feels like a feed, and the
 * page still ends. */
const AUTO_PAGES = 2;

/** Requests one click is allowed to make before it gives up and returns.
 *
 * The endpoint stops scanning at a fixed budget and answers short rather than
 * reading the whole collection, so a page can come back with no cards and a
 * cursor - and a button that loads nothing looks broken. Bounded, because the
 * same answer repeated is what an infinite feed used to do on its own, once per
 * animation frame. */
const MAX_REQUESTS_PER_LOAD = 3;

const autoLoaded = ref(0);

/** Automatic while the count is under the budget, a button after it. Reading
 * it every render is what lets it change: Vuetify checks `mode` when it decides
 * whether to draw the sentinel and again before it chains the next load. */
const mode = computed(() =>
  autoLoaded.value < AUTO_PAGES ? "intersect" : "manual",
);

/** The next page, once the reader has scrolled far enough to want one.
 *
 * Plain `$fetch` rather than `authFetch`, which is a `useFetch` and so cannot
 * be called for a page somebody asked for by scrolling. Nothing is lost by it:
 * the endpoint answers with published employments whoever asks, and `latest`
 * would only skip the response cache.
 */
async function loadMore({ done }: LoadOptions) {
  if (!cursor.value) {
    done("empty");
    return;
  }

  autoLoaded.value += 1;

  try {
    // A page can come back empty and still carry a cursor - the endpoint stops
    // scanning before it has filled one - so it is the cursor, not the count,
    // that says whether there is anything behind it. Asking again here rather
    // than handing an empty page back is the difference between a slow load and
    // one that appears to have done nothing.
    for (let request = 0; request < MAX_REQUESTS_PER_LOAD; request++) {
      const next: RecentEmployments = await $fetch<RecentEmployments>(
        ENDPOINT,
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
.employment-feed__grid {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
}

/* Vuetify's `md`, i.e. what `useDisplay().mdAndUp` answers true for. Written as
   a media query rather than read from `useDisplay` because the server has no
   viewport to answer with: the composable says "small" while rendering and the
   real width only on hydration, which is a layout that visibly jumps. */
@media (min-width: 960px) {
  .employment-feed__grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
