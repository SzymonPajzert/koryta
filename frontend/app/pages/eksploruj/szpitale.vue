<template>
  <!-- The container this sits in already pads 16px, so `pa-4` spent a fifth of
       a 375px screen on nothing before a word was read. Kept from `sm` up,
       where there is room for it. -->
  <div class="py-4 px-0 pa-sm-4">
    <!-- The heading and nothing else. The standfirst that stood here said what
         a rada nadzorcza is, what we show and what we leave out - all three of
         which the chart's own subtitle and the note under it say again, in
         front of the numbers they qualify. The button beside it went to
         /eksploruj/statystyki, which is the editors' page and not where a
         reader of this one is going next. -->
    <h1 class="text-h5 text-sm-h4 mb-4">Rady nadzorcze szpitali publicznych</h1>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      text="Nie udało się pobrać danych o radach nadzorczych szpitali."
    />

    <v-alert
      v-else-if="empty"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-4"
      text="Nie mamy jeszcze w bazie ani jednego miejsca w organie nadzoru szpitala publicznego. Liczby szpitali są prawdziwe, podziału na partie jeszcze nie ma."
    />

    <!-- ------------------------------------------------------------------ -->
    <!-- The chart opens the page. It is the answer somebody came here for, and
         everything that used to sit above it - the five counts, the composition
         bar, the exclusion note - is context for reading it rather than a way
         in. On a phone that was three screens of preamble before the first bar.
         They follow it now, in the same order. -->
    <!-- No heading over this. „Podział na partie" stopped being true when the
         chart gained a województwo and a szpital split, and the card below
         titles itself with whichever one is showing - so the h2 was a line of
         vertical space spent restating the card underneath it. The toggle it
         used to share a row with stays: it is the one control above everything
         it scopes, and the chart and the hospitals below change together. -->
    <div class="d-flex align-center flex-wrap ga-3 mb-1">
      <v-btn-toggle
        v-model="group"
        density="compact"
        variant="outlined"
        divided
        mandatory
      >
        <v-btn
          v-for="value in boardGroups"
          :key="value"
          :value="value"
          size="small"
        >
          {{ boardGroupShortLabels[value] }}
        </v-btn>
      </v-btn-toggle>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-3">
      {{ boardGroupLabels[group] }}
    </p>

    <v-row class="mb-4">
      <v-col cols="12">
        <StatsHospitalBreakdown
          v-model:dimension="breakdown"
          :title="chartTitle"
          :subtitle="chartSubtitle"
          :rows="breakdownRows"
          :loading="pending"
          :can-see-drafts="!!user"
          :empty-text="emptyText"
        />
      </v-col>
    </v-row>

    <!-- The exclusion, directly under the chart it applies to, because it is
         the one thing a reader has to understand to read those numbers. It also
         has to be prominent for a second reason: a rada społeczna is the body
         actually filled with radni and officials, so a reader who notices it
         was dropped and finds no explanation would reasonably read the omission
         as cherry-picking rather than as the fairness choice it is. The switch
         it points at is the one directly above the chart, which is why it now
         says „nad wykresem” rather than „poniżej”. -->
    <v-alert
      type="info"
      variant="tonal"
      density="comfortable"
      class="mb-6"
      :icon="mdiScaleBalance"
    >
      <p class="mb-2">
        <strong>Rada społeczna to nie rada nadzorcza.</strong> Rada społeczna
        jest organem opiniodawczo-doradczym samodzielnego publicznego zakładu
        opieki zdrowotnej. Ustawa o działalności leczniczej nie przewiduje dla
        jej członków ani wynagrodzenia, ani diety — jedynie rekompensatę
        utraconych zarobków, jeżeli pracodawca udzielił członkowi na czas
        posiedzenia bezpłatnego zwolnienia z obowiązków pracowniczych (art. 48
        ust. 9-10). Dlatego tych miejsc nie wliczamy do zestawienia.
      </p>
      <p class="mb-0">
        {{ exclusionSummary }} Przełącznik nad wykresem pokazuje, co dokładnie
        zostało wyłączone.
      </p>
    </v-alert>

    <!-- ------------------------------------------------------------------ -->
    <!-- The way in, directly under the number that says why it is needed.
         The chart's own subtitle has just admitted how much of the register is
         unreviewed, and until now the page ended there: a reader who wanted to
         help had nowhere to click, and the one person who was asked to help had
         to be sent the address of the queue by hand. It says „tutorial” in as
         many words because that was the other half of the report - the queue
         teaches the job as you do it, and nothing about its name says so. -->
    <v-card
      variant="outlined"
      class="mb-6 join-card"
      data-testid="hospitals-join"
    >
      <v-card-item>
        <template #prepend>
          <v-icon :icon="mdiHandHeartOutline" size="large" color="ink-info" />
        </template>
        <v-card-title class="text-subtitle-1 font-weight-medium text-wrap">
          Pomóż uzupełnić te liczby
        </v-card-title>
        <v-card-subtitle class="text-wrap">
          {{ joinSubtitle }}
        </v-card-subtitle>
      </v-card-item>
      <v-card-text class="text-body-2 pb-2">
        Kolejka pokazuje po jednej osobie naraz, prowadzi krok po kroku i mówi,
        czego szukać - to zarazem samouczek, więc nie trzeba nic wiedzieć na
        start. Wystarczy pięć minut i konto na stronie.
      </v-card-text>
      <!-- Stacked below `sm`. A `v-btn` never wraps its label, so side by side
           these two want 424px of row and a 375px phone has 311 to give: the
           row set the width of the document, and every card on the page was
           then laid out 502px wide with a horizontal scrollbar under it.
           Stretching rather than wrapping because wrapping only moves the
           problem to the next narrow phone - „Sprawdzaj osoby ze szpitali”
           alone is 252px, which is already most of a 320px screen. Chosen by
           breakpoint classes and not `useDisplay()`, for the reason
           StatsHospitalBreakdown gives: the server would render one layout and
           the browser correct it. -->
      <v-card-actions
        class="flex-column flex-sm-row align-stretch align-sm-center px-4 pb-4 pt-0"
      >
        <v-btn
          color="primary"
          variant="flat"
          class="text-none"
          :append-icon="mdiArrowRight"
          to="/eksploruj/nowe?category=szpitale"
          data-testid="hospitals-join-queue"
        >
          Sprawdzaj osoby ze szpitali
        </v-btn>
        <v-btn
          variant="text"
          class="text-none"
          :prepend-icon="mdiTable"
          to="/eksploruj/tabela?category=szpitale&visibility=private&sortBy=latestEmploymentStart&sortDesc=true"
        >
          Cała lista w tabeli
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- ------------------------------------------------------------------ -->
    <h2 class="text-h6 mb-3">W skrócie</h2>

    <v-card variant="outlined" class="mb-4">
      <v-card-text>
        <v-skeleton-loader v-if="!stats" type="heading, text" />
        <!-- A grid rather than a wrapping flex row: laid out by content the
             five tiles put four on a line and orphan the fifth, and the widest
             hint decided how much room every other tile got. -->
        <div v-else class="stat-tiles">
          <StatsStatTile
            v-for="tile in headlineTiles"
            :key="tile.label"
            v-bind="tile"
          />
        </div>
      </v-card-text>
    </v-card>

    <v-card variant="outlined" class="mb-6">
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-medium text-wrap">
          Czym są nadzorowane szpitale publiczne
        </v-card-title>
        <v-card-subtitle class="text-wrap">
          „Brak organu w KRS” to nie to samo co rada nadzorcza — rada społeczna
          powstaje z ustawy i często nie trafia do rejestru.
        </v-card-subtitle>
      </v-card-item>
      <v-card-text>
        <v-skeleton-loader v-if="!stats" type="text@2" />
        <StatsCompositionBar
          v-else
          :segments="segments"
          summary="Podział szpitali publicznych według organu nadzoru wpisanego do KRS"
        />
      </v-card-text>
    </v-card>

    <!-- ------------------------------------------------------------------ -->
    <h2 class="text-h6 mb-3">Jak liczymy</h2>

    <v-card variant="outlined" class="mb-4">
      <v-card-text class="text-body-2">
        <p class="mb-3">
          Bierzemy pod uwagę wyłącznie szpitale, o których KRS mówi, że należą
          do sektora publicznego, i wyłącznie osoby, które nasza baza wiąże z
          organem nadzoru takiego szpitala. Do zestawienia płatnych miejsc
          wchodzi tylko rada nadzorcza — organ spółki prawa handlowego, któremu
          zgromadzenie wspólników może uchwałą przyznać wynagrodzenie (art.
          222<sup>1</sup> § 1 Kodeksu spółek handlowych), w granicach limitu z
          ustawy z 9 czerwca 2016 r. o zasadach kształtowania wynagrodzeń osób
          kierujących niektórymi spółkami.
        </p>

        <p class="mb-1">Nie uwzględniamy:</p>
        <ul class="mb-3 ms-6">
          <li>
            rad społecznych samodzielnych publicznych zakładów opieki zdrowotnej
            — funkcji pełnionej bez wynagrodzenia;
          </li>
          <li>
            szpitali, przy których KRS nie wpisał żadnego organu nadzoru — brak
            wpisu nie jest dowodem na to, że rada jest płatna;
          </li>
          <li>
            szpitali, których nasze pipeline'y nie odczytały jeszcze z rejestru
            po dodaniu tego pola.
          </li>
        </ul>

        <p class="mb-1">Ograniczenia, o których trzeba wiedzieć:</p>
        <ul class="mb-3 ms-6">
          <li>
            „publiczny” znaczy tu „publiczny na tyle, na ile widać to w KRS”.
            Rejestr nie ujawnia akcjonariuszy spółek akcyjnych poza jedynym
            akcjonariuszem, więc część faktycznie samorządowych szpitali w ogóle
            nam tu nie wychodzi.
          </li>
          <li>
            Wpis w KRS bywa nieaktualny wobec faktycznego składu organu, a
            kadencja rady nadzorczej trwa kilka lat.
          </li>
          <li>
            Przynależność partyjna pochodzi z naszej bazy i opisuje powiązania
            historyczne — nie oznacza, że partia kogokolwiek na to miejsce
            wskazała.
          </li>
          <li>
            Partia jest przypisana tylko części osób, dlatego przy udziałach
            liczymy wyłącznie miejsca, przy których ją znamy, a resztę
            pokazujemy osobno.
          </li>
        </ul>

        <p class="mb-0">
          Nie publikujemy kwot wynagrodzeń. Ustawa z 9 czerwca 2016 r. określa
          jedynie górny limit, a konkretną wysokość ustala uchwała zgromadzenia
          wspólników danej spółki — liczymy miejsca, nie pieniądze.
        </p>
      </v-card-text>
    </v-card>

    <p v-if="stats" class="text-caption text-medium-emphasis">
      Przeliczone {{ formatDaysAgo(stats.generatedAt) }} na podstawie odpisów z
      KRS zebranych w naszej bazie.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  mdiArrowRight,
  mdiHandHeartOutline,
  mdiScaleBalance,
  mdiTable,
} from "@mdi/js";
import {
  boardGroupLabels,
  boardGroupShortLabels,
  useHospitalBoards,
  type BoardGroup,
  type CachedGroup,
} from "~/composables/stats/useHospitalBoards";
import { polishCounting } from "~/composables/polish";
import {
  categorical,
  formatCount,
  formatDaysAgo,
  ink,
} from "~/utils/chartTheme";

