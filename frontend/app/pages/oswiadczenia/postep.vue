<template>
  <div class="op" data-testid="declarations-people-page">
    <div class="sec-head op-head">
      <h1 class="op-title">Oświadczenia majątkowe</h1>
      <InfoBubble label="Kogo liczymy">
        <p class="mb-2">
          Liczymy samorządowców, którzy wygrali wybory do rady, na wójta,
          burmistrza albo prezydenta i mają płatną posadę w publicznej spółce
          lub instytucji. Tylko ich stronę może opublikować oświadczenie
          majątkowe.
        </p>
        <p class="mb-2">
          Stronę publikujemy, gdy data urodzenia z oświadczenia zgadza się z
          datą z KRS. Gdy się nie zgadza, osoba z KRS to najczęściej imiennik.
        </p>
        <p class="mb-0">Liczby odświeżamy co noc.</p>
      </InfoBubble>
    </div>

    <template v-if="people">
      <p class="op-lead">Stan na {{ longDate(people.exportDay) }}.</p>

      <!-- The figure, the line and what its marks mean: the page's one
           focal block. -->
      <section class="op-hero" aria-labelledby="op-hero-title">
        <h2 id="op-hero-title" class="op-hero__head">
          <span class="op-figure">{{ polishNumber(g.published) }}</span>
          <span class="op-hero__say">
            opublikowanych z
            {{
              polishCountingGenitive(g.total, "samorządowca", "samorządowców")
            }}
          </span>
        </h2>
        <OswiadczeniaPeopleBar :people="people" />
        <div class="op-actions">
          <v-btn
            color="tally"
            variant="flat"
            rounded="lg"
            height="44"
            class="text-none"
            to="/oswiadczenia"
            data-testid="people-page-read"
          >
            Pomóż szukać
          </v-btn>
          <OswiadczeniaArrowLink :to="BLOG_POST">
            Dowiedz się więcej
          </OswiadczeniaArrowLink>
        </div>
      </section>

      <section
        v-if="underway.length"
        class="op-section"
        aria-labelledby="op-underway"
      >
        <h2 id="op-underway" class="op-section__title">
          W toku
          <span class="op-section__count">{{ polishNumber(g.underway) }}</span>
        </h2>
        <ul class="op-rows">
          <li v-for="row in underway" :key="row.key" class="op-row">
            <span class="op-row__count">{{ polishNumber(row.count) }}</span>
            <span class="op-row__label">{{ row.label }}</span>
            <OswiadczeniaArrowLink
              v-if="row.to"
              :to="row.to"
              :arrow="false"
              class="op-row__go"
            >
              {{ row.go }}
            </OswiadczeniaArrowLink>
          </li>
        </ul>
      </section>

      <section
        v-if="searching.length"
        class="op-section"
        aria-labelledby="op-searching"
      >
        <h2 id="op-searching" class="op-section__title">
          Bez oświadczenia
          <span class="op-section__count">{{ polishNumber(g.searching) }}</span>
        </h2>
        <ul class="op-rows">
          <li v-for="group in searching" :key="group.key" class="op-row">
            <span class="op-row__count">{{ polishNumber(group.count) }}</span>
            <span class="op-row__label">
              {{ group.label }}
              <span class="op-row__parts">{{ group.parts }}</span>
            </span>
          </li>
        </ul>
        <div v-if="people.topUnits.length" class="op-units">
          <p class="op-units__title">Najwięcej osób za niedostępnym BIP</p>
          <ol class="op-units__list">
            <li v-for="unit in people.topUnits" :key="unit.teryt">
              <span class="op-units__name">{{ unit.name }}</span>
              <span class="op-units__count">{{
                polishNumber(unit.people)
              }}</span>
            </li>
          </ol>
        </div>
      </section>

      <!-- Only once somebody has settled: before that there is no band to
           draw and nothing to estimate from. -->
      <section
        v-if="people.bySurname.length"
        class="op-section"
        aria-labelledby="op-namesakes"
      >
        <div class="sec-head">
          <h2 id="op-namesakes" class="op-section__title">
            Imiennicy
            <span class="op-section__count">{{
              polishNumber(g.namesakes)
            }}</span>
          </h2>
          <InfoBubble label="Jak szacujemy imienników">
            <p class="mb-2">
              Liczba osób o danym nazwisku pochodzi z rejestru PESEL, osobno dla
              kobiet i mężczyzn. Dla każdej grupy liczymy, jaka część
              sprawdzonych osób okazała się imiennikami, i mnożymy przez liczbę
              jeszcze niesprawdzonych.
            </p>
            <p class="mb-0">
              Przedział to 90% wyników po wielokrotnym losowaniu sprawdzonych
              osób.
            </p>
          </InfoBubble>
        </div>
        <p class="op-section__lead">
          Im popularniejsze nazwisko, tym częściej osoba z KRS to imiennik
          samorządowca.
        </p>
        <table class="op-bands">
          <thead>
            <tr>
              <th scope="col" class="op-bands__label-head">Nazwisko nosi</th>
              <th scope="col" class="op-bands__num">Sprawdzone</th>
              <th scope="col" class="op-bands__num">Imiennicy</th>
              <th scope="col" class="op-bands__bar-head">
                <span class="d-sr-only">Odsetek imienników</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="band in bands" :key="band.min">
              <th scope="row">
                {{ band.label }}
                <span class="op-bands__of">
                  {{ polishNumber(band.namesakes) }} z
                  {{ polishNumber(band.settled) }}
                </span>
              </th>
              <td class="op-bands__num">{{ polishNumber(band.settled) }}</td>
              <td class="op-bands__num">{{ polishNumber(band.namesakes) }}</td>
              <!-- A table cell stays a cell: the bar and its share line up
                   inside a box of their own. -->
              <td class="op-bands__bar">
                <span class="op-bands__share-row">
                  <span class="op-bands__track">
                    <span
                      v-if="band.namesakes > 0"
                      class="op-bands__fill"
                      :style="{ width: `${band.share}%` }"
                    />
                  </span>
                  <span class="op-bands__share">{{
                    formatShare(band.share)
                  }}</span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="people.expectedNamesakes" class="op-expect">
          Wśród
          {{
            polishCountingGenitive(
              remaining,
              "jeszcze niesprawdzonej osoby",
              "jeszcze niesprawdzonych osób",
            )
          }}
          spodziewamy się około
          <strong>{{ polishNumber(people.expectedNamesakes.count) }}</strong>
          imienników (od {{ polishNumber(people.expectedNamesakes.low) }} do
          {{ polishNumber(people.expectedNamesakes.high) }}).
        </p>
      </section>

      <section
        v-if="days.dates.length > 1"
        class="op-section"
        aria-labelledby="op-days"
      >
        <h2 id="op-days" class="op-section__title">
          Opublikowane dzień po dniu
        </h2>
        <StatsDailyColumns
          :dates="days.dates"
          :bands="days.bands"
          value-title="Opublikowane osoby"
          empty-text="Jeszcze nikogo."
          :legend="false"
        />
      </section>
    </template>

    <p v-else class="op-lead" data-testid="declarations-people-empty">
      Pierwsze liczby pojawią się po nocnym przeliczeniu.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { polishCountingGenitive, polishNumber } from "~/composables/polish";
