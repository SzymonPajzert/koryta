<template>
  <!-- <v-card>
    TODO Znajdź ludzi z takich organizacji jak 0000336643. Nie iteresują mnie, ale algorytm powienien je proponować bo duo ludzi wychodzi z nich.
    TODO List active companies that the person is a part of, filter on them
    TODO Yellow if person is suggested (because in DB) and put on to
    TODO Rodziel punkty jeśli są między radę nadzorczą i zarząd (ale chyba nie jest to warte)
    TODO active only in selected companies, Show only people that are active
  </v-card> -->

  <v-list>
    <v-list-item
      v-for="([krs, companyScore]) in companiesSorted"
      :key="krs"
    >
      {{ companyScore.name }} ({{ companyScore.score }} / {{ krs }})
    </v-list-item>
  </v-list>
</template>

<script lang="ts" setup>
import { toNumber, useCompanyScore } from "@/composables/entities/companyScore";

const { scores } = useCompanyScore();

const companiesSorted = computed(() =>
  Object.entries(scores.value).sort(
    (a, b) => toNumber(b[1].score) - toNumber(a[1].score)
  )
);
</script>
