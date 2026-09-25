<template>
  <section class="links" data-testid="powiazania">
    <ContractLinkHero
      ref="heroRef"
      :summary="summary"
      :signed-in="signedIn"
      :login-link="registerLink"
      :woj="woj"
      :resolving="likelyReader"
      class="links__anchor"
      @gate="gate('hero')"
    />

    <!-- `?powiazanie=<id>`: one finding, above the filters so that the
         filters stay next to the list they drive. What a journalist sends an
         editor, and where a reader who signed up from a teaser lands - the
         register link carries the teaser's `ukryte_<rank>`, which the server
         answers with the finding once the reader has an account. -->
    <div
      v-if="permalinkId"
      ref="pinnedRef"
      class="links__pinned links__anchor mt-4"
      data-testid="powiazania-przypiete"
    >
      <div class="links__pinned-head">
        <span class="links__pinned-label">Powiązanie z linku</span>
        <NuxtLink
          :to="{ query: queryWithoutPermalink }"
          class="links__pinned-all"
          data-testid="powiazania-wszystkie"
        >
          Wszystkie powiązania
        </NuxtLink>
      </div>

      <v-skeleton-loader
        v-if="pinnedView === 'loading'"
        type="article"
        class="k-card"
      />
      <!-- With the contracts the permalink's answer already carries, so the
           server's html has them where it used to have a progress bar, and
           the card does not ask for the same document again. -->
      <ContractLinkCard
        v-else-if="pinnedView === 'card' && pinnedRow"
        :link="pinnedRow"
        :contracts="pinnedContracts"
        :is-admin="signedIn && !!isAdmin"
        :login-link="signedIn ? undefined : tiesRegisterLink(pinnedRow.id)"
        start-open
        @visibility="onVisibility"
        @gate="onFindingGate('karta', pinnedRow.strength, 'pinned')"
      />
      <ContractLinkTeaser
        v-else-if="pinnedView === 'teaser' && pinnedTeaser"
        :teaser="pinnedTeaser"
        :login-link="teaserRegisterLink(pinnedTeaser)"
        @gate="onFindingGate('teaser', pinnedTeaser.strength, 'pinned')"
      />
      <!-- One card for a gated finding and for one that does not exist, word
           for word: the server answers both with the same 404, and a page
           that told them apart would be the oracle the 404 exists to avoid. -->
      <div
        v-else-if="pinnedView === 'locked'"
        class="k-card links__locked"
        data-testid="powiazania-przypiete-zablokowane"
      >
        <v-icon
          :icon="mdiLockOutline"
          size="28"
          class="links__locked-icon"
          aria-hidden="true"
        />
        <div>
          <p class="text-body-1 font-weight-medium mb-1">
            To powiązanie widzą zalogowani albo go już nie ma.
          </p>
          <p class="text-body-2 text-ink-neutral mb-3">
            Po założeniu konta zobaczysz je z nazwiskami, firmą i umowami — o
            ile nadal jest na liście. Konto jest bezpłatne.
          </p>
          <v-btn
            color="primary"
            variant="flat"
            :to="registerLink"
            class="links__tap"
            data-testid="powiazania-przypiete-rejestracja"
            @click="gate('przypiete')"
          >
            Załóż konto i zobacz
          </v-btn>
        </div>
      </div>
      <p
        v-else-if="pinnedView === 'missing'"
        class="k-note text-body-2 mb-0"
        data-testid="powiazania-przypiete-brak"
      >
        Nie ma takiego powiązania. Mogło zniknąć przy ostatniej aktualizacji
        danych.
      </p>
      <p v-else-if="pinnedView === 'error'" class="k-note text-body-2 mb-0">
        Nie udało się wczytać tego powiązania. Spróbuj odświeżyć stronę.
      </p>
    </div>

    <ContractLinkFilters
      ref="filtersRef"
      v-model:sort="sort"
      v-model:status="status"
      v-model:klasa="klasa"
      v-model:woj="woj"
      :wojewodztwa="wojewodztwa"
      :show-counts="status === 'wszystkie' && !klasa"
      class="links__anchor mt-4"
    />

    <p
      v-if="items.length"
      class="text-body-2 text-ink-neutral mt-3 mb-0"
      data-testid="powiazania-licznik"
    >
      {{ countLine }}
    </p>

    <div class="links__list mt-3" data-testid="powiazania-lista">
      <template v-for="(item, index) in listItems" :key="item.id">
        <!-- A session being restored: the teasers would be swapped for the
             findings behind them a second later, so they are not drawn at
             all until then. -->
        <v-skeleton-loader
          v-if="item.locked && likelyReader"
          type="list-item-three-line"
          class="k-card"
        />
        <ContractLinkTeaser
          v-else-if="item.locked"
          :ref="index === firstTeaserIndex ? setFirstTeaser : undefined"
          :teaser="item"
          :login-link="teaserRegisterLink(item)"
          @gate="onFindingGate('teaser', item.strength, index + 1)"
        />
        <ContractLinkCard
          v-else
          :link="item"
          :is-admin="signedIn && !!isAdmin"
          :login-link="signedIn ? undefined : tiesRegisterLink(item.id)"
          @visibility="onVisibility"
          @gate="onFindingGate('karta', item.strength, index + 1)"
        />
      </template>

      <template v-if="pending && !items.length">
        <v-skeleton-loader
          v-for="n in 3"
          :key="n"
          type="list-item-three-line"
          class="k-card"
        />
      </template>

      <!-- A request that failed is not a list that came back empty: printed
           as „nothing matches", it told a reader under a hero counting
           thirteen findings in the region that there were none. -->
      <p
        v-else-if="error && !items.length"
        class="k-note text-body-2 mb-0"
        role="alert"
        data-testid="powiazania-blad"
      >
        Nie udało się wczytać powiązań.
        <a href="#" @click.prevent="refresh()">Spróbuj ponownie</a>
      </p>

      <p
        v-else-if="!pending && !items.length && !filtered"
        class="k-note text-body-2 mb-0"
        data-testid="powiazania-brak"
      >
        Nie wczytaliśmy jeszcze żadnych powiązań.
      </p>

      <p
        v-else-if="!pending && !items.length"
        class="k-note text-body-2 mb-0"
        data-testid="powiazania-puste"
      >
        Żadne powiązanie nie pasuje do tych filtrów.
        <a href="#" @click.prevent="resetFilters">Pokaż wszystkie</a>
      </p>
    </div>

    <div v-if="nextCursor" class="links__more mt-4">
      <v-btn
        variant="outlined"
        color="ink-strong"
        :loading="loadingMore"
        class="links__tap"
        data-testid="powiazania-wiecej"
        @click="loadMore"
      >
        Pokaż kolejne
      </v-btn>
      <span
        v-if="loadMoreError"
        class="text-body-2 text-ink-danger"
        role="alert"
        data-testid="powiazania-wiecej-blad"
      >
        Nie udało się wczytać kolejnych. Spróbuj jeszcze raz.
      </span>
      <span
        v-else
        class="text-body-2 text-ink-neutral"
        data-testid="powiazania-licznik-dol"
      >
        {{ countLine }}
      </span>
    </div>

    <ContractLinkGate
      v-if="!signedIn && !likelyReader && summary && gatedHere > 0"
      ref="gateRef"
      :summary="summary"
      :login-link="registerLink"
      :woj="woj"
      class="mt-6"
      @gate="gate"
    />

    <p
      class="text-caption text-ink-neutral mt-6 mb-0"
      data-testid="powiazania-metoda"
    >
      Powiązanie to nie zarzut. Łączymy odpisy z KRS (kto kieruje firmą albo ma
      w niej udziały) z listami kandydatów PKW i z Centralnym Rejestrem Umów
      (kto firmie zapłacił). Rejestr nie mówi, kto po stronie urzędu zawierał
      którą umowę, ani czy przy tym ktoś złamał prawo — pokazujemy zbieżność,
      którą warto sprawdzić. Województwo powiązania to województwo instytucji,
      która zapłaciła firmie najwięcej. Kwoty obejmują
      <template v-if="summary?.from && summary?.to">
        umowy zawarte od {{ longDate(summary.from) }} do
        {{ longDate(summary.to) }}</template
      ><template v-else>okres, który pobraliśmy z rejestru</template>.
    </p>

    <!-- Admin only. Naming somebody to everybody is the one moderation step
         with legal weight, so it is asked twice; taking a name back is not. -->
    <v-dialog v-model="confirmOpen" max-width="480">
      <v-card data-testid="powiazania-widocznosc-potwierdz">
        <v-card-title class="text-h6 text-wrap">
          Pokazać to powiązanie wszystkim?
        </v-card-title>
        <v-card-text>
          <p class="mb-2">
            Nazwiska, firma i umowy będą widoczne bez logowania, także dla
            wyszukiwarek.
          </p>
          <p class="text-body-2 text-ink-neutral mb-0">
            Następne wgranie danych z potoku ustawi widoczność od nowa. Żeby
            decyzja przetrwała, dopisz NIP {{ confirmNip }} do
            <code>--public-nips</code>.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmOpen = false">Anuluj</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            data-testid="powiazania-widocznosc-tak"
            @click="confirmPublic"
          >
            Pokaż wszystkim
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar
      v-model="noticeOpen"
      :timeout="notice?.error ? -1 : 10000"
      :color="notice?.error ? 'error' : undefined"
      data-testid="powiazania-widocznosc-komunikat"
    >
      {{ notice?.text }}
      <template #actions>
        <v-btn
          v-if="notice?.undo"
          variant="text"
          :loading="visibilityBusy"
          @click="notice?.undo?.()"
        >
          Cofnij
        </v-btn>
        <v-btn variant="text" @click="noticeOpen = false">Zamknij</v-btn>
      </template>
    </v-snackbar>
  </section>
