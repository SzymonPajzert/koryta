<template>
  <div>
    <!-- One h1, outside every mode branch and outside `<ClientOnly>`. It is the
         heading of the crawled page, and a heading that changes after
         hydration is both a layout shift and a different document than the one
         the crawler read. -->
    <h1 class="text-h5 text-sm-h4 mb-1">Umowy publiczne: kto komu zapłacił</h1>

    <!-- A fresh environment, before the register has been ingested. One note
         and nothing else: a headline reading „0 umów" over an empty feed with a
         filter bar above it looks like a page that failed, not like a page with
         nothing in it yet. The mode switch goes with it - there is nothing to
         see in any of the three. -->
    <div v-if="empty" class="k-note" data-testid="umowy-blank">
      <p class="text-body-2 mb-0">
        Nie wczytaliśmy jeszcze żadnych umów. Pojawią się tutaj, gdy pobierzemy
        Centralny Rejestr Umów.
      </p>
    </div>

    <template v-else>
      <!-- Offered to everybody. „Ludzie" and „Obie strony" name people we have
           not published, so a logged out reader gets them as one locked chip
           that leads to an account rather than as two that lead nowhere.
           `signedIn` is false until hydration is over (`useRenderedUser`): the
           server rendered for nobody, and a session firebase restored before
           hydration finished used to hydrate these chips - and the list under
           them - as a signed-in reader's, which ended on the 500 page.

           `column`, so the chips wrap: as a slide group „Obie strony" was cut
           off at a phone's right edge with nothing to say there was more.

           A radio group by hand: Vuetify marks the chosen chip with a class
           and gives the chips no role, so a screen reader heard two lines of
           text and no control. -->
      <div class="umowy__modes d-flex flex-wrap align-center column-gap-2 mb-2">
        <v-chip-group
          v-model="mode"
          mandatory
          column
          role="radiogroup"
          aria-label="Tryb"
          data-testid="umowy-tryb"
        >
          <v-chip
            value="powiazania"
            size="small"
            role="radio"
            :aria-checked="String(mode === 'powiazania')"
          >
            Powiązania
          </v-chip>
          <v-chip
            value="umowy"
            size="small"
            role="radio"
            :aria-checked="String(mode === 'umowy')"
          >
            Wszystkie umowy
          </v-chip>
          <template v-if="signedIn">
            <v-chip
              value="ludzie"
              size="small"
              role="radio"
              :aria-checked="String(mode === 'ludzie')"
            >
              Ludzie
            </v-chip>
            <v-chip
              value="obie"
              size="small"
              role="radio"
              :aria-checked="String(mode === 'obie')"
            >
              Obie strony<template v-if="coverage">
                ({{ polishNumber(coverage.bothLinked) }})</template
              >
            </v-chip>
          </template>
        </v-chip-group>
        <!-- Not while a session this browser had is being restored
             (`useLikelyReader`): a signed-in reader was shown the lock for the
             second before the real chips arrived. -->
        <v-chip
          v-if="!signedIn && !likelyReader"
          size="small"
          variant="outlined"
          :prepend-icon="mdiLockOutline"
          :to="peopleLoginLink"
          data-testid="umowy-tryb-zablokowany"
          @click="
            trackGoal('powiazania:gate-click', {
              surface: 'tryb-ludzie',
              strength: 'none',
              position: 'none',
            })
          "
        >
          Ludzie we władzach — po zalogowaniu
        </v-chip>
      </div>

      <ContractLinkView v-if="view === 'powiazania'" />

      <template v-else-if="view === 'umowy'">
        <p class="text-body-2 text-ink-neutral mb-3">
          Umowy z Centralnego Rejestru Umów — wszystkie, które pobraliśmy. Przy
          części z nich umiemy dopisać instytucję albo spółkę opisaną na
          koryta.pl.
        </p>

        <ContractHeadline v-if="coverage" :coverage="coverage" />

        <ContractFilters v-model:sort="sort" v-model:zakres="zakres" />

        <!-- The same single column at every width. A contract card is a two-line
             subject and two party lines; stretched across a 1200px monitor it is
             a sentence with 900px of nothing after it, and a table of 149 683
             register rows is not what this page is for. -->
        <div class="umowy__list">
          <ContractFeed
            :query="query"
            empty-text="Żadna umowa nie pasuje do tych filtrów."
            @reset="zakres = 'wszystkie'"
          />
        </div>
      </template>

      <!-- The signed-in half, and nothing else, inside `<ClientOnly>`. These two
           modes name people we have not published, and the whole point of the
           gate is that those bytes never leave the server for anybody without a
           verified token.

           Unreachable under SSR as things stand - `view` falls back to „umowy"
           while there is no reader, and `vuefire.auth` in nuxt.config.ts has no
           session cookie, so on the server there is never one. This is the belt
           to that braces: turning the session cookie on is a one-line config
           change somewhere else in the tree, and it must not be the change that
           puts a draft name into an indexed page. -->
      <ClientOnly v-else>
        <h2 class="text-h6 mb-1">Umowy i ludzie</h2>
        <p class="text-body-2 mb-2">
          Osoby, które zasiadają we władzach instytucji z Centralnego Rejestru
          Umów — także te, których jeszcze nie opublikowaliśmy.
        </p>

        <!-- Once, above the list, and never per row. Three signals mark a draft -
             a dashed frame, this sentence and the „szkic" chip - and repeating the
             sentence on every row would turn the legend into noise and the noise
             into something a reader stops reading. -->
        <p
          class="text-caption text-ink-neutral mb-2"
          data-testid="umowy-osoby-legend"
        >
          Przerywana ramka i chip «szkic» to nasza robocza hipoteza — osoba albo
          powiązanie, którego jeszcze nie opublikowaliśmy.
        </p>

        <!-- Above the fold, not in a footer. A truncated list that prints a total
             without saying it is truncated is a lie about coverage, and this is
             the surface on which publishing decisions get made.

             Only in „Ludzie": it describes the institution window the person
             ranking is built from, and „Obie strony" is a different query with a
             cap of its own. -->
        <div
          v-if="coverage && view === 'ludzie'"
          class="k-note text-body-2 mb-4"
          data-testid="umowy-osoby-cap"
        >
          <!-- „instytucji" in both halves of the sentence: after „z" and after
               „ze wszystkich" Polish takes the genitive, where the numeral stops
               choosing a noun form altogether. `polishCounting` would write „z 30
               instytucje".

               The cap and the button are named only while there is a next
               window: „nie ze wszystkich 3" over all three, beside a button
               that is not there, reads as a bug. -->
          <template v-if="nextCursor">
            Pokazujemy ludzi z
            <strong>{{ polishNumber(shownInstitutions) }} instytucji</strong>
            o największej liczbie umów w tym okresie — nie ze wszystkich
            <strong>{{ polishNumber(coverage.companies) }}</strong
            >. «Pokaż kolejne instytucje» dobiera następne trzydzieści.
          </template>
          <template v-else>
            Pokazujemy ludzi ze wszystkich
            <strong
              >{{
                polishNumber(Math.min(shownInstitutions, coverage.companies))
              }}
              instytucji</strong
            >
            z umowami w tym okresie.
          </template>
        </div>

        <div
          v-if="view === 'ludzie'"
          class="d-flex flex-wrap align-center ga-4 mb-3"
        >
          <!-- The default is the count of contracts and never the sum. A money
               leaderboard over an unreviewed NIP join - 82.5% of the employments
               under it are unpublished - reads as a verdict rather than as a
               work queue, and POLREGIO's five-contract board would be the whole
               first screen. -->
          <v-btn-toggle
            v-model="peopleSort"
            density="compact"
            variant="outlined"
            divided
            mandatory
            data-testid="umowy-osoby-sort"
          >
            <v-btn value="umowy" size="small">Liczba umów</v-btn>
            <v-btn value="suma" size="small">Suma w okresie</v-btn>
            <v-btn value="ostatnia" size="small">Ostatnia umowa</v-btn>
          </v-btn-toggle>

          <v-btn-toggle
            v-model="stan"
            density="compact"
            variant="outlined"
            divided
            mandatory
            data-testid="umowy-osoby-stan"
          >
            <v-btn value="all" size="small">Wszyscy</v-btn>
            <v-btn value="opublikowane" size="small">Opublikowani</v-btn>
            <v-btn value="nasze" size="small">Nasze ustalenia</v-btn>
          </v-btn-toggle>
        </div>

        <!-- Counts only. `StatTile` prints `formatCompact(value)` and has no way
             to render złoty, so a money tile here would say „46,9 mln" of
             something the label has to name and the tile cannot. -->
        <v-row v-if="view === 'ludzie'" class="mb-2">
          <v-col cols="6" md="3">
            <StatsStatTile
              label="Osoby"
              :value="people.length"
              hint="w tym oknie"
            />
          </v-col>
          <v-col cols="6" md="3">
            <StatsStatTile
              label="Instytucje w oknie"
              :value="shownInstitutions"
            />
          </v-col>
          <!-- Rendered only once an answer has landed: a tile printing an em
               dash is a worse answer than no tile. -->
          <v-col v-if="windowContracts !== null" cols="6" md="3">
            <StatsStatTile label="Umowy w oknie" :value="windowContracts" />
          </v-col>
        </v-row>

        <v-skeleton-loader
          v-if="peoplePending && !people.length"
          type="paragraph"
        />

        <template v-if="view === 'ludzie'">
          <ContractPersonRow
            v-for="row in people"
            :key="row.person.id"
            :row="row"
          />

          <div
            v-if="!peoplePending && !people.length"
            class="k-note text-body-2"
          >
            Nikogo nie znamy we władzach instytucji z tego okna.
          </div>

          <v-btn
            v-if="nextCursor"
            variant="outlined"
            block
            class="mt-3"
            :loading="peoplePending"
            data-testid="umowy-osoby-more"
            @click="extendWindow()"
          >
            Pokaż kolejne instytucje
          </v-btn>
        </template>

        <template v-else>
          <div v-for="row in bothRows" :key="row.id" class="mb-2">
            <!-- A plain note and deliberately not `bg-surface-danger`. An
                 unreviewed NIP join is a research lead; red is a verdict, and the
                 row under it says only that somebody sits on two boards. -->
            <div
              v-if="bothSidesNames(row).length"
              class="k-note text-body-2 mb-1"
              data-testid="umowy-obie-strony"
            >
              Ta sama osoba po obu stronach tej umowy:
              {{ bothSidesNames(row).join(", ") }}.
            </div>
            <ContractRow :contract="row" />
          </div>

          <!-- The one place this sentence exists. On an institution's page an
               anonymous reader would take the same null result for a clearance -
               we hold 825 of the register's 12 858 contracting bodies. -->
          <div
            v-if="!peoplePending && !bothRows.length && coverage"
            class="k-note text-body-2"
            data-testid="umowy-obie-puste"
          >
            W tych {{ polishNumber(coverage.linked) }} umowach nie znaleźliśmy
            nikogo powiązanego z obiema stronami tej samej umowy. To nie znaczy,
            że takich przypadków nie ma — znamy władze
            {{ polishNumber(coverage.companies) }} z
            {{ polishNumber(coverage.registerInstitutions) }} instytucji w
            rejestrze.
          </div>
        </template>

        <!-- The people are resolved live on every request, so they are never
             stale; only the contract counts the ranking is built from are as old
             as the last ingest, and this says which. -->
        <p
          v-if="coverage"
          class="text-caption text-ink-neutral mt-4"
          data-testid="umowy-osoby-stan-na"
        >
          Umowy w tym widoku: stan na {{ longDate(coverage.computedAt) }}.
        </p>
      </ClientOnly>

      <!-- Outside the mode branches, because it says where the numbers of
           every mode but „Powiązania" come from, and all of them print them
           from the same `coverage`. The findings carry their own note on
           method and period. -->
      <ContractSourceNote
        v-if="coverage && view !== 'powiazania'"
        :coverage="coverage"
        class="mt-6"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
