<template>
  <!-- The container this sits in already pads 16px, so `pa-4` would spend a
       fifth of a 375px screen on nothing before a word is read. Kept from `sm`
       up, where there is room for it - the same rule /eksploruj/szpitale
       follows. -->
  <div class="py-4 px-0 pa-sm-4 w-100">
    <h1 class="text-h5 text-sm-h4 mb-2">
      Rocznice pracy w instytucjach publicznych
    </h1>

    <p class="text-body-2 text-medium-emphasis mb-4">
      Kto właśnie obchodzi rocznicę objęcia stanowiska - miesiąc wstecz i
      miesiąc naprzód. Przy każdej osobie podajemy jej łączny staż, czyli sumę
      lat przepracowanych we wszystkich instytucjach publicznych, jakie znamy.
      Liczymy tylko opublikowane strony i tylko miejsca, o których wiemy, że
      należą do sektora publicznego.
    </p>

    <!-- The two halves of the window, one click apart.
         They started as one calendar-ordered feed running from a month back
         into the month ahead, which read correctly and hid the half worth
         looking at: there are six times as many cards in the window as fit on
         a screen, so the first upcoming one sat nine pages down. -->
    <v-btn-toggle
      v-model="scope"
      class="mb-4"
      data-testid="anniversaries-scope"
      density="compact"
      divided
      mandatory
      variant="outlined"
    >
      <v-btn value="upcoming" class="text-none" data-testid="scope-upcoming">
        Nadchodzące<span v-if="upcomingCount" class="ml-1 text-medium-emphasis"
          >({{ upcomingCount }})</span
        >
      </v-btn>
      <v-btn value="past" class="text-none" data-testid="scope-past">
        Minione<span v-if="pastCount" class="ml-1 text-medium-emphasis"
          >({{ pastCount }})</span
        >
      </v-btn>
    </v-btn-toggle>

    <p
      v-if="total > 0"
      class="text-body-2 text-medium-emphasis mb-4"
      data-testid="anniversaries-summary"
    >
      {{ summary }}
    </p>

    <v-alert
      v-if="status === 'error'"
      class="mb-4"
      data-testid="anniversaries-error"
      text="Nie udało się pobrać rocznic. Spróbuj odświeżyć stronę."
      type="error"
      variant="tonal"
    />

    <!-- `mode` is not a constant, for the reason the home page's feed gives at
         greater length: an unbounded intersect feed makes the page infinite
         and pushes the footer further away every time the reader scrolls
         towards it. Two pages automatically, a button after that. -->
    <v-infinite-scroll
      v-else-if="anniversaries.length > 0"
      class="anniversary-feed"
      data-testid="work-anniversaries"
      empty-text="To już wszystkie rocznice z tego okresu."
      load-more-text="Pokaż więcej rocznic"
      :mode="mode"
      @load="loadMore"
    >
      <div class="anniversary-feed__grid">
        <CardAnniversary
          v-for="anniversary in anniversaries"
          :key="anniversary.id"
          :anniversary
        />
      </div>
    </v-infinite-scroll>

    <!-- Only ever seen on a client-side navigation into this page: under SSR
         Nuxt settles the fetch before it renders, so the list arrives with the
         document. -->
    <div v-else-if="status === 'pending'" class="text-center py-8">
      <v-progress-circular indeterminate />
    </div>

    <!-- Not the infinite scroll's own `empty-text`: that one ends a list
         somebody has scrolled, and this is the whole page having nothing to
         show - which on a working site only happens against a fresh local
         stack. -->
    <v-alert
      v-else
      data-testid="work-anniversaries-empty"
      text="W tym miesiącu nie wypada żadna rocznica, o której byśmy wiedzieli."
      type="info"
      variant="tonal"
    />
  </div>
</template>

<script lang="ts" setup>
import { authFetch } from "~/composables/auth";
import { polishCounting } from "~/composables/polish";
import type {
  AnniversaryScope,
  WorkAnniversary,
  WorkAnniversaries,
} from "~~/server/api/edges/anniversaries.get";

