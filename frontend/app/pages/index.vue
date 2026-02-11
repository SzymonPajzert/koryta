<template>
  <v-row>
    <HomeIntro />
    <v-col cols="12" sm="3" class="text-center">
      <a
        href="https://zrzutka.pl/rd7ssx/award/g3z29z/przypinka-z-podziekowaniami"
        target="_blank"
      >
        <v-img position="center" height="300" src="@/assets/logo.png" />
      </a>
    </v-col>
    <v-col cols="12" sm="9" class="text-center align-self-center">
      <HomeHeading title="Witaj na koryta.pl" />
    </v-col>
    <v-col cols="12" class="mt-4">
      <HomeSourceCards :sources="sourceStats" />
    </v-col>
    <v-col cols="12" md="6">
      <v-card class="py-4" color="surface-variant" variant="tonal" rounded="lg">
        <v-card-title>
          <h2 class="text-h5 font-weight-bold">
            Lista wszystkich {{ Object.values(people).length }}
            {{ koryciarz.plural.genitive }}
          </h2>
        </v-card-title>
        <v-card-text>
          <ClientOnly>
            <ChartTreemapParty />
          </ClientOnly>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12">
      <HomeHeading title="Agregator koryciarstwa" />
    </v-col>
    <v-col cols="12" sm="7">
      <omni-search-fake />
    </v-col>
    <v-col cols="12" sm="5">
      <HomeCard>
        Wyszukaj na górze znanych Ci polityków, miasta albo publiczne spółki -
        albo kliknij nasze propozyce po lewej stronie.
      </HomeCard>
    </v-col>

    <v-col cols="12" class="text-center">
      <CardCallToAction />
    </v-col>

    <v-col cols="12" md="6">
      <v-card
        to="/graf?miejsce=0qGH8AL9bwUCQvrLNwiO"
        class="py-4"
        color="surface-variant"
        variant="tonal"
        rounded="lg"
      >
        <v-card-title>
          <h2 class="text-h5 font-weight-bold">Zobacz jak PSL przejęło PKP</h2>
        </v-card-title>
        <v-card-text>
          <v-img class="mb-4" height="250" src="@/assets/psl_pkp.png" />
        </v-card-text>
      </v-card>
    </v-col>
    <v-col cols="12" md="6">
      <v-card
        to="/graf?miejsce=YLMeu6hJgYGUokxec9D8"
        class="py-4"
        color="surface-variant"
        variant="tonal"
        rounded="lg"
      >
        <v-card-title>
          <h2 class="text-h6 font-weight-bold">
            Albo PL2050 ministerstwo klimatu
          </h2>
        </v-card-title>
        <v-card-text>
          <v-img class="mb-4" height="250" src="@/assets/polska2050.png" />
        </v-card-text>
      </v-card>
    </v-col>

    <CardHomeItem router="/pomoc" icon="mdi-plus-box-outline">
      <template #header> Dodaj osoby i artykuły </template>
      Dodaj brakujące osoby w spółkach państwa lub samorządu albo linki do
      artykułów wypisujących je.
    </CardHomeItem>
  </v-row>
</template>

<script setup lang="ts">
import { useFeminatyw } from "@/composables/feminatyw";

const { entities: people } = useEntity("person");
const { koryciarz } = useFeminatyw();
</script>