/** Umowy: the public register, and - for a signed-in reader - the people behind it.
 *
 * Four modes on one url, `?tryb=powiazania|umowy|ludzie|obie`:
 *
 * - **powiazania**, the default, is the findings: a person in power, the firm
 *   tied to them and the institution that paid it (`contract/link/View.vue`).
 *   The strongest checked ones are named to everybody; the rest are teasers
 *   that ask for an account.
 * - **umowy** is the public list of contracts. Server rendered,
 *   indexable, phone first, and with no `<ClientOnly>` anywhere in it - the
 *   whole point of the feature is that a stranger arriving from a search reads
 *   the register without an account. Nothing in it is gated, because
 *   `/api/contracts` attaches no person data to anybody: a reader reaches people
 *   by tapping „Szczegóły umowy" or by following an institution link.
 * - **ludzie** and **obie** are the editors' work queue behind it. The rows are
 *   people, not contracts, because the question they answer is *kto zasiada we
 *   władzach instytucji, przez które w tym okresie przepłynęły publiczne
 *   pieniądze* - including the ones we have not published.
 *
 * The two halves were two pages until 2026-09-14 (`/umowy` and this one). One
 * url with a mode switch, because they are one subject and the split made the
 * public half the pale page an arriving reader landed on.
 *
 * **Never „podpisał", „odpowiada za" or „beneficjent" anywhere on this page.**
 * The join is NIP to institution and the graph is person to board seat. Nothing
 * here connects a named person to a signature, and wording that implies it
 * would turn an unreviewed match into an accusation.
 *
 * The people window is capped at thirty institutions per fetch and the cap is
 * printed above the fold rather than hidden in a footer - a truncated list that
 * states a register-wide total without saying it is truncated is a lie about
 * coverage.
 */