useSeoMeta({
  title: "Rady nadzorcze szpitali publicznych - koryta.pl",
  description:
    "Kto zajmuje płatne miejsca w radach nadzorczych szpitali publicznych, w podziale na partie. Rady społeczne, w których zasiada się bez wynagrodzenia, są policzone osobno.",
});

const boardGroups: BoardGroup[] = ["paid", "unpaid"];

const {
  stats,
  pending,
  error,
  group,
  selected,
  breakdown,
  breakdownRows,
  segments,
  empty,
  // Taken from the composable rather than called here: this page has a
  // top-level `await` above, and a composable called after it runs with no
  // active effect scope.
  user,
} = await useHospitalBoards();

const headlineTiles = computed(() => {
  const data = stats.value;
  if (!data) return [];
  return [
    {
      label: "Szpitale publiczne w bazie",
      value: data.hospitals,
      hint: "niezależnie od organu nadzoru",
    },
    {
      label: "Z radą nadzorczą",
      value: data.paid.hospitals,
      hint: `${formatCount(data.paid.hospitalsWithSeats)} z obsadą w naszej bazie`,
      color: categorical[0],
    },
    {
      label: "Miejsca w radach nadzorczych",
      value: data.paid.seats,
      hint: `${formatCount(data.paid.seatsWithParty)} z przypisaną partią`,
      color: categorical[0],
    },
    {
      label: "Wykluczone rady społeczne",
      value: data.unpaid.hospitals,
      hint: `${polishCounting(data.unpaid.seats, "miejsce", "miejsca", "miejsc")} bez wynagrodzenia`,
      tooltip:
        "Rada społeczna SPZOZ. Ustawa o działalności leczniczej nie przewiduje za nią wynagrodzenia, więc te miejsca nie wchodzą do podziału na partie.",
      color: categorical[1],
    },
    {
      label: "Reszta szpitali",
      value: data.other.hospitals,
      hint: "brak organu w KRS albo inny organ",
      tooltip:
        "Szpitale, przy których rejestr nie wpisał organu nadzoru, wpisał organ innego rodzaju albo których nie zdążyliśmy jeszcze odczytać. Nie ma dowodu w żadną stronę, więc nie wchodzą do podziału.",
      color: ink.track,
    },
  ];
});