import { publishedDays } from "~/utils/declarationPeople";
import { longDate } from "~~/shared/dates";
import {
  peopleGroups,
  type DeclarationPeople,
  type PeopleSearchReason,
} from "~~/shared/declarations";

/**
 * /oswiadczenia/postep: how far the declarations got, in people, with every
 * number the home page's card sums up. The job counts it once a night
 * (`stats/declaration_people`); nobody is named here.
 */

definePageMeta({
  // The reading page's column: 880 px and the layout's padding.
  maxWidth: 912,
});

useSeoMeta({
  title: "Oświadczenia majątkowe",
  description:
    "Ilu samorządowców z płatną posadą potwierdziliśmy datą urodzenia z oświadczenia majątkowego, a ilu okazało się imiennikami.",
});

const BLOG_POST = "/blog/sprawdzamy-samorzadowcow";

const { data } = await useFetch<{ people: DeclarationPeople | null }>(
  "/api/declarations/people",
  { key: "declarations-people" },
);
const people = computed(() => data.value?.people ?? null);
const g = computed(() => (people.value ? peopleGroups(people.value) : null)!);

const underway = computed(() => {
  const p = people.value!;
  return [
    {
      key: "held",
      count: p.held,
      label: "data się zgadza, czeka na decyzję",
    },
    {
      key: "mismatched",
      count: p.mismatched,
      label: "inna data, pewnie błąd odczytu",
    },
    {
      key: "reading",
      count: p.reading,
      label: "czeka na czytelników",
      to: "/oswiadczenia",
      go: "Odczytaj",
    },
    { key: "cropped", count: p.cropped, label: "wycinek gotowy do wysłania" },
    {
      key: "downloaded",
      count: p.downloaded,
      label: "data jeszcze nie wycięta",
    },
  ].filter((row) => row.count > 0);
});