import { computed, ref, watch } from "vue";
import { mdiLockOutline } from "@mdi/js";
import { useIsCurrentUserLoaded } from "vuefire";
import { polishNumber } from "~/composables/polish";
import { trackGoal } from "~/composables/analytics";
import { authRequest } from "~/composables/auth";
import { useHydrated, useRenderedUser } from "~/composables/hydrated";
import {
  CONTRACT_LINK_PARAM,
  useLikelyReader,
} from "~/composables/contractLinks";
import { SOCIAL_CARD } from "~/composables/entitySeo";
import type { QueryPatch } from "~/composables/queryFilters";
import {
  CONTRACTS_ENDPOINT,
  CONTRACT_PARAM,
  type ContractListResponse,
  type ContractPeopleResponse,
  type ContractScope,
  type ContractSort,
} from "~/composables/contracts";
import { longDate } from "~~/shared/dates";
import type {
  ContractPersonRow as PersonRowData,
  ContractRow as ContractRowData,
} from "~~/shared/contracts";

/** No `middleware: "auth"`. It was on this route while it was the signed-in
 * view only; the public list lives here now, and a reader who followed a search
 * result for a contract must not be bounced to /login. */
definePageMeta({ maxWidth: 1200 });

const MODES = ["powiazania", "umowy", "ludzie", "obie"] as const;
/** What a logged out reader may open. The findings gate per row on the
 * server; the contract list names nobody. */