/** Said in the alert under the chart, so the number a reader is asked to
 * accept as excluded is on the page next to the reason for excluding it. */
const exclusionSummary = computed(() => {
  const data = stats.value;
  if (!data) return "";
  return `Poza zestawieniem zostaje ${polishCounting(data.unpaid.seats, "miejsce", "miejsca", "miejsc")} w ${polishCounting(data.unpaid.hospitals, "radzie społecznej", "radach społecznych", "radach społecznych")}.`;
});

const chartTitle = computed(() => {
  const what =
    group.value === "paid" ? "radach nadzorczych" : "radach społecznych";
  const by = {
    party: "według partii",
    region: "według województwa",
    hospital: "według szpitala",
  }[breakdown.value];
  const excluded = group.value === "paid" ? "" : " (nieuwzględnione)";
  return `Miejsca w ${what} ${by}${excluded}`;
});

/** States the ratio in words above a chart whose whole point is that ratio, so
 * it is on the page even for a reader who never reads a bar.
 *
 * The party split is the one view with no backlog to report - we do not know
 * which party the unreviewed people belong to - so it says what it is counting
 * instead of quoting a share that would look like coverage. */
const chartSubtitle = computed(() => {
  const data = selected.value;
  if (!data) return "";
  const { unreviewed } = data as CachedGroup;
  const base =
    group.value === "paid"
      ? "Miejsca, za które spółka może płacić."
      : "Miejsca bez wynagrodzenia — pokazane, żeby było widać, co wyłączyliśmy.";

  if (breakdown.value === "party") {
    return `${base} Liczymy wyłącznie ${formatCount(data.seats)} miejsc sprawdzonych i opublikowanych przez redakcję. Osoba z dwiema partiami liczy się w każdej z nich, dlatego słupki sumują się do więcej niż ${formatCount(data.seats)}.`;
  }
  // Cached-response caveat, as in `regionDisplayRows`: a response from the
  // previous build carries no `unreviewed`, and this must say nothing rather
  // than print "NaN".
  if (unreviewed === undefined) return base;
  const total = data.seats + unreviewed;
  if (total === 0) return base;
  const share = new Intl.NumberFormat("pl-PL", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(data.seats / total);
  return `${base} Z ${formatCount(total)} miejsc znanych z KRS redakcja sprawdziła i opublikowała ${formatCount(data.seats)} (${share}). Kolorowa głowa słupka to te sprawdzone, w podziale na partie; szary ogon to sama liczba osób, o których poza liczbą nie mówimy nic.`;
});

/** How much is still unread, said on the button's own card rather than only in
 * the chart's subtitle above it - somebody scrolling past the chart is exactly
 * the reader this is for. Falls back to naming the job rather than a number,
 * because a response from the previous build carries no `unreviewed` (see
 * `CachedGroup`) and „NaN osób” would be worse than no figure at all. */
const joinSubtitle = computed(() => {
  const unreviewed = (selected.value as CachedGroup | undefined)?.unreviewed;
  if (!unreviewed) {
    return "Każda sprawdzona osoba to jedno miejsce więcej w podziale powyżej.";
  }
  return `${polishCounting(unreviewed, "osoba", "osoby", "osób")} z rejestru czeka, aż ktoś sprawdzi, co je łączy z polityką. Do tego czasu wchodzą tylko w szary ogon słupka.`;
});

const emptyText = computed(() =>
  group.value === "paid"
    ? "Nie mamy jeszcze w bazie żadnego miejsca w radzie nadzorczej szpitala publicznego."
    : "Nie mamy jeszcze w bazie żadnego miejsca w radzie społecznej.",
);
</script>

<style scoped>
/* The way into the queue. An info wash rather than a plain outlined card: it is
   the one thing on this page that asks the reader to do something, and it sits
   between two cards that only report. */
.join-card {
  background: rgba(var(--v-theme-info), 0.06);
}

/* Five headline numbers. `auto-fit` over a 150px floor gives two columns on a
   phone and one row on a desktop, without a breakpoint deciding it. */
.stat-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px 32px;
}
</style>
