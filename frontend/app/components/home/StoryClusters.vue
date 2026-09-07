<template>
  <HomeHeading
    title="Co układa się w historię"
    subtitle="Nowe posady rzadko przychodzą pojedynczo. Tu są pogrupowane: miasto, branża, grupa spółek - i to, co je łączy."
    to="/eksploruj/historie"
  />

  <div v-if="clusters.length" class="cluster-grid" data-testid="story-clusters">
    <CardStoryCluster v-for="cluster in clusters" :key="cluster.id" :cluster />
  </div>

  <!-- Only ever seen on a client-side navigation into the home page: under SSR
       Nuxt settles the fetch before it renders. -->
  <div v-else-if="status === 'pending'" class="text-center py-8">
    <v-progress-circular indeterminate />
  </div>

  <v-alert
    v-else
    data-testid="story-clusters-empty"
    text="Nie znaleźliśmy jeszcze żadnej grupy zmian, która wybijałaby się ponad tło."
    type="info"
    variant="tonal"
  />

  <div v-if="clusters.length" class="mt-3 d-flex align-center flex-wrap ga-2">
    <v-btn
      :append-icon="mdiChevronRight"
      size="small"
      variant="text"
      class="text-none"
      to="/eksploruj/historie"
      text="Wszystkie historie"
    />
  </div>
</template>

<script lang="ts" setup>
import { mdiChevronRight } from "@mdi/js";
import { authFetch } from "~/composables/auth";
import type { ClusterFeed } from "~~/server/api/stats/clusters.get";

/** Four cards: two rows of two on a desktop, and on a phone the fifth would
 * push „Ostatnie zatrudnienia” - the section this one sits above - off the end
 * of any reasonable scroll. The rest are on /eksploruj/historie. */
const LIMIT = 4;

const ENDPOINT = "/api/stats/clusters";

/** The `useAsyncData` key, named for the same reason the recent employments
 * feed names its own: an unnamed key is the url, and `useFetch` aborts an
 * earlier call when a second one lands on the same one. */
const FIRST_PAGE_KEY = "home-story-clusters";

const route = useRoute();

/* Carried through from the page's url rather than left to `authFetch`, which
 * only adds `latest` in the browser - so a server-rendered section never sees
 * it. Without this there is no way to ask the home page for clusters computed
 * after something was published. */
const query = computed(() => ({
  limit: LIMIT,
  ...(route.query.latest === undefined ? {} : { latest: route.query.latest }),
}));

const { data, status } = authFetch<ClusterFeed>(ENDPOINT, {
  query,
  key: FIRST_PAGE_KEY,
});

const clusters = computed(() => data.value?.clusters ?? []);
</script>

<style scoped>
/* A grid rather than a v-row, for the reason the employment feed gives: a
   row's negative margins hang past the section and raise a horizontal
   scrollbar inside it. */
.cluster-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

/* Written as a media query rather than read from `useDisplay`, because the
   server has no viewport to answer with and the layout would visibly jump on
   hydration. */
@media (min-width: 960px) {
  .cluster-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