/** How many cards a page carries. Two columns on a desktop, so an even number
 * leaves no half row behind while the next one is loading. */
const PAGE_SIZE = 20;

const ENDPOINT = "/api/edges/anniversaries";

/** The `useAsyncData` key the first page is stored under, and so what the
 * server hands the browser in the payload. */
const FIRST_PAGE_KEY = "work-anniversaries";

useSeoMeta({
  title: "Rocznice pracy w instytucjach publicznych - koryta.pl",
  description:
    "Kto obchodzi rocznicę objęcia stanowiska w instytucji publicznej - miesiąc wstecz i miesiąc naprzód - i ile lat przepracował w nich łącznie.",
});

const route = useRoute();
const router = useRouter();

/** Which half of the window is on screen.
 *
 * Kept in the url rather than in a bare ref so that „the anniversaries that
 * have just gone by” is a link somebody can send, and so a reload does not
 * silently move them back to the other half. Upcoming is the default, and it
 * is written as a query parameter only once the reader has chosen the other
 * one - /eksploruj/rocznice and /eksploruj/rocznice?zakres=nadchodzace should
 * not be two urls for one page.
 *
 * The parameter is Polish, like every other one the site puts in a url; the
 * two values it takes are the endpoint's own, so nothing has to be translated
 * on the way back out. */
const SCOPE_PARAM = "zakres";

const scope = computed<AnniversaryScope>({
  get: () => (route.query[SCOPE_PARAM] === "minione" ? "past" : "upcoming"),
  set: (value) => {
    // Rebuilt without the key rather than `delete`d out of a copy: the
    // parameter is dropped entirely for the default half, so that
    // /eksploruj/rocznice stays the one url for it.
    const { [SCOPE_PARAM]: _dropped, ...rest } = route.query;
    const next =
      value === "past" ? { ...rest, [SCOPE_PARAM]: "minione" } : rest;
    // Replace rather than push: the toggle is a view of one page, and leaving
    // an entry per flick of it would make the back button walk through them
    // instead of leaving the page.
    router.replace({ query: next });
  },
});

/** `latest` is carried through from the page's own url rather than only being
 * added by `authFetch` for a signed in reader, because `authFetch` adds it in
 * the browser and the first page is rendered on the server. Without it there
 * is no way to ask for a list newer than the response cache, which is what
 * somebody checking that a publish landed actually wants.
 *
 * `scope` is in here too, so switching the toggle refetches: `useFetch` watches
 * a reactive `query` and reruns on it, which is also what resets the loaded
 * pages below - the watcher on `data` clears them. */
const query = computed(() => ({
  limit: PAGE_SIZE,
  scope: scope.value,
  ...(route.query.latest === undefined ? {} : { latest: route.query.latest }),
}));

// Not awaited, and still server rendered: Nuxt settles every `useAsyncData`
// before it serialises the page. The difference is on a client-side navigation
// into this route, where awaiting would hold the whole page on this fetch.
const { data, status } = authFetch<WorkAnniversaries>(ENDPOINT, {
  query,
  // Named rather than left to key on the url: `useFetch` aborts the earlier
  // call when a second one lands on the same key, so an unnamed one ties this
  // page's fate to any other caller that happens to want the same slice.
  key: FIRST_PAGE_KEY,
});

/** The pages after the first. The first stays in `data` so that a refetch -
 * which is what signing in triggers, `authFetch` adding `latest` to the query
 * - replaces it instead of being appended to what is already on screen. */
const more = ref<WorkAnniversary[]>([]);
const offset = ref<number | null>(null);

/** How many pages this half has fetched by itself so far. Reset with the feed
 * below, which is what makes the count per-half rather than per-visit. */
const autoLoaded = ref(0);