</template>

<script setup lang="ts">
/** „Powiązania": the findings from the contracts register, one card per firm.
 *
 * Public by design and server rendered: the checked, strong findings name
 * their people to everybody, because a stranger arriving from a search is who
 * this page is for. The rest arrive as teasers - the amount band, the kind of
 * office, the województwo - and the page asks for an account to see them. The
 * gate is the server's (`contractLinkItem`); this component only draws what it
 * was sent. The order is the server's too: teasers arrive interleaved with the
 * public cards by the pipeline's rank, and are not reordered here.
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useIntersectionObserver } from "@vueuse/core";
import { mdiLockOutline } from "@mdi/js";
import { useIsCurrentUserLoaded } from "vuefire";
import type { MaybeRefOrGetter } from "vue";
import type { LocationQuery } from "vue-router";
import { useAuthState } from "~/composables/auth";
import { trackGoal } from "~/composables/analytics";
import { useHydrated, useRenderedUser } from "~/composables/hydrated";
import {
  polishCountingGenitive,
  polishCountingGrouped,
  polishNumber,
} from "~/composables/polish";
import type { QueryPatch } from "~/composables/queryFilters";
import {
  CONTRACT_LINK_PARAM,
  CONTRACT_LINK_SORTS,
  CONTRACT_LINK_STATUS_FILTERS,
  contractLinkMatchCount,
  contractLinkPermalinkId,
  normaliseClass,
  normaliseWojewodztwo,
  oneOf,
  setContractLinkVisibility,
  useContractLink,
  useContractLinkPages,
  useLikelyReader,
  usePageViewOnce,
  type ContractLinkSort,
  type ContractLinkStatusFilter,
} from "~/composables/contractLinks";
import { positionBucket } from "~~/shared/analytics";
import { longDate } from "~~/shared/dates";
import type {
  ContractLinkClassFilter,
  ContractLinkItem,
  ContractLinkRow,
  ContractLinkStrength,
  ContractLinkTeaser,
  ContractLinkVisibility,
} from "~~/shared/contractLinks";
import type { ContractRow } from "~~/shared/contracts";

const route = useRoute();
const router = useRouter();
const { isAdmin } = useAuthState();
const authReady = useIsCurrentUserLoaded();
const hydrated = useHydrated();
/** Through `useRenderedUser`, as on the page around this: nobody until the
 * server's html is hydrated, because that html was rendered for nobody. */