/** The reasons a person has no date yet, in three plain groups, each with
 * its parts in small print. */
const SEARCH_GROUPS: {
  key: string;
  label: string;
  reasons: [PeopleSearchReason, string][];
}[] = [
  {
    key: "blocked",
    label: "nie dotarliśmy do oświadczeń",
    reasons: [
      ["unreachable", "BIP nie odpowiada"],
      ["refused", "odmawia"],
      ["download_failed", "plik się nie pobrał"],
      ["timeout", "za długo"],
      ["budget", "za duży BIP"],
      ["no_seed", "nie znamy adresu BIP"],
      ["robots", "zakaz w robots.txt"],
      ["throttled", "limit zapytań"],
    ],
  },
  {
    key: "absent",
    label: "na BIP nie ma oświadczenia",
    reasons: [
      ["not_listed", "brak na liście"],
      ["no_declarations", "brak działu oświadczeń"],
    ],
  },
  {
    key: "pending",
    label: "jeszcze nie szukaliśmy",
    reasons: [["pending", ""]],
  },
  {
    key: "dateless",
    label: "oświadczenie jest, daty brak",
    reasons: [
      ["no_date_line", "brak linii z datą"],
      ["other_page", "wycinek przypisany komuś innemu"],
      ["unreadable", "nieczytelny wycinek"],
    ],
  },
];

const searching = computed(() => {
  const by = new Map(people.value!.searchingBy.map((r) => [r.reason, r.count]));
  return SEARCH_GROUPS.map((group) => {
    const parts = group.reasons
      .map(([reason, label]) => ({ label, count: by.get(reason) ?? 0 }))
      .filter((part) => part.count > 0);
    return {
      key: group.key,
      label: group.label,
      count: parts.reduce((sum, part) => sum + part.count, 0),
      parts: parts
        .filter((part) => part.label)
        .map((part) => `${part.label} ${polishNumber(part.count)}`)
        .join(" · "),
    };
  }).filter((group) => group.count > 0);
});

/** Whom the namesake estimate is for: nobody has read their date yet. A held
 * page has matched already, and a mismatched one has a reading. */
const remaining = computed(() => {
  const p = people.value!;
  return p.reading + p.cropped + p.downloaded + p.searching;
});

/** „mniej niż 50 osób”, „1 000-4 999”, „20 000 i więcej”. */
function bandLabel(min: number, max: number | null): string {
  if (min === 0 && max !== null) return `mniej niż ${polishNumber(max)} osób`;
  if (max === null) return `${polishNumber(min)} i więcej`;
  return `${polishNumber(min)}-${polishNumber(max - 1)}`;
}

const bands = computed(() =>
  people.value!.bySurname.map((band) => ({
    ...band,
    label: bandLabel(band.min, band.max),
    share: band.settled > 0 ? (band.namesakes / band.settled) * 100 : 0,
  })),
);