const PUBLIC_MODES: readonly Mode[] = ["powiazania", "umowy"];
type Mode = (typeof MODES)[number];

const route = useRoute();
const authReady = useIsCurrentUserLoaded();
const hydrated = useHydrated();
/** Nobody until the server's html is hydrated, whatever firebase restored by
 * then - see the mode chips in the template. */
const user = useRenderedUser();
const signedIn = computed(() => !!user.value);
const likelyReader = useLikelyReader();

const { choiceFilter, setQuery } = useQueryFilters({
  // Changing a filter re-orders the list, so the row a `?umowa=` link pointed
  // at is no longer the row it opens. Dropping the parameter is what stops an
  // unrelated contract expanding itself after a sort.
  resetOnChange: [CONTRACT_PARAM],
});

/** All three live in the url, because a filtered list is a link somebody sends.
 * The cursor does not: it would make a shared link point at page four of an
 * ordering that has since moved. */
const tryb = choiceFilter<Mode>("tryb", "powiazania");
const sort = choiceFilter<ContractSort>("sort", "data");
const zakres = choiceFilter<ContractScope>("zakres", "wszystkie");

/** The url says what it likes; this says what the page will render.
 *
 * Two corrections at once. A `?tryb=` nobody wrote - a typo, an old link - is
 * the default rather than a fourth, blank mode. And a logged out reader asking
 * for „ludzie" gets „umowy": they came from a search result for contracts, so
 * a redirect to /login would be an eviction and an empty page would be a
 * broken one.
 */
