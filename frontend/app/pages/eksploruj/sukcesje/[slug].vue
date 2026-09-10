<template>
  <!-- The whole page, not just the data. `app/middleware/auth.ts:4` returns
       early on the server, so an SSR pass renders this route in full for an
       anonymous crawler and only the browser redirects them - and anything
       fetched during that pass goes out unauthenticated and comes back
       redacted. There is nothing here worth serialising for a reader who is
       about to be sent to /login. -->
  <ClientOnly>
    <div class="py-4 px-0 pa-sm-4 w-100" data-testid="succession-chain">
      <h1 class="text-h5 text-sm-h4 mb-2">{{ heading }}</h1>

      <!-- Said once, at the top, rather than on every card: the caveat is the
           same for all of them, and it is the whole difference between this
           page and „Zmiany na stanowisku” on a person's own page. -->
      <div data-testid="chain-lead">
        <p class="text-body-2 text-medium-emphasis mb-4">
          Rejestr nie zapisuje, kto po kim objął stanowisko. Zapisuje tylko, że
          jednej osobie kadencja się skończyła, a drugiej zaczęła - w tej samej
          instytucji i w tej samej funkcji. Pokazujemy tu wszystkie osoby, które
          pasują do tych dat: po lewej te, po których ta osoba mogła objąć
          stanowisko, po prawej te, które mogły objąć je po niej.
        </p>

        <p class="text-body-2 text-medium-emphasis mb-4">
          To są możliwości, a nie ustalenia. W sekcji „Zmiany na stanowisku” na
          stronie osoby dobieramy pary jeden do jednego, żeby nie twierdzić
          więcej, niż wiadomo - tutaj nie wybieramy jednej odpowiedzi. Łączymy
          wpisy oddalone od siebie najwyżej o 120 dni przerwy albo 90 dni
          nachodzenia na siebie.
        </p>

        <p class="text-body-2 text-medium-emphasis mb-4">
          Obie kolumny zbierają kandydatów ze wszystkich stanowisk tej osoby
          naraz, więc instytucja i funkcja są podpisane przy każdym nazwisku.
        </p>
      </div>

      <!-- Rendered above the chain rather than instead of it, the way
           /eksploruj/tabela and /eksploruj/autograf do. The route is behind
           `middleware: "auth"`, so this is only ever on screen for the tick
           before the redirect fires - or for a reader whose session has gone
           stale under them, who is better served by being told why the page
           emptied than by an empty page. -->
      <ExploreLoginBanner
        v-if="!user"
        data-testid="chain-login"
        message="Łańcuch następstw pokazujemy tylko zalogowanym: większość osób w rejestrze nie ma jeszcze opublikowanej strony, więc bez zalogowania ta strona byłaby prawie pusta."
      />

      <v-alert
        v-if="failed"
        class="mb-4"
        data-testid="chain-error"
        text="Nie udało się wczytać łańcucha. Odśwież stronę."
        type="error"
        variant="tonal"
      />

      <div v-else-if="loading" class="text-center py-8">
        <v-progress-circular data-testid="chain-pending" indeterminate />
      </div>

      <!-- Not a 404. The id is the last dash segment of the slug and Firestore
           ids are case sensitive, so the overwhelmingly likely cause is a link
           that lost its capitals on the way here - which is worth saying out
           loud rather than answering with the site's not-found page. -->
      <v-alert
        v-else-if="notFound"
        class="mb-4"
        data-testid="chain-not-found"
        text="Nie znaleźliśmy takiej osoby. Sprawdź adres - identyfikator na końcu jest wrażliwy na wielkość liter."
        type="info"
        variant="tonal"
      />

      <template v-else>
        <!-- The redaction counter, and only for the focus person: a deeper node
             carries its own, next to the person it belongs to. Register-wide
             most people have no published page, so this line is the normal
             case rather than an edge one. -->
        <p
          v-if="hidden > 0"
          class="text-body-2 text-medium-emphasis mb-4"
          data-testid="chain-hidden"
        >
          {{ hiddenLine }}
        </p>

        <!-- Shown next to the chain rather than in place of it: the layouts
             still draw the person and their posts, and „nikt nie pasował” is
             a different answer from „nie ma czego pokazać”. Two thirds of all
             spells in the register have no neighbour at all, so this is the
             most common ending of all. -->
        <v-alert
          v-if="empty"
          class="mb-4"
          data-testid="chain-empty"
          text="Nie znaleźliśmy nikogo, kto pasowałby datami do stanowisk tej osoby. Brak dopasowania nie znaczy, że stanowisko było nowe - częściej w rejestrze brakuje drugiej strony zmiany albo druga osoba nie ma jeszcze u nas swojej strony."
          type="info"
          variant="tonal"
        />

        <!-- The picture of what is open, over the controls that opened it. It
             is handed the same `nodes` array the columns get and nothing else:
             one composable, one state, no second request - so a graph that
             disagreed with the columns underneath would have to be a bug in
             the drawing rather than in what was fetched.

             The sentence below is the page's own framing, not a repeat of the
             figure's caption: the caption sits under the picture and says how
             to read one arrow, this says what the whole thing is and what it
             still is not. It is dropped where nothing matched at all - the
             figure is then a single dot that will never grow an arrow, and
             promising one over it would be the page describing a picture that
             is not there. -->
        <p
          v-if="!empty"
          class="text-body-2 text-medium-emphasis mb-2"
          data-testid="chain-graph-lead"
        >
          Nad kolumnami rysujemy to, co już rozwinięto - każda kropka to jedna
          osoba z łańcucha, a strzałki układają je w kolejności, w jakiej
          przechodziło stanowisko. To nadal dopasowania po datach, a nie
          ustalenia: do jednej zmiany w rejestrze pasuje zwykle kilka osób naraz
          i żadnej z nich tu nie wskazujemy.
        </p>

        <SuccessionChainGraph :nodes="nodes" :focus-key="focusKey" />

        <SuccessionChainColumns
          :nodes="nodes"
          :focus-key="focusKey"
          @expand="expand"
          @collapse="collapse"
          @retry="retry"
        />
      </template>
    </div>
  </ClientOnly>