watch(
  data,
  () => {
    more.value = [];
    offset.value = data.value?.nextOffset ?? null;
    // The other half is a fresh feed, not a continuation of this one, so it
    // gets the same two automatic pages. Without this, a reader who had
    // scrolled the upcoming half and then switched to the past one would meet
    // „Pokaż więcej rocznic” on the first screen of it.
    autoLoaded.value = 0;
  },
  { immediate: true },
);

const anniversaries = computed(() => [
  ...(data.value?.anniversaries ?? []),
  ...more.value,
]);

const total = computed(() => data.value?.total ?? 0);

/** The numbers on the two buttons.
 *
 * Plain computeds over the response, and they have to be: held in refs fed by
 * a `watch`, they were 0 through the server render - a watcher's `immediate`
 * run happens before `useAsyncData` settles, and Vue does not flush watchers
 * again on the server - and correct on the client, so the `v-if` around them
 * rendered nothing on one side and a span on the other. Vue called that out as
 * a hydration mismatch.
 *
 * `useFetch` keeps the previous `data` while a refetch is in flight, so the
 * labels do not blink back to nothing when the toggle is switched; the
 * endpoint sends both counts whichever half was asked for, so the last
 * response is always a complete answer for both buttons. */
const upcomingCount = computed(() => data.value?.upcoming ?? 0);
const pastCount = computed(() => data.value?.past ?? 0);

/** „194 rocznice w najbliższym miesiącu”, „177 rocznic w minionym miesiącu”.
 *
 * The count is of the whole half, not of what has loaded, so it says how long
 * the feed is before anybody scrolls it. */
const summary = computed(() => {
  const counted = polishCounting(
    total.value,
    "rocznica",
    "rocznice",
    "rocznic",
  );
  return scope.value === "past"
    ? `${counted} w minionym miesiącu`
    : `${counted} w najbliższym miesiącu`;
});

type LoadOptions = { done: (status: "ok" | "empty" | "error") => void };

/** How many pages the feed fetches by itself before it starts asking.
 *
 * Two, so that scrolling past the first screen still feels like a feed, and
 * the page still ends. */
const AUTO_PAGES = 2;

/** Automatic while the count is under the budget, a button after it. Reading
 * it every render is what lets it change: Vuetify checks `mode` when it
 * decides whether to draw the sentinel and again before it chains the next
 * load. */
const mode = computed(() =>
  autoLoaded.value < AUTO_PAGES ? "intersect" : "manual",
);

/** The next twenty, once the reader has scrolled far enough to want them.
 *
 * Plain `$fetch` rather than `authFetch`, which is a `useFetch` and so cannot
 * be called for a page somebody asked for by scrolling. Nothing is lost by it:
 * the endpoint answers with published anniversaries whoever asks, and `latest`
 * would only skip the response cache.
 *
 * No retry loop, unlike the home page's feed: that one asks again because its
 * endpoint can answer with an empty page and a cursor, having stopped scanning
 * before it filled one. This one slices a list it has already computed, so a
 * page is short only when it is the last. */
async function loadMore({ done }: LoadOptions) {
  if (offset.value === null) {
    done("empty");
    return;
  }

  autoLoaded.value += 1;

  try {
    const next: WorkAnniversaries = await $fetch<WorkAnniversaries>(ENDPOINT, {
      query: { ...query.value, offset: offset.value },
    });
    more.value.push(...next.anniversaries);
    offset.value = next.nextOffset;
    done(next.nextOffset === null ? "empty" : "ok");
  } catch {
    done("error");
  }
}
</script>

<style scoped>
/* The infinite scroll makes its root a scroll container, and a v-row's
   negative margins would hang 12px past it and raise a horizontal scrollbar
   inside the page. A grid with a gap owes nothing to the edges. */
.anniversary-feed__grid {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
}

/* Vuetify's `md`, i.e. what `useDisplay().mdAndUp` answers true for. Written
   as a media query rather than read from `useDisplay` because the server has
   no viewport to answer with: the composable says "small" while rendering and
   the real width only on hydration, which is a layout that visibly jumps. */
@media (min-width: 960px) {
  .anniversary-feed__grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