const view = computed<Mode>(() => {
  const asked = (MODES as readonly string[]).includes(tryb.value)
    ? tryb.value
    : "powiazania";
  if (!signedIn.value && !PUBLIC_MODES.includes(asked)) return "powiazania";
  return asked;
});

/** The locked chip: create an account, then come back to the people. Its
 * own `powod`, so the accounts it brings are not counted as the findings'. */
const peopleLoginLink =
  "/login?konto=nowe&powod=ludzie&redirect=" +
  encodeURIComponent("/eksploruj/umowy?tryb=ludzie");

/** The url parameters each public mode owns. Leaving a mode drops them:
 * „?woj=mazowieckie" carried into the contract list, which has no such
 * filter, is a parameter the page silently ignores. */
const MODE_PARAMS: Partial<Record<Mode, string[]>> = {
  powiazania: ["kolejnosc", "status", "woj", "klasa", CONTRACT_LINK_PARAM],
  umowy: ["sort", "zakres", CONTRACT_PARAM],
};

/** The mode switch writes here, so that picking „Powiązania" drops `?tryb`
 * instead of spelling the default out. */
const mode = computed<Mode>({
  get: () => view.value,
  set: (value) => {
    const patch: QueryPatch = {
      tryb: value === "powiazania" ? undefined : value,
    };
    for (const [owner, keys] of Object.entries(MODE_PARAMS)) {
      if (owner === value) continue;
      for (const key of keys) patch[key] = undefined;
    }
    void setQuery(patch);
  },
});

// `authReady` and `hydrated` are the whole point of the guard: `signedIn` is
// false until firebase has restored (or ruled out) the session *and* the
// server's html has been hydrated, so a correction that read it any earlier
// would strip `?tryb=ludzie` out of the url of a signed-in reader's very first
// render. Client only on top of that, to keep a router write off the SSR path
// altogether.
//
// The query is a source too. `ContractLinkView` writes its own correction -
// „?woj=Podlaskie" to „podlaskie" - from the same `route.query` in the same
// tick, and the later of two replaces wins: this one's lost, and an anonymous
// reader was left on „Powiązania" under a url saying `tryb=ludzie`, which the
// register links then carried into the new account. Re-run once the other
// lands, it finds the `tryb` still wrong and corrects it; the second pass of
// either is a no-op.
//
// `replace` and not `push`, because a correction the back button walks back
// into gets corrected again - that is the trap this avoids rather than a style
// preference.
if (import.meta.client) {
  watch(
    [authReady, hydrated, view, tryb, () => route.query],
    () => {
      if (!authReady.value || !hydrated.value) return;
      if (tryb.value === view.value) return;
      void setQuery(
        { tryb: view.value === "powiazania" ? undefined : view.value },
        { replace: true },
      );
    },
    { immediate: true },
  );
}

