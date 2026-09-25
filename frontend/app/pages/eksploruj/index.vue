<template>
  <div>
    <h1 class="text-h5 text-sm-h4 mb-1">Eksploruj dane</h1>

    <p class="text-body-2 text-ink-neutral mb-5">
      Dziesięć wejść do tej samej bazy: ludzie i ich stanowiska, pieniądze z
      rejestru umów, rady szpitali, wykresy i lista źródeł. Każde pokazuje inny
      wycinek — zacznij od tego, które odpowiada na Twoje pytanie.
    </p>

    <v-row data-testid="explore-ways">
      <!-- `d-flex` on the column and `flex-grow-1` on the card: without it
           a card is only as tall as its own text, so a row of three ends
           ragged and the counts - which sit on the bottom edge - land at three
           different heights. -->
      <v-col
        v-for="way in ways"
        :key="way.key"
        cols="12"
        md="6"
        lg="4"
        class="d-flex"
      >
        <NuxtLink
          :to="way.to"
          class="k-card link-plain way d-flex flex-column pa-4 flex-grow-1"
          :data-testid="`explore-way-${way.key}`"
        >
          <!-- `flex-wrap`, because the badge is `nowrap` and the title beside
               it is not allowed to be squeezed below its longest word: on a
               375px phone „Umowy publiczne" plus „nowość" fits, but nothing
               here should be the reason the page gains a sideways scrollbar
               if either string is ever made longer. The badge drops to its own
               line instead. -->
          <div class="d-flex flex-wrap align-center ga-3 mb-2">
            <!-- The tint is the fill and the ink comes with it: `bg-surface-sage`
                 sets `on-surface-sage` too, so the icon is ink.sage (5.57:1 on
                 it) rather than the 1.85:1 `color="primary"` would paint. -->
            <span
              class="way__icon bg-surface-sage d-inline-flex align-center justify-center"
            >
              <v-icon :icon="way.icon" size="22" />
            </span>
            <h2 class="text-subtitle-1 font-weight-medium">{{ way.title }}</h2>
            <span v-if="way.badge" class="way__badge" :class="way.badge.class">
              {{ way.badge.label }}
            </span>
          </div>

          <p class="text-body-2 text-ink-neutral mb-0">{{ way.description }}</p>

          <!-- Only where there is a number to print. Half of these pages have
               none that this one response can answer for, and „—" in five of
               ten cards would say we lost the figure rather than that the page
               is not counted this way. -->
          <p v-if="way.count" class="way__count mt-auto pt-3 mb-0">
            {{ way.count }}
          </p>
        </NuxtLink>
      </v-col>
    </v-row>

    <p v-if="asOf" class="text-caption text-ink-neutral mt-5 mb-0">
      Liczby ze stanu bazy z {{ asOf }}. Odświeżamy je co sześć godzin.
    </p>
  </div>
</template>

<script setup lang="ts">
import {
  mdiAccountPlusOutline,
  mdiCakeVariantOutline,
  mdiCashMultiple,
  mdiChartBoxOutline,
  mdiChartDonut,
  mdiGraphOutline,
  mdiHospitalBuilding,
  mdiNewspaperVariantOutline,
  mdiTableLarge,
  mdiTagMultipleOutline,
} from "@mdi/js";
import { polishCountingGrouped } from "~/composables/polish";
import type { DatabaseStats } from "~~/server/api/stats/database.get";

/** The directory of everything a reader can do with this data.
 *
 * `/eksploruj` was a 404 until now: every page under it was reachable only
 * from a link somebody already knew about - the app bar carries Tematy, O nas
 * and „Działaj z nami" and nothing else - so the section had six pages and no
 * front door. It is also the natural parent of every explore route for a
 * crawler, which is why it is server rendered and indexable while half of what
 * it links to is not.
 *
 * Dense on purpose. The complaint that started this was that the contracts
 * page reads „pretty pale”, and a directory is where that is easiest to repeat:
 * ten grey links one under another say nothing about what is behind them. So
 * every entry carries an icon, a sentence about what you can actually find
 * there, and - where this one response can answer for it honestly - a real
 * count.
 */
definePageMeta({ maxWidth: 1200 });

const description =
  "Wszystkie sposoby przeglądania koryta.pl w jednym miejscu: tabela ludzi i ich stanowisk, umowy z Centralnego Rejestru Umów, rady szpitali, okrągłe staże, statystyki, wizualizacje i źródła.";