</template>

<script lang="ts" setup>
import { useCurrentUser } from "vuefire";
import { parseEntityUrlSlug } from "~/composables/slugs";
import { polishCounting } from "~/composables/polish";
import {
  useSuccessionChain,
  type ExpandPayload,
} from "~/composables/successionChain";

definePageMeta({
  // Client only, by `app/middleware/auth.ts:4` - the server renders this route
  // for anybody. The template is wrapped in `<ClientOnly>` for that reason and
  // the fetch happens in the browser, after the redirect has had its chance.
  middleware: "auth",
  // Does nothing on this route and is set anyway: @nuxtjs/robots keys its
  // page-meta map by `page.path` and looks it up by the exact request path, so
  // `/eksploruj/sukcesje/:slug()` never matches `/eksploruj/sukcesje/jan-1`.
  // The `robots.disallow` entry in nuxt.config.ts is what actually keeps this
  // page out; this stays so that the intent is visible where the page is, and
  // so it starts working if the module ever learns about dynamic routes.
  robots: false,
  // The columns grow sideways without bound, so the 1200px the default layout
  // otherwise caps a page at would be spent on nothing but the first two
  // columns.
  fullWidth: true,
});

const route = useRoute();

// `useCurrentUser` rather than `useAuthState`: all this needs is whether
// somebody is signed in, and `useAuthState` also opens a Firestore
// subscription to their user-config document - a read on every load for a flag
// it never looks at.
const user = useCurrentUser();

/** The person the page is about.
 *
 * `parseEntityUrlSlug` and nothing else: the id is the last dash separated
 * segment of the slug, which is why node ids in this codebase must not contain
 * a hyphen. It is also case sensitive, which the not-found copy says out loud.
 */
const personId = computed(
  () => parseEntityUrlSlug(String(route.params.slug ?? "")).id,
);

/** The chain itself.
 *
 * Built once, for the id the page was opened with. A different person is a
 * different url and so a different page instance - there is no in-place
 * re-rooting to support, and pretending otherwise would mean throwing away
 * every answer already loaded the moment somebody edited the address bar.
 *
 * Deliberately not awaited. Nothing above depends on it, and awaiting would
 * hold a client side navigation into this route on one request, which is the
 * same reason `usePersonSuccessions` does not await its own.
 */
const chain = personId.value ? useSuccessionChain(personId.value) : null;

const nodes = computed(() => chain?.nodes.value ?? []);
const focusKey = chain?.focusKey ?? "root";
const loading = computed(() => chain?.loading.value ?? false);
const failed = computed(() => chain?.failed.value ?? false);

function expand(payload: ExpandPayload) {
  chain?.expand(payload);
}

function collapse(nodeKey: string) {
  chain?.collapse(nodeKey);
}

function retry(nodeKey: string) {
  chain?.retry(nodeKey);
}

/** The focus person, once their own request has landed. */
const focus = computed(() => nodes.value.find((n) => n.key === focusKey));

const focusName = computed(() => focus.value?.personName ?? "");

/** An empty name on a settled request is the endpoint saying "not for you, or
 * not a person": it answers 200 with an empty step rather than a 404, because
 * a failed expansion deeper in the chain is a card and not a broken page. At
 * the focus it is the whole page, so it is drawn as one.
 *
 * A slug with no id at all - `/eksploruj/sukcesje/-`, or a link truncated
 * after the trailing dash - is the same answer arrived at without a request.
 * Without this it was neither loading, nor failed, nor found: the page drew
 * its heading over an empty strip with no toggle and no explanation, which
 * reads as a page that broke rather than an address that is wrong.
 */
const notFound = computed(
  () =>
    !personId.value ||
    (focus.value?.status === "ready" && focusName.value === ""),
);

const empty = computed(
  () =>
    focus.value?.status === "ready" &&
    focusName.value !== "" &&
    focus.value.predecessors.length === 0 &&
    focus.value.successors.length === 0,
);

const hidden = computed(() => focus.value?.step?.hidden ?? 0);

const hiddenLine = computed(
  () =>
    `Nie pokazujemy ${polishCounting(hidden.value, "osoby", "osób", "osób")} - brakuje ich stron, więc nie nazywamy ich tutaj.`,
);

const heading = computed(
  () => `Łańcuch następstw${focusName.value ? `: ${focusName.value}` : ""}`,
);

// `useHead` rather than `useSeoMeta`: the page is disallowed in robots.txt and
// linked from nowhere public, so a description and an og:image would be
// furniture for a crawler that is not coming. The title is for the reader's own
// tab strip, which is why it carries the person's name once it is known.
useHead({
  title: computed(() => `${heading.value} - koryta.pl`),
});
</script>