const query = computed(() => ({ sort: sort.value, zakres: zakres.value }));

/** Whether this mode prints the register's figures - every mode but the
 * findings, which carry their own. */
const needsCoverage = computed(() => view.value !== "powiazania");

// The register's coverage figures, and nothing else, and only in the modes
// that print them. This used to be the contract list itself, fetched in every
// mode to share `ContractFeed`'s request - which put twenty contracts into the
// payload of the findings page, the one most readers open, where nothing shows
// them. Now „Powiązania" asks for no contracts at all.
//
// One row is the smallest page the route serves; `pick` keeps even that out of
// the payload. The feed asks for its own rows. `/api/contracts/people` carries
// the same figures (both build them with `readCoverage`), but they are fetched
// here in the signed-in modes too, so those print them before their own, much
// slower answer lands.
//
// `enabled` turns the request off in „Powiązania" - on the server too - but
// does not turn it back on; the watcher below does, when the reader switches.
const { data: coverageAnswer, refresh: refreshCoverage } =
  useFetch<ContractListResponse>(CONTRACTS_ENDPOINT, {
    key: "contracts-coverage",
    query: { limit: 1 },
    pick: ["coverage"],
    enabled: needsCoverage,
    watch: false,
  });
if (import.meta.client) {
  watch(needsCoverage, (needed) => {
    if (needed && !coverageAnswer.value) void refreshCoverage();
  });
}

const coverage = computed(
  () => coverageAnswer.value?.coverage ?? peopleData.value?.coverage ?? null,
);

/** Nothing ingested at all, as distinct from nothing matching a filter. Only
 * ever true against a fresh stack; `coverage` is null until the first response
 * lands, and a null one is not an empty one. „Powiązania" has no `coverage`
 * and says so in its own list. */
const empty = computed(
  () => needsCoverage.value && coverage.value?.total === 0,
);

const peopleSort = ref<"umowy" | "suma" | "ostatnia">("umowy");
const stan = ref<"all" | "opublikowane" | "nasze">("all");

/** The window the reader has asked for so far. Held here rather than in the
 * url: it is a cost (roughly 500 reads a click, uncached by construction) and
 * not a view somebody would send to somebody else. */
const cursor = ref<string | undefined>(undefined);
const pages = ref(1);

const peopleData = ref<ContractPeopleResponse | null>(null);
const peoplePending = ref(false);

/** Everyone loaded so far, across however many windows were asked for.
 *
 * Accumulated rather than replaced because „dobiera następne trzydzieści" means
 * the list grows. The windows are disjoint sets of institutions - the endpoint
 * pages `contractStats` by contract count - so a person on two boards thirty
 * places apart arrives twice, describing a different seat each time, and the
 * two halves have to be added rather than one of them dropped.
 */
const people = ref<PersonRowData[]>([]);

/** Which request the answer on screen belongs to. A filter changed mid-flight
 * means the answer in the air is about a question nobody is asking any more,
 * and it must not land on top of the newer one. */
let inFlight = 0;

/**
 * Loads the signed-in rows - by hand, rather than through `useContractPeople`.
 *
 * A `useFetch` fires the moment it is registered and there is no way to hold it
 * back, so one registered in this setup would run the thirty-institution,
 * ~500-read people query for every signed-in reader who only ever looks at the
 * public list - which is now this page's default and most of its traffic. It
 * would also make SSR wait on a request whose output is inside `<ClientOnly>`.
 *
 * `authRequest` is what this repo uses for a load that a click triggers (see
 * its docstring, and `useContractPeople`'s: a second `useFetch` on one key
 * aborts the first). It waits for firebase before it reads the token, so the
 * answer is never the anonymous one - three counts with every name withheld.
 */