const user = useRenderedUser();
const signedIn = computed(() => !!user.value);
const likelyReader = useLikelyReader();

// --- the filters, as the url has them and as the page reads them --------------

/** A permalink stops being the point once the reader filters the list. */
const { setQuery } = useQueryFilters({ resetOnChange: [CONTRACT_LINK_PARAM] });

function queryValue(key: string): string | null {
  const value = route.query[key];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** The two fixed choices, forgiving of case: „?kolejnosc=Kwota" is a link
 * somebody typed, and it means „kwota". */
function choiceValue(key: string): string | null {
  return queryValue(key)?.trim().toLowerCase() ?? null;
}

/** Set by a control, read by the watcher that scrolls to the list - so a
 * change the reader made scrolls, and one the back button made does not. */
let scrollAfterChange = false;
function changeFilter(patch: QueryPatch) {
  scrollAfterChange = true;
  void setQuery(patch, { reset: true });
}

/** Each filter reads the url through a normaliser: an unknown value is the
 * default, never a 400 that the page would print as „nothing matches". */
const sort = computed<ContractLinkSort>({
  get: () => oneOf(choiceValue("kolejnosc"), CONTRACT_LINK_SORTS, "sila"),
  set: (value) =>
    changeFilter({ kolejnosc: value === "sila" ? undefined : value }),
});
const status = computed<ContractLinkStatusFilter>({
  get: () =>
    oneOf(choiceValue("status"), CONTRACT_LINK_STATUS_FILTERS, "wszystkie"),
  set: (value) =>
    changeFilter({ status: value === "wszystkie" ? undefined : value }),
});
const klasa = computed<ContractLinkClassFilter | null>({
  get: () => normaliseClass(queryValue("klasa")),
  set: (value) => changeFilter({ klasa: value ?? undefined }),
});
const woj = computed<string | null>({
  get: () => normaliseWojewodztwo(queryValue("woj")),
  set: (value) => changeFilter({ woj: value ?? undefined }),
});
const permalinkId = computed(() =>
  contractLinkPermalinkId(queryValue(CONTRACT_LINK_PARAM)),
);

// Written back once hydrated, so a hand-typed „?woj=Podlaskie" becomes the
// link it means and „?status=ukryte" disappears. After mount and not in setup:
// a url rewritten during hydration changes `registerLink` under the server's
// html. `replace`, because a correction the back button walks into is
// corrected again.
onMounted(() => {
  watch(
    () => route.query,
    () =>
      void setQuery(
        {
          kolejnosc: sort.value === "sila" ? undefined : sort.value,
          status: status.value === "wszystkie" ? undefined : status.value,
          woj: woj.value ?? undefined,
          klasa: klasa.value ?? undefined,
          [CONTRACT_LINK_PARAM]: permalinkId.value ?? undefined,
        },
        { replace: true },
      ),
    { immediate: true },
  );
});

function resetFilters() {
  changeFilter({ status: undefined, woj: undefined, klasa: undefined });
}

/** Whether the list is narrowed at all. An empty unfiltered list is a stack
 * with no findings loaded - even an anonymous reader gets the gated ones, as
 * teasers - and „nothing matches these filters" would name filters nobody
 * set. */
const filtered = computed(
  () => status.value !== "wszystkie" || !!woj.value || !!klasa.value,
);

// --- the list ----------------------------------------------------------------

const query = computed(() => ({
  sort: sort.value,
  status: status.value,
  woj: woj.value ?? undefined,
  klasa: klasa.value ?? undefined,
}));
const {
  data,
  pending,
  error,
  refresh,
  items,
  nextCursor,
  loadingMore,
  loadMoreError,
  loadMore,
  patchItem,
} = useContractLinkPages(query);

/** The first page's summary is kept across filter changes: it describes every
 * finding, not the filtered list, and it arrives only on a first page. */
const lastSummary = ref(data.value?.summary ?? null);
watch(
  () => data.value?.summary,
  (value) => {
    if (value) lastSummary.value = value;
  },
);
const summary = computed(() => data.value?.summary ?? lastSummary.value);

const wojewodztwa = computed(() =>
  Object.entries(summary.value?.byWojewodztwo ?? {})
    .sort((a, b) => b[1].links - a[1].links)
    .map(([name, entry]) => ({ name, links: entry.links })),
);

/** „Pokazujemy 24 z 420 powiązań" where the summary knows the second number,
 * „Pokazujemy 24 powiązania" where it does not. */
const countLine = computed(() => {
  const shown = items.value.length;
  const of = contractLinkMatchCount(summary.value, {
    status: status.value,
    woj: woj.value,
    klasa: klasa.value,
  });
  if (of == null) {
    return `Pokazujemy ${polishCountingGrouped(shown, "powiązanie", "powiązania", "powiązań")}`;
  }
  const total = Math.max(of, shown);
  return `Pokazujemy ${polishNumber(shown)} z ${polishCountingGenitive(total, "powiązania", "powiązań")}`;
});

/** The gated count the end-of-list ask speaks for: the region's when the
 * list is filtered to one, and none for a region with no findings at all. */
const gatedHere = computed(() => {
  const all = summary.value;
  if (!all) return 0;
  return woj.value ? (all.byWojewodztwo[woj.value]?.gated ?? 0) : all.gated;
});

// A filter the reader changed moves the list, and the list is what they asked
// about - it used to start 24px above the fold of a 1366x800 screen, under a
// hero that had not changed. The compact hero comes along when there is one:
// with a województwo picked it carries the region's line.
const heroRef = ref<{ $el?: unknown } | null>(null);
const filtersRef = ref<{ $el?: unknown } | null>(null);
if (import.meta.client) {
  watch([sort, status, woj, klasa], async () => {
    if (!scrollAfterChange) return;
    scrollAfterChange = false;
    await nextTick();
    const hero = elementOf(heroRef.value);
    const compactHero = hero?.classList.contains("link-hero--compact");
    const target = compactHero ? hero : elementOf(filtersRef.value);
    if (!target) return;
    const top = target.getBoundingClientRect().top;
    if (top >= 0 && top < 160) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// --- the permalink -----------------------------------------------------------

const {
  data: pinned,
  pending: pinnedPending,
  error: pinnedError,
} = useContractLink(permalinkId);

const pinnedLink = computed<ContractLinkItem | null>(() =>
  pinned.value?.state === "found" ? pinned.value.link : null,
);
const pinnedRow = computed<ContractLinkRow | null>(() =>
  pinnedLink.value && !pinnedLink.value.locked ? pinnedLink.value : null,
);
const pinnedTeaser = computed<ContractLinkTeaser | null>(() =>
  pinnedLink.value?.locked ? pinnedLink.value : null,
);
const pinnedContracts = computed<ContractRow[] | undefined>(() =>
  pinned.value?.state === "found" ? pinned.value.contracts : undefined,
);

/** The list without the pinned finding, which is already drawn above it: the
 * same card twice would be two elements with one id. */
const listItems = computed(() => {
  const pinnedId = pinnedLink.value?.id;
  return pinnedId
    ? items.value.filter((item) => item.id !== pinnedId)
    : items.value;
});

/** What the pinned slot draws. `loading` also covers the anonymous answer
 * while a session is being restored or refetched: it would say „widzą
 * zalogowani" to the reader who just signed up to see it. */
const pinnedView = computed(() => {
  if (!permalinkId.value) return null;
  const answer = pinned.value;
  const anonymousAnswer =
    !answer || answer.state === "missing" || !!pinnedLink.value?.locked;
  if (pinnedPending.value && (!answer || signedIn.value)) return "loading";
  if (likelyReader.value && anonymousAnswer) return "loading";
  if (!answer) return pinnedError.value ? "error" : "loading";
  if (answer.state === "missing") return signedIn.value ? "missing" : "locked";
  return pinnedLink.value?.locked ? "teaser" : "card";
});

const queryWithoutPermalink = computed<LocationQuery>(() =>
  Object.fromEntries(
    Object.entries(route.query).filter(([key]) => key !== CONTRACT_LINK_PARAM),
  ),
);

// Arriving on a permalink scrolls to it once, when it is drawn - on a phone
// it is below the hero. Not when the page is already scrolled: that is Back,
// and the router restores its own position.
//
// Not before firebase has settled either. What is above the pinned block -
// the hero, the mode chips - is drawn for nobody until then, and a signed-in
// reader's session shrinks it by 300-900 px: scrolled any earlier, a reader
// without the session hint landed in the list below the finding the link
// was for.
const pinnedRef = ref<HTMLElement | null>(null);
onMounted(() => {
  let scrolled = false;
  watch(
    [pinnedView, authReady, hydrated],
    async ([view]) => {
      if (scrolled || !view || view === "loading") return;
      if (!authReady.value || !hydrated.value) return;
      scrolled = true;
      await nextTick();
      if (window.scrollY > 10) return;
      pinnedRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    { immediate: true },
  );
});

// --- the asks ----------------------------------------------------------------

/** `powod` is what /login says the account is for, and the `from` of
 * `konto:utworzone`. */
function registerTo(target: string, powod = "powiazania") {
  return `/login?konto=nowe&powod=${powod}&redirect=${encodeURIComponent(target)}`;
}

/** Where the hero, the end of the list and the locked permalink send a
 * reader: straight into creating an account, and back here afterwards. */
const registerLink = computed(() => registerTo(route.fullPath));

/** One finding's own way in: back to this list with that finding pinned, so
 * the reader who signed up for it is shown it - open, above the list - rather
 * than the top of a page they then have to search. */
function findingRegisterLink(id: string, powod?: string) {
  return registerTo(
    router.resolve({
      path: route.path,
      query: { ...route.query, [CONTRACT_LINK_PARAM]: id },
    }).fullPath,
    powod,
  );
}

/** A teaser by its rank - on the teaser already, the same for every reader,
 * and what the server answers a signed-in reader with the finding for. */
function teaserRegisterLink(teaser: ContractLinkTeaser) {
  return findingRegisterLink(`ukryte_${teaser.rank}`);
}

/** The „jeszcze N osoby" line on a public card. The reader already sees its
 * name, firm and contracts; what they asked for is the people beside them,
 * and /login says so under a reason of its own. */
function tiesRegisterLink(id: string) {
  return findingRegisterLink(id, "powiazania-osoby");
}

type GateSurface =
  "hero" | "koniec-listy" | "koniec-listy-logowanie" | "przypiete";

function gate(surface: GateSurface) {
  trackGoal("powiazania:gate-click", {
    surface,
    strength: "none",
    position: "none",
  });
}

/** A lock on one finding: a teaser, or the „more people after signing in"
 * line on a public card. Its class and where it sat, for which of them pull. */
function onFindingGate(
  surface: "teaser" | "karta",
  strength: ContractLinkStrength,
  position: number | "pinned",
) {
  trackGoal("powiazania:gate-click", {
    surface,
    strength,
    position: positionBucket(position),
  });
}

/** The denominators for the clicks above: an ask that came into view, once
 * per page view and surface (`usePageViewOnce` - the mode switch remounts this
 * component, and coming back to „Powiązania" is not another page view). Only
 * once firebase has said there is nobody signed in - a restoring session is
 * not somebody who was asked. */
function trackImpression(
  target: MaybeRefOrGetter<HTMLElement | null | undefined>,
  surface: "hero" | "teaser" | "koniec-listy",
) {
  if (!import.meta.client) return;
  const once = usePageViewOnce();
  const visible = ref(false);
  useIntersectionObserver(
    target,
    ([entry]) => {
      visible.value = !!entry?.isIntersecting;
    },
    { threshold: 0.4 },
  );
  watch([visible, authReady, hydrated, signedIn], () => {
    if (!visible.value || !authReady.value || !hydrated.value) return;
    if (signedIn.value || !once(`powiazania:gate-shown:${surface}`)) return;
    trackGoal("powiazania:gate-shown", { surface });
  });
}

/** A component's root, when it is an element. After a render that did not go
 * as planned `$el` can be a comment node - a `v-if` placeholder - and an
 * IntersectionObserver handed one throws, which Nuxt turned into the 500
 * page. */
function elementOf(component: unknown): HTMLElement | null {
  const el = (component as { $el?: unknown } | null)?.$el;
  return typeof HTMLElement !== "undefined" && el instanceof HTMLElement
    ? el
    : null;
}

const firstTeaserIndex = computed(() =>
  listItems.value.findIndex((item) => item.locked),
);
const firstTeaser = ref<HTMLElement | null>(null);
function setFirstTeaser(component: unknown) {
  firstTeaser.value = elementOf(component);
}
const gateRef = ref<{ $el?: unknown } | null>(null);

trackImpression(() => elementOf(heroRef.value), "hero");
trackImpression(firstTeaser, "teaser");
trackImpression(() => elementOf(gateRef.value), "koniec-listy");

// --- the admin's visibility switch -------------------------------------------

const confirmOpen = ref(false);
const confirmId = ref<string | null>(null);
const confirmNip = computed(() => confirmId.value?.replace(/^cru_/, "") ?? "");

const visibilityBusy = ref(false);
const noticeOpen = ref(false);
const notice = ref<{ text: string; error?: boolean; undo?: () => void }>();

/** The card whose switch was pressed, to hand the keyboard back to. The
 * dialog has no activator for Vuetify to return focus to, and „Cofnij" is
 * gone once the undo lands; both left an admin at the top of the page, a
 * whole list away from the next decision. */
let returnFocus: { id: string; element: HTMLElement | null } | null = null;

function restoreFocus() {
  if (!returnFocus) return;
  const { id, element } = returnFocus;
  const target = element?.isConnected
    ? element
    : document
        .getElementById(id)
        ?.querySelector<HTMLElement>('[data-testid="powiazanie-widocznosc"]');
  target?.focus({ preventScroll: true });
}

watch(confirmOpen, (open) => {
  if (!open) void nextTick(restoreFocus);
});

function onVisibility(id: string, visibility: ContractLinkVisibility) {
  const active = document.activeElement;
  returnFocus = {
    id,
    element: active instanceof HTMLElement ? active : null,
  };
  if (visibility === "public") {
    confirmId.value = id;
    confirmOpen.value = true;
    return;
  }
  void applyVisibility(id, visibility, true);
}

function confirmPublic() {
  confirmOpen.value = false;
  if (confirmId.value) void applyVisibility(confirmId.value, "public", true);
}

/** The route's own message where there is one („Nie ma takiego
 * powiązania."), the transport's otherwise. */
function errorMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { data, message } = error as {
    data?: { message?: string };
    message?: string;
  };
  return data?.message ?? message;
}

/** Patches the card where it is rather than refetching: a refetch reset the
 * list to its first page, and a card from page two vanished from under the
 * admin who had just clicked it. */
async function applyVisibility(
  id: string,
  visibility: ContractLinkVisibility,
  undoable: boolean,
) {
  visibilityBusy.value = true;
  try {
    await setContractLinkVisibility(id, visibility);
    const patch = (item: ContractLinkItem) =>
      item.locked ? item : { ...item, visibility };
    patchItem(id, patch);
    if (pinned.value?.state === "found" && pinned.value.link.id === id) {
      pinned.value = { ...pinned.value, link: patch(pinned.value.link) };
    }
    const previous: ContractLinkVisibility =
      visibility === "public" ? "gated" : "public";
    notice.value = {
      text:
        (visibility === "public"
          ? "Powiązanie widzą teraz wszyscy."
          : "Powiązanie widzą teraz tylko zalogowani.") +
        " Następne wgranie danych to nadpisze, chyba że NIP trafi do " +
        (visibility === "public" ? "--public-nips." : "--gated-nips."),
      undo: undoable
        ? () => void applyVisibility(id, previous, false)
        : undefined,
    };
  } catch (error) {
    const message = errorMessage(error);
    notice.value = {
      text: `Nie udało się zmienić widoczności${message ? `: ${message}` : "."}`,
      error: true,
    };
  } finally {
    visibilityBusy.value = false;
    noticeOpen.value = true;
    await nextTick();
    restoreFocus();
  }
}
</script>

<style scoped>
.links__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Below the app bar when scrolled to, not under it. */
.links__anchor {
  scroll-margin-top: 80px;
}

.links__pinned-head {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  justify-content: space-between;
  margin-bottom: 8px;
}

.links__pinned-label {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.links__pinned-all {
  align-items: center;
  display: inline-flex;
  min-height: 44px;
}

.links__locked {
  display: flex;
  gap: 14px;
  padding: 18px 20px;
}

.links__locked-icon {
  color: rgb(var(--v-theme-ink-neutral));
  flex: none;
}

.links__more {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  justify-content: center;
}

@media (max-width: 599.98px) {
  .links__tap {
    min-height: 44px;
  }
}
</style>