useSeoMeta({
  title: "Eksploruj dane - koryta.pl",
  description,
  ogTitle: "Eksploruj dane",
  ogDescription: description,
});

/** One request, and one that somebody else is already paying for.
 *
 * `/api/stats/database` is a census of the whole database - 325 248 Firestore
 * reads over a measured 28 hours, 16,5% of everything the site read - but it
 * sits behind a six-hour shared cache under the name `stats-database`, so this
 * page joining /eksploruj/statystyki on that one entry costs nothing extra.
 * That is also why there is no second call here: any number these cards do not
 * get from this response is left off the card rather than fetched.
 *
 * `pick` because the response is far bigger than the five figures used below -
 * the people, notes and vote breakdowns and the publication buckets would
 * otherwise all be serialised into the html payload of a landing page.
 *
 * Awaited, not lazy: the counts are most of what makes this page worth
 * indexing, and a card that grows a line after hydration moves everything
 * under it.
 */
const { data: stats } = await useFetch<DatabaseStats>("/api/stats/database", {
  pick: ["nodes", "edges", "generatedAt"],
});

type Way = {
  key: string;
  to: string;
  /** An mdi *path* - this app renders icons as svg paths, not class names. */
  icon: string;
  title: string;
  description: string;
  /** Already formatted and declined, or absent. See the template. */
  count?: string;
  badge?: { label: string; class: string };
};

/** A count, or nothing at all when the stats call did not land.
 *
 * Every figure here is in the thousands, so it is `polishCountingGrouped` and
 * not `polishCounting`: „10348 osób” beside a „10 348 osób” elsewhere on the
 * site reads as a different number rather than the same one.
 */
function counted(
  value: number | undefined,
  singular: string,
  plural: string,
  genitive: string,
  suffix = "",
): string | undefined {
  if (typeof value !== "number") return undefined;
  return polishCountingGrouped(value, singular, plural, genitive) + suffix;
}

const ways = computed<Way[]>(() => {
  const nodes = stats.value?.nodes;
  return [
    {
      key: "tabela",
      to: "/eksploruj/tabela",
      icon: mdiTableLarge,
      title: "Tabela ludzi",
      description:
        "Wszyscy, o których cokolwiek wiemy, w jednej tabeli. Filtruj po regionie, partii, branży i po tym, gdzie ktoś pracuje dziś.",
      // Every person node, not the published subset: 8 277 of the 10 348 are
      // unpublished, and how many of them a given reader sees depends on the
      // filters and on whether they are signed in. „w bazie" is what keeps the
      // headline honest about which of the two it is.
      count: counted(nodes?.people, "osoba", "osoby", "osób", " w bazie"),
    },
    {
      key: "umowy",
      to: "/eksploruj/umowy",
      icon: mdiCashMultiple,
      title: "Umowy publiczne",
      // The scope the page's own meta description gives. „Radni i ich firmy,
      // którym płaci ich samorząd" fitted about a third of the findings: half
      // are about candidates who never won, and many are paid from outside
      // the territory of the office.
      description:
        "Firmy radnych, wójtów, kandydatów w wyborach samorządowych i ich bliskich — i instytucje publiczne, które im zapłaciły. Obok wszystkie umowy z rejestru.",
      // No count: the number of contracts is not in `/api/stats/database` and
      // a second request for one figure is exactly what this page is not going
      // to do. The chip is the density instead.
      //
      // It has a shelf life. Take it off once the feature stops being the
      // newest thing here - say after October 2026 - or it becomes a chip that
      // has always been there and means nothing.
      badge: { label: "nowość", class: "bg-surface-sage" },
    },
    {
      key: "nowe",
      to: "/eksploruj/nowe",
      icon: mdiAccountPlusOutline,
      title: "Nowi ludzie",
      description:
        "Kogo dopiero znaleźliśmy w rejestrach i kto czeka na sprawdzenie, zanim trafi na stronę.",
      // `/eksploruj/nowe` carries `middleware: "auth"`, so an anonymous reader
      // who taps this card is bounced to /login with a `reason=unauthorized`.
      // Saying so on the card is cheaper than the bounce.
      badge: { label: "po zalogowaniu", class: "bg-surface-muted" },
    },
    {
      key: "staz",
      to: "/eksploruj/staz",
      icon: mdiCakeVariantOutline,
      title: "Okrągły staż",
      description:
        "Komu w tym miesiącu wypada równa rocznica w instytucjach publicznych: 10, 15 albo 25 lat.",
    },
    {
      key: "szpitale",
      to: "/eksploruj/szpitale",
      icon: mdiHospitalBuilding,
      title: "Rady szpitali",
      description:
        "Kto zasiada w radach społecznych i nadzorczych szpitali w całym kraju - i skąd tam trafił.",
    },
    {
      key: "statystyki",
      to: "/eksploruj/statystyki",
      icon: mdiChartBoxOutline,
      title: "Statystyki",
      description:
        "Ile już zebraliśmy, ile z tego ktoś sprawdził i co przybyło w ostatnich dniach.",
      // Every page the site has: people, institutions, regions and articles.
      // „w serwisie" and not „w bazie" a card above, because the two counts
      // are different things and identical wording would read as one figure
      // contradicting the other.
      count: counted(nodes?.total, "strona", "strony", "stron", " w serwisie"),
    },
    {
      key: "autograf",
      to: "/eksploruj/autograf",
      icon: mdiChartDonut,
      title: "Autograf",
      description:
        "Wizualizacje: spółki i partie na jednym wykresie, żeby zobaczyć rozkład zamiast czytać wiersze.",
      // `place` is both - a state company and a ministry are the same node
      // type - so one count covers „instytucji i spółek".
      count: counted(
        nodes?.places,
        "instytucja",
        "instytucje",
        "instytucji",
        " i spółek",
      ),
    },
    {
      key: "graf",
      to: "/graf",
      icon: mdiGraphOutline,
      title: "Graf połączeń",
      description:
        "Sieć ludzi i instytucji. Klikasz w osobę, a graf dorysowuje jej otoczenie.",
      count: counted(
        stats.value?.edges,
        "powiązanie",
        "powiązania",
        "powiązań",
      ),
    },
    {
      key: "tematy",
      to: "/tematy",
      icon: mdiTagMultipleOutline,
      title: "Tematy",
      description:
        "Sprawy, które śledzimy przez wiele artykułów naraz, z grafem osób i instytucji w każdej z nich.",
    },
    {
      key: "zrodla",
      to: "/zrodla",
      icon: mdiNewspaperVariantOutline,
      title: "Źródła",
      description:
        "Skąd bierzemy dane: artykuły prasowe, KRS i inne rejestry, z linkiem do każdego z osobna.",
      count: counted(nodes?.articles, "artykuł", "artykuły", "artykułów"),
    },
  ];
});