async function loadPeople() {
  // Only the two people modes load people; the other two are public lists
  // with requests of their own.
  if (view.value !== "ludzie" && view.value !== "obie") return;
  const request = ++inFlight;
  peoplePending.value = true;
  try {
    const answer = await authRequest<ContractPeopleResponse>(
      `${CONTRACTS_ENDPOINT}/people`,
      {
        method: "GET",
        query: {
          mode: view.value,
          sort: peopleSort.value,
          stan: stan.value,
          cursor: cursor.value,
        },
      },
    );
    if (request !== inFlight) return;
    peopleData.value = answer;
    people.value = sortPeople(
      pages.value > 1
        ? mergePeople(people.value, answer.people)
        : [...answer.people],
    );
  } catch (error) {
    // Whatever is already on screen stays there. The alternative - blanking the
    // rows - turns a dropped connection into „Nikogo nie znamy we władzach",
    // which is a claim about the graph rather than about the network.
    console.error("Nie udało się pobrać ludzi z umów", error);
  } finally {
    if (request === inFlight) peoplePending.value = false;
  }
}

// A different question is a different list. Resetting the cursor here and not
// in the click handler keeps the two from disagreeing after a filter change
// mid-page. `view` is in the list because the reader is only read after
// hydration: the reader who arrived on `?tryb=ludzie` is anonymous at setup and
// signed in immediately afterwards, and that transition is what fetches for
// them.
if (import.meta.client) {
  watch(
    [view, peopleSort, stan],
    () => {
      cursor.value = undefined;
      pages.value = 1;
      people.value = [];
      void loadPeople();
    },
    { immediate: true },
  );
}

const nextCursor = computed(() => peopleData.value?.nextCursor ?? null);

/** How many institutions the rows below actually cover. `windowSize` is what
 * one fetch looked at; a reader who has pressed „Pokaż kolejne instytucje"
 * twice is reading sixty, and the note above the list has to say sixty. */
const shownInstitutions = computed(
  () => (peopleData.value?.windowSize ?? 0) * pages.value,
);

/** Null until an answer has landed, so the tile is absent rather than reading
 * „0 umów w oknie" while the request is still in the air. */
const windowContracts = computed<number | null>(
  () => peopleData.value?.windowContracts ?? null,
);

function extendWindow() {
  if (!nextCursor.value) return;
  pages.value += 1;
  cursor.value = nextCursor.value;
  void loadPeople();
}

/** Adds a window to the ones already shown, joining the two halves of anybody
 * who appears in both. The counts add because the institutions behind them are
 * disjoint; `lastSignedAt` takes the later of the two. */
function mergePeople(
  current: PersonRowData[],
  incoming: PersonRowData[],
): PersonRowData[] {
  const byId = new Map(current.map((row) => [row.person.id, row]));
  for (const row of incoming) {
    const existing = byId.get(row.person.id);
    if (!existing) {
      byId.set(row.person.id, row);
      continue;
    }
    byId.set(row.person.id, {
      ...existing,
      companies: [...existing.companies, ...row.companies],
      contractCount: existing.contractCount + row.contractCount,
      totalValue: existing.totalValue + row.totalValue,
      lastSignedAt:
        (row.lastSignedAt ?? "") > (existing.lastSignedAt ?? "")
          ? row.lastSignedAt
          : existing.lastSignedAt,
    });
  }
  return [...byId.values()];
}

/** The endpoint orders each window; two windows concatenated are not ordered,
 * and a merged row's totals are not the ones the server sorted on. Re-applied
 * here for that reason, by the same key the reader chose. */
