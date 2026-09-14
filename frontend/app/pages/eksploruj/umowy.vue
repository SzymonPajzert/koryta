<template>
  <!-- Everything, including the h1. Nothing about a signed-in reader is server
       rendered: this page names people we have not published, and the whole
       point of the gate is that those bytes never leave the server for anybody
       without a verified token. `/eksploruj/umowy` is also in `robots.disallow`
       in nuxt.config.ts - belt and braces, since the disallow only asks. -->
  <ClientOnly>
    <div class="py-4 px-0 pa-sm-4">
      <h1 class="text-h6 text-md-h4 mb-1">Umowy i ludzie</h1>
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
        v-if="coverage && mode === 'ludzie'"
        class="k-note text-body-2 mb-4"
        data-testid="umowy-osoby-cap"
      >
        <!-- „instytucji" in both halves of the sentence: after „z" and after
             „ze wszystkich" Polish takes the genitive, where the numeral stops
             choosing a noun form altogether. `polishCounting` would write „z 30
             instytucje". -->
        Pokazujemy ludzi z
        <strong>{{ polishNumber(shownInstitutions) }} instytucji</strong>
        o największej liczbie umów w tym okresie — nie ze wszystkich
        <strong>{{ polishNumber(coverage.companies) }}</strong
        >. «Pokaż kolejne instytucje» dobiera następne trzydzieści.
      </div>

      <div class="d-flex flex-wrap align-center ga-4 mb-3">
        <v-chip-group v-model="mode" mandatory data-testid="umowy-osoby-mode">
          <v-chip value="ludzie" size="small">Ludzie</v-chip>
          <v-chip value="obie" size="small">
            Obie strony<template v-if="coverage">
              ({{ polishNumber(coverage.bothLinked) }})</template
            >
          </v-chip>
        </v-chip-group>

        <template v-if="mode === 'ludzie'">
          <!-- The default is the count of contracts and never the sum. A money
               leaderboard over an unreviewed NIP join - 82.5% of the employments
               under it are unpublished - reads as a verdict rather than as a
               work queue, and POLREGIO's five-contract board would be the whole
               first screen. -->
          <v-btn-toggle
            v-model="sort"
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
        </template>
      </div>

      <!-- Counts only. `StatTile` prints `formatCompact(value)` and has no way
           to render złoty, so a money tile here would say „46,9 mln" of
           something the label has to name and the tile cannot. -->
      <v-row v-if="mode === 'ludzie'" class="mb-2">
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
        <!-- Rendered only when the endpoint sends the figure: a tile printing an
             em dash is a worse answer than no tile. -->
        <v-col v-if="windowContracts !== null" cols="6" md="3">
          <StatsStatTile label="Umowy w oknie" :value="windowContracts" />
        </v-col>
      </v-row>

      <v-skeleton-loader v-if="pending && !people.length" type="paragraph" />

      <template v-if="mode === 'ludzie'">
        <ContractPersonRow
          v-for="row in people"
          :key="row.person.id"
          :row="row"
        />

        <div v-if="!pending && !people.length" class="k-note text-body-2">
          Nikogo nie znamy we władzach instytucji z tego okna.
        </div>

        <v-btn
          v-if="nextCursor"
          variant="outlined"
          block
          class="mt-3"
          :loading="pending"
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
          v-if="!pending && !bothRows.length && coverage"
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

      <ContractSourceNote v-if="coverage" :coverage="coverage" class="mt-4" />
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
/** „Umowy i ludzie": the signed-in half of the contracts feature.
 *
 * The rows are people, not contracts, because the question this surface answers
 * is *kto zasiada we władzach instytucji, przez które w tym okresie przepłynęły
 * publiczne pieniądze* - including the ones we have not published. The public
 * `/umowy` answers „what is in the register"; this one is the editors' work
 * queue behind it.
 *
 * **Never „podpisał", „odpowiada za" or „beneficjent" anywhere on this page.**
 * The join is NIP to institution and the graph is person to board seat. Nothing
 * here connects a named person to a signature, and wording that implies it
 * would turn an unreviewed match into an accusation.
 *
 * The window is capped at thirty institutions per fetch and the cap is printed
 * above the fold rather than hidden in a footer - a truncated list that states a
 * register-wide total without saying it is truncated is a lie about coverage.
 */
