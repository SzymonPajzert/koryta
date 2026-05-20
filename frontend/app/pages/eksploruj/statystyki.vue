<template>
  <div class="pa-4">
    <h1 class="text-h4 mb-4">Statystyki głosowania</h1>

    <v-row v-if="pending">
      <v-col cols="12" class="d-flex justify-center my-12">
        <v-progress-circular indeterminate color="primary" size="64" />
      </v-col>
    </v-row>

    <v-row v-else-if="error">
      <v-col cols="12">
        <v-alert type="error" text="Nie udało się pobrać statystyk." />
      </v-col>
    </v-row>

    <v-row v-else>
      <v-col cols="12">
        <v-card class="mb-4">
          <v-card-title>Liczba głosów w czasie</v-card-title>
          <v-card-text>
            <ClientOnly>
              <apexchart
                v-if="barSeries.length > 0"
                type="bar"
                height="400"
                :options="barChartOptions"
                :series="barSeries"
              />
              <div v-else>Brak danych</div>
            </ClientOnly>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card class="h-100">
          <v-card-title>Rozkład głosów: "Dobre znalezisko"</v-card-title>
          <v-card-text class="d-flex justify-center">
            <ClientOnly>
              <apexchart
                v-if="interestingSeries.length > 0"
                type="bar"
                height="380"
                width="100%"
                :options="interestingBarOptions"
                :series="interestingSeries"
              />
              <div v-else>Brak danych</div>
            </ClientOnly>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card class="h-100">
          <v-card-title>Rozkład głosów: "Znaleziony problem"</v-card-title>
          <v-card-text class="d-flex justify-center">
            <ClientOnly>
              <apexchart
                v-if="qualitySeries.length > 0"
                type="bar"
                height="380"
                width="100%"
                :options="qualityBarOptions"
                :series="qualitySeries"
              />
              <div v-else>Brak danych</div>
            </ClientOnly>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { VoteDocument } from "~~/shared/model";

useHead({
  title: "Statystyki - koryta.pl",
});

const {
  data: votes,
  pending,
  error,
} = useFetch<(VoteDocument & { id: string })[]>("/api/stats/votes");

// Bar Chart: Votes split by user vertically and days horizontally
const barSeries = computed(() => {
  if (!votes.value) return [];

  const userDateCounts: Record<string, Record<string, number>> = {};
  const allDatesSet = new Set<string>();

  for (const vote of votes.value) {
    if (vote.userUid?.includes("pipeline")) continue;
    if (!vote.updatedAt) continue;
    const date = vote.updatedAt.split("T")[0];
    if (!date) continue;

    allDatesSet.add(date);
    const user = vote.userUid;

    if (!userDateCounts[user]) userDateCounts[user] = {};
    userDateCounts[user][date] = (userDateCounts[user][date] || 0) + 1;
  }

  const allDates = Array.from(allDatesSet).sort();

  return Object.entries(userDateCounts).map(([user, dates]) => {
    return {
      name: user,
      data: allDates.map((d) => dates[d] || 0),
    };
  });
});

const barChartOptions = computed(() => {
  const allDatesSet = new Set<string>();
  if (votes.value) {
    for (const vote of votes.value) {
      if (vote.userUid?.includes("pipeline")) continue;
      if (!vote.updatedAt) continue;
      const date = vote.updatedAt.split("T")[0];
      if (date) allDatesSet.add(date);
    }
  }
  const allDates = Array.from(allDatesSet).sort();

  return {
    chart: {
      type: "bar",
      stacked: true,
      toolbar: {
        show: true,
      },
      zoom: {
        enabled: true,
      },
    },
    xaxis: {
      type: "category",
      categories: allDates,
    },
    legend: {
      show: false,
    },
    fill: {
      opacity: 1,
    },
  };
});

// Bar Chart: Interesting
const interestingData = computed(() => {
  if (!votes.value) return { series: [], labels: [] };
  const counts: Record<string, number> = {};
  for (const vote of votes.value) {
    if (vote.userUid?.includes("pipeline")) continue;
    let val = vote.categoryVotes?.interesting;
    if (val !== undefined && val !== 0) {
      if (val > 5) val = 5;
      if (val < -5) val = -5;
      counts[String(val)] = (counts[String(val)] || 0) + 1;
    }
  }
  const sortedKeys = Object.keys(counts).sort((a, b) => Number(a) - Number(b));
  return {
    series: [
      {
        name: "Liczba głosów",
        data: sortedKeys.map((k) => counts[k]),
      },
    ],
    labels: sortedKeys.map((v) => String(v)),
  };
});

const interestingSeries = computed(() => interestingData.value.series);
const interestingBarOptions = computed(() => ({
  chart: {
    type: "bar",
  },
  xaxis: {
    categories: interestingData.value.labels,
    title: {
      text: "Wartość głosu",
    },
  },
  yaxis: {
    title: {
      text: "Liczba oddanych głosów",
    },
  },
  plotOptions: {
    bar: {
      horizontal: false,
    },
  },
  dataLabels: {
    enabled: true,
  },
}));

// Bar Chart: Quality (Znaleziony problem)
const qualityData = computed(() => {
  if (!votes.value) return { series: [], labels: [] };
  const counts: Record<string, number> = {};
  for (const vote of votes.value) {
    if (vote.userUid?.includes("pipeline")) continue;
    let val = vote.categoryVotes?.quality;
    if (val !== undefined && val !== 0) {
      if (val > 5) val = 5;
      if (val < -5) val = -5;
      counts[String(val)] = (counts[String(val)] || 0) + 1;
    }
  }
  const sortedKeys = Object.keys(counts).sort((a, b) => Number(a) - Number(b));
  return {
    series: [
      {
        name: "Liczba głosów",
        data: sortedKeys.map((k) => counts[k]),
      },
    ],
    labels: sortedKeys.map((v) => String(v)),
  };
});

const qualitySeries = computed(() => qualityData.value.series);
const qualityBarOptions = computed(() => ({
  chart: {
    type: "bar",
  },
  xaxis: {
    categories: qualityData.value.labels,
    title: {
      text: "Wartość głosu",
    },
  },
  yaxis: {
    title: {
      text: "Liczba oddanych głosów",
    },
  },
  plotOptions: {
    bar: {
      horizontal: false,
    },
  },
  dataLabels: {
    enabled: true,
  },
}));
</script>