function sortPeople(rows: PersonRowData[]): PersonRowData[] {
  const key = peopleSort.value;
  return [...rows].sort((a, b) => {
    if (key === "suma") return b.totalValue - a.totalValue;
    if (key === "ostatnia")
      return (b.lastSignedAt ?? "").localeCompare(a.lastSignedAt ?? "");
    return b.contractCount - a.contractCount;
  });
}

const bothRows = computed<ContractRowData[]>(
  () => peopleData.value?.rows ?? [],
);

/** Who is on both ends of one contract, computed from the very strips printed
 * under the row rather than from a flag beside them - so the note can never
 * name somebody the row does not show. A person counts when they appear in more
 * than one party's people list. */
function bothSidesNames(row: ContractRowData): string[] {
  const seen = new Map<string, { name: string; sides: number }>();
  for (const party of row.people ?? []) {
    for (const person of party.people) {
      const entry = seen.get(person.id);
      if (entry) entry.sides += 1;
      else seen.set(person.id, { name: person.name, sides: 1 });
    }
  }
  return [...seen.values()].filter((e) => e.sides > 1).map((e) => e.name);
}

/** About the findings, because they are what the bare url opens on and what
 * a shared link previews - the raw register is one chip away. The brand is
 * left to the site's title template, which adds it once. */
const description =
  "Firmy, które według KRS prowadzą albo współposiadają radni, wójtowie, kandydaci w wyborach samorządowych lub ich bliscy, i instytucje publiczne, które im zapłaciły. Dane z Centralnego Rejestru Umów, KRS i PKW.";

useSeoMeta({
  title: "Umowy publiczne: kto komu zapłacił",
  description,
  ogTitle: "Umowy publiczne: kto komu zapłacił",
  ogDescription: description,
  ogImage: SOCIAL_CARD,
  twitterCard: "summary_large_image",
  twitterImage: SOCIAL_CARD,
});

// Always the bare `/eksploruj/umowy`, whatever `?tryb`, `?sort`, `?zakres` or
// `?umowa` says. Four orderings of the same 149 683 rows are four near-duplicate
// crawl targets, every shared expanded-row link would be a fifth, and the two
// signed-in modes render nothing at all to a crawler; one crawlable url, one
// sitemap entry, and the filters stay shareable because a 302 nobody issues
// cannot be cached wrong.
useHead({
  link: [{ rel: "canonical", href: "https://koryta.pl/eksploruj/umowy" }],
});
</script>

<style scoped>
/* Centred in the layout's 1200px container rather than filling it. 900px is
   about 100 characters of the subject line at this type size, which is where a
   line stops being comfortable to read. */
/* A wash behind the rows, and the reason is the same as the hero band's: a
   `.k-card` is `background: surface` with a 16%-opacity hairline, so on the
   `surface` page the list read as text floating on nothing - „very blank ... it
   doesn't have any background color". `surface.muted` is the site's own neutral
   tint (it already backs counts, inactive chips and table zebra) and puts just
   enough distance between the white cards and the page for them to read as
   cards. `ink.neutral` on it measures 5.75:1, so nothing that lands here needs
   a contrast exception.

   Bled to the viewport edges below `sm` with negative margins rather than
   inset: at 375px the layout already spends 16px a side, and a tinted panel
   inside that gutter reads as a box someone drew rather than as the ground the
   list sits on. A media query and not `useDisplay()`, which under SSR reports
   mobile for everyone. */
.umowy__list {
  background: rgb(var(--v-theme-surface-muted));
  border-radius: 10px;
  max-width: 900px;
  padding: 12px;
}

/* A thumb's worth on a phone: at 26px the mode chips - the locked one is the
   first ask on the page - were the most mis-tapped thing on it. */
@media (max-width: 599.98px) {
  .umowy__modes :deep(.v-chip) {
    --v-chip-height: 44px;
  }
}

@media (max-width: 599.98px) {
  .umowy__list {
    border-radius: 0;
    margin-left: -16px;
    margin-right: -16px;
    padding: 12px 16px;
  }
}
</style>
