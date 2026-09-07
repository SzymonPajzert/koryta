<template>
  <div class="w-100 align-self-center">
    <div class="d-flex align-center flex-wrap ga-2 mb-2 mb-md-4">
      <h1 class="text-h6 text-md-h4">Historie w spółkach</h1>
      <v-spacer />
      <v-btn
        variant="text"
        size="small"
        class="text-none"
        :prepend-icon="mdiTable"
        to="/eksploruj/tabela"
        text="Tabela"
      />
      <v-btn
        variant="text"
        size="small"
        class="text-none"
        :prepend-icon="mdiChartLine"
        to="/eksploruj/statystyki"
        text="Statystyki"
      />
    </div>

    <!-- What the list is and what it is not, before the list. Every card here
         is a statistical claim about a group of people, and a reader who does
         not know how the group was chosen cannot judge it. -->
    <p class="text-body-2 mb-4 lede" data-testid="historie-brief">
      Bierzemy każdą posadę w spółce publicznej, o której wiemy, i grupujemy je
      po tym, co mogłoby je łączyć: po mieście, w którym spółka jest
      zarejestrowana, po branży i po właścicielu. Grupa trafia na tę listę
      dopiero wtedy, gdy różni się od reszty kraju w tym samym okresie -
      częściej niż gdzie indziej trafiają tu ludzie jednej partii, zmian jest
      więcej, niż wynikałoby z wielkości grupy, albo kilka spółek wymieniło
      władze naraz. To nie jest dowód na nic; to lista miejsc, którym warto się
      przyjrzeć.
    </p>

    <v-card variant="outlined" class="pa-3 mb-4" data-testid="historie-filters">
      <div class="d-flex align-center flex-wrap ga-3">
        <v-btn-toggle
          v-model="kind"
          mandatory
          divided
          variant="outlined"
          density="comfortable"
        >
          <v-btn value="all" class="text-none" text="Wszystkie" />
          <v-btn value="region" class="text-none" text="Miasta" />
          <v-btn value="sector" class="text-none" text="Branże" />
          <v-btn value="owner" class="text-none" text="Grupy spółek" />
        </v-btn-toggle>
      </div>
      <div class="text-caption text-medium-emphasis mt-2">
        <template v-if="feed">
          Policzone
          {{ feed.hiresConsidered }} zmian z okresu {{ feed.windowStart }} -
          {{ feed.windowEnd }}, z czego {{ feed.hiresVisible }} można otworzyć.
          <template v-if="feed.includesDrafts">
            Widzisz też osoby, których strony nie są jeszcze opublikowane.
          </template>
        </template>
      </div>
    </v-card>

    <v-alert
      v-if="error"
      type="warning"
      variant="tonal"
      class="mb-4"
      data-testid="historie-error"
      text="Nie udało się wczytać historii. Spróbuj odświeżyć stronę."
    />

    <div v-else-if="status === 'pending'" class="text-center py-8">
      <v-progress-circular indeterminate />
    </div>

    <v-alert
      v-else-if="!clusters.length"
      type="info"
      variant="tonal"
      data-testid="historie-empty"
      text="Żadna grupa zmian nie wybija się w tej chwili ponad tło."
    />

    <div v-else class="cluster-grid" data-testid="historie-clusters">
      <CardStoryCluster
        v-for="cluster in clusters"
        :key="cluster.id"
        :cluster
      />
    </div>

    <p
      v-if="feed?.computedAt"
      class="text-caption text-medium-emphasis mt-4"
      data-testid="historie-computed-at"
    >
      Przeliczone {{ shortDate(feed.computedAt.slice(0, 10)) }}.
    </p>
  </div>
</template>

<script lang="ts" setup>
import { mdiChartLine, mdiTable } from "@mdi/js";
import { authFetch } from "~/composables/auth";
import { shortDate } from "~~/shared/dates";
import type { ClusterFeed } from "~~/server/api/stats/clusters.get";

useSeoMeta({
  title: "Historie w spółkach - koryta.pl",
  description:
    "Nowe posady w spółkach publicznych, pogrupowane w historie: miasta, " +
    "branże i grupy spółek, w których w ostatnich dwóch latach zmieniło się " +
    "więcej, niż wynikałoby z przypadku.",
});

/** Which kind of grouping the reader is looking at. `all` is a value rather
 * than an absent one because `v-btn-toggle` is `mandatory`: something has to be
 * selected, and an empty selection would read as a broken control. */
const kind = ref<"all" | "region" | "sector" | "owner">("all");

/** Everything, and filtered in the browser.
 *
 * The whole list is a single stored document of a few dozen entries, so asking
 * the server again per toggle would cost a round trip to hand back a subset of
 * what is already here - and would make the endpoint's memo four entries wide
 * for no gain. */
const query = computed(() => ({ limit: 60 }));

const { data, status, error } = authFetch<ClusterFeed>("/api/stats/clusters", {
  query,
  key: "eksploruj-historie",
});

const feed = computed(() => data.value);
const clusters = computed(() => {
  const all = data.value?.clusters ?? [];
  return kind.value === "all"
    ? all
    : all.filter((cluster) => cluster.kind === kind.value);
});
</script>

<style scoped>
.lede {
  max-width: 70ch;
}

.cluster-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 960px) {
  .cluster-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