/** When the numbers were computed, printed from the payload rather than from
 * `Date.now()`.
 *
 * The zone is spelled out because this runs on a UTC box: without it the page
 * would print the previous day for anything generated before 02:00 Warsaw
 * time. And it is derived from `generatedAt` and nothing else, so the server's
 * html and the client's hydration agree even when the page is served from the
 * hour-long `swr` copy.
 */
const asOf = computed(() => {
  const iso = stats.value?.generatedAt;
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(parsed);
});
</script>

<style scoped>
.way {
  /* The whole card is the tap target, not the words in it: on a phone these
     rows are the navigation, and a 16px link inside a 140px card is a target
     you miss. `color: inherit` comes from `.link-plain`. */
  min-height: 100%;
}

/* `.link-plain` underlines the link on hover and on focus, which when the link
   is the whole card means underlining the title, the description and the count
   at once. `.k-card:hover` already answers with a sage border and a shadow, so
   the underline moves to the title alone - the same trade `stats/StatTile.vue`
   makes for its value. */
.way:hover,
.way:focus-visible {
  text-decoration: none;
}

.way:hover h2,
.way:focus-visible h2 {
  text-decoration: underline;
}

.way:focus-visible {
  /* The card is a 140px target with no visible edge of its own until hover, so
     keyboard focus needs a mark that does not depend on it. */
  outline: 2px solid rgb(var(--v-theme-ink-sage));
  outline-offset: 2px;
}

.way__icon {
  border-radius: 10px;
  /* Fixed, so a two-line title cannot stretch the square into a rectangle. */
  flex: 0 0 auto;
  height: 40px;
  width: 40px;
}

.way__badge {
  border-radius: 6px;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.4;
  padding: 1px 6px;
  /* „po zalogowaniu" is 14 characters and sits after the title; without this
     it breaks after „po" on a 375px screen. The title above it wraps instead,
     which is what there is room for. */
  white-space: nowrap;
}

.way__count {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 0.95rem;
  font-weight: 600;
}
</style>