function formatShare(share: number): string {
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(share)}%`;
}

const days = computed(() =>
  people.value ? publishedDays(people.value) : { dates: [], bands: [] },
);
</script>

<style scoped>
.op {
  padding-block: 8px 48px;
  width: 100%;
}

.op-head {
  flex-wrap: nowrap;
}

.op-title {
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0;
  text-wrap: balance;
}

.op-lead {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 1rem;
  line-height: 1.5;
  margin: 8px 0 0;
}

/* ---- the focal block ---- */
.op-hero {
  background: rgb(var(--v-theme-tally-pale));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 24px;
  padding: 24px 28px;
}

.op-hero__head {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 0;
}

.op-figure {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 3.5rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
}

.op-hero__say {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 1.125rem;
  font-weight: 500;
}

.op-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
}

/* ---- the sections under it ---- */
.op-section {
  margin-top: 40px;
}

.op-section__title {
  align-items: baseline;
  color: rgb(var(--v-theme-ink-strong));
  display: flex;
  font-size: 1.5rem;
  font-weight: 600;
  gap: 10px;
  letter-spacing: -0.01em;
  line-height: 1.25;
  margin: 0;
}

.op-section__count {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 1.125rem;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.op-section__lead {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.9375rem;
  line-height: 1.5;
  margin: 6px 0 0;
  max-width: 68ch;
}

/* One list on paper, a hairline between rows, the figure first. */
.op-rows {
  border-top: 1px solid rgba(var(--v-border-color), 0.12);
  column-gap: 16px;
  display: grid;
  grid-template-columns: minmax(5ch, max-content) minmax(0, 1fr) auto;
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}

/* One grid for the whole list, each row on its subgrid, so the widest figure
 * sets the figures' column for every row. */
.op-row {
  align-items: baseline;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  min-height: 48px;
  padding: 12px 0;
  row-gap: 4px;
}

.op-row__count {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 1.125rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  text-align: right;
}

.op-row__label {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 0.9375rem;
  line-height: 1.4;
}

.op-row__parts {
  color: rgb(var(--v-theme-ink-neutral));
  display: block;
  font-size: 0.8125rem;
  margin-top: 2px;
}

.op-row .op-row__go {
  min-height: 0;
}

.op-units {
  margin-top: 16px;
}

.op-units__title {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8125rem;
  font-weight: 600;
  margin: 0 0 6px;
}

.op-units__list {
  columns: 2;
  column-gap: 32px;
  font-size: 0.875rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.op-units__list li {
  break-inside: avoid;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 3px 0;
}

.op-units__name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.op-units__count {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

/* The bands: a share of each band struck through, the namesakes' mark. */
.op-bands {
  border-collapse: collapse;
  font-size: 0.9375rem;
  margin-top: 12px;
  table-layout: fixed;
  width: 100%;
}

/* Fixed layout takes its widths from the head row. */
.op-bands__label-head {
  width: 30%;
}

.op-bands thead .op-bands__num {
  width: 14%;
}

.op-bands th,
.op-bands td {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
  padding: 10px 12px 10px 0;
  text-align: left;
}

.op-bands thead th {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8125rem;
  font-weight: 600;
}

.op-bands tbody th {
  font-weight: 500;
  white-space: nowrap;
}

.op-bands__num {
  font-variant-numeric: tabular-nums;
  text-align: right !important;
}

.op-bands__share-row {
  align-items: center;
  display: flex;
  gap: 10px;
}

.op-bands__track {
  background:
    radial-gradient(circle, rgb(var(--v-theme-tally)) 1px, transparent 1.3px) 0
      calc(100% - 3px) / 5px 4px round no-repeat,
    rgba(var(--v-theme-tally), 0.06);
  border-radius: 2px;
  display: block;
  flex: 1 1 auto;
  forced-color-adjust: none;
  height: 14px;
  overflow: hidden;
}

.op-bands__fill {
  background:
    linear-gradient(
        rgb(var(--v-theme-ink-strong)),
        rgb(var(--v-theme-ink-strong))
      )
      0 50% / 100% 2px no-repeat,
    rgba(var(--v-theme-ink-strong), 0.16);
  display: block;
  height: 100%;
  min-width: 2px;
}

.op-bands__of {
  color: rgb(var(--v-theme-ink-neutral));
  display: none;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  font-weight: 400;
  margin-top: 2px;
}

.op-bands__share {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  min-width: 4ch;
  text-align: right;
}

.op-expect {
  background: rgb(var(--v-theme-surface-muted));
  border-radius: 8px;
  color: rgb(var(--v-theme-ink-strong));
  font-size: 0.9375rem;
  line-height: 1.5;
  margin: 16px 0 0;
  padding: 12px 16px;
}

.op-expect strong {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 599.98px) {
  .op-title {
    font-size: 1.75rem;
  }

  .op-hero {
    padding: 20px 16px;
  }

  .op-figure {
    font-size: 2.75rem;
  }

  .op-rows {
    grid-template-columns: minmax(5ch, max-content) minmax(0, 1fr);
  }

  .op-row .op-row__go {
    grid-column: 2;
  }

  /* The two count columns give way to „52 z 212” under the band. */
  .op-bands__num {
    display: none;
  }

  .op-bands__of {
    display: block;
  }

  .op-units__list {
    columns: 1;
  }

  .op-bands__label-head {
    width: 52%;
  }

  .op-bands tbody th {
    white-space: normal;
  }
}
</style>