import { computed, ref, watch } from "vue";
import { polishNumber } from "~/composables/polish";
import { useContractPeople } from "~/composables/contracts";
import { longDate } from "~~/shared/dates";
import type {
  ContractPersonRow as PersonRowData,
  ContractRow as ContractRowData,
} from "~~/shared/contracts";

definePageMeta({
  middleware: "auth",
  maxWidth: 1300,
});

useHead({
  title: "Umowy i ludzie - koryta.pl",
});

const mode = ref<"ludzie" | "obie">("ludzie");
const sort = ref<"umowy" | "suma" | "ostatnia">("umowy");
const stan = ref<"all" | "opublikowane" | "nasze">("all");

/** The window the reader has asked for so far. Held here rather than in the
 * url: it is a cost (roughly 500 reads a click, uncached by construction) and
 * not a view somebody would send to somebody else. */
const cursor = ref<string | undefined>(undefined);
const pages = ref(1);

// A getter rather than an object of refs: the composable takes one
// `MaybeRefOrGetter` for the whole query and reads it through `toValue`, so
// four refs handed over individually would be read once and never again.
const { data, pending } = useContractPeople(() => ({
  mode: mode.value,
  sort: sort.value,
  stan: stan.value,
  cursor: cursor.value,
}));

const coverage = computed(() => data.value?.coverage ?? null);
const nextCursor = computed(() => data.value?.nextCursor ?? null);

/** How many institutions the rows below actually cover. `windowSize` is what
 * one fetch looked at; a reader who has pressed „Pokaż kolejne instytucje"
 * twice is reading sixty, and the note above the list has to say sixty. */
const shownInstitutions = computed(
  () => (data.value?.windowSize ?? 0) * pages.value,
);

/** Not in the endpoint's response shape yet - see the report on this change.
 * The tile renders only when it arrives, so this page never prints a dash
 * where a number belongs. */
const windowContracts = computed<number | null>(
  () =>
    (data.value as { windowContracts?: number } | null)?.windowContracts ??
    null,
);

/** Everyone loaded so far, across however many windows were asked for.
 *
 * Accumulated rather than replaced because „dobiera następne trzydzieści" means
 * the list grows. The windows are disjoint sets of institutions - the endpoint
 * pages `contractStats` by contract count - so a person on two boards thirty
 * places apart arrives twice, describing a different seat each time, and the
 * two halves have to be added rather than one of them dropped.
 */
const people = ref<PersonRowData[]>([]);

watch(data, (next) => {
  const incoming = next?.people ?? [];
  people.value =
    pages.value > 1 ? mergePeople(people.value, incoming) : [...incoming];
  people.value = sortPeople(people.value);
});

// A different question is a different list. Resetting the cursor here and not
// in the click handler keeps the two from disagreeing after a filter change
// mid-page.
watch([mode, sort, stan], () => {
  cursor.value = undefined;
  pages.value = 1;
  people.value = [];
});

function extendWindow() {
  if (!nextCursor.value) return;
  pages.value += 1;
  cursor.value = nextCursor.value;
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
  const key = sort.value;
  return [...rows].sort((a, b) => {
    if (key === "suma") return b.totalValue - a.totalValue;
    if (key === "ostatnia")
      return (b.lastSignedAt ?? "").localeCompare(a.lastSignedAt ?? "");
    return b.contractCount - a.contractCount;
  });
}

const bothRows = computed<ContractRowData[]>(() => data.value?.rows ?? []);

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
</script>
