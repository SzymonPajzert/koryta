<template>
  <v-row>
    <v-col cols="12">
      <HomeHero />
    </v-col>
    <HomeIntro id="intro" />
    <v-col cols="12" class="mt-4">
      <HomeHeading
        id="najwiekszy"
        class="scroll-topic"
        title="Największy"
        center
      />
      <HomeSourceCards />
    </v-col>
    <v-col cols="12" md="6">
      <HomeHeading
        id="ogolnopolski"
        class="scroll-topic"
        title="Ogólnopolski"
        center
      />
      <ChartPolandMap />
    </v-col>
    <v-col cols="12" md="6">
      <HomeHeading
        id="niezalezny"
        class="scroll-topic"
        title="Niezależny"
        center
      />
      <v-card class="py-4" color="surface-variant" variant="tonal" rounded="lg">
        <v-card-title>
          <h2 class="text-h5 font-weight-bold">
            Łącznie {{ people ? Object.values(people).length : 0 }}
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
      <HomeHeading
        id="agregator"
        class="scroll-topic"
        title="Agregator koryciarstwa"
        center
      />
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

    <CardHomeItem router="/pomoc" icon="mdi-plus-box-outline">
      <template #header> Dodaj osoby i artykuły </template>
      Dodaj brakujące osoby w spółkach państwa lub samorządu albo linki do
      artykułów wypisujących je.
    </CardHomeItem>
  </v-row>
</template>

<script setup lang="ts">
import { useFeminatyw } from "@/composables/feminatyw";
definePageMeta({ affineLink: "7CDdAj6z8PUAFNWT-phhD" });

const { entities: people } = useEntity("person");
const { koryciarz } = useFeminatyw();
</script>

<style scoped>
.scroll-topic {
  scroll-margin-top: 100px; /* Adjust this value based on header height */
  /* For mobile you might want less, or use a media query */
}

@media (max-width: 600px) {
  .scroll-topic {
    scroll-margin-top: 80px;
  }
}
</style>
