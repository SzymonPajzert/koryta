<template>
  <HomeSection color>
    <h1
      class="text-h5 text-sm-h3 text-md-h3 font-weight-bold mb-6 lh-title justify-center"
    ></h1>
    <v-container
      fluid
      class="d-flex align-center justify-center overflow-hidden w-100"
    >
      <v-row justify="center" align="center" class="w-100 h-100">
        <v-col cols="12" md="3" class="d-flex align-center justify-center">
          <a
            href="https://zrzutka.pl/rd7ssx/award/g3z29z/przypinka-z-podziekowaniami"
            target="_blank"
            class="d-inline-block mb-8"
          >
            <v-img width="200" src="@/assets/logo.png" class="mx-auto" />
          </a>
        </v-col>
        <v-col cols="12" md="9">
          <h1 class="text-h5 text-sm-h3 text-md-h2 font-weight-bold lh-title">
            <span class="text-high-emphasis"
              >Jesteśmy największym, ogólnopolskim i niezależnym agregatorem
              koryciarstwa</span
            >
          </h1>
        </v-col>
      </v-row>
    </v-container>
    <v-row>
      <v-col cols="12">
        <div
          class="ga-4 d-flex align-center justify-center flex-wrap"
          style="max-width: 100%"
        >
          <v-btn
            class="text-none"
            color="secondary"
            flat
            rounded="lg"
            text="Wesprzyj projekt"
            to="/pomoc"
          />

          <span>lub</span>

          <v-btn
            append-icon="mdi-chevron-right"
            border
            class="text-none"
            flat
            rounded="lg"
            slim
            text="Zobacz jak działa"
            to="/o-nas"
          />
        </div>
      </v-col>
    </v-row>
  </HomeSection>
  <HomeSection>
    <v-row>
      <v-col cols="12">
        <omni-search-fake />
      </v-col>
      <v-col cols="12">
        <h1
          class="text-h5 text-sm-h3 text-md-h4 font-weight-bold mb-6 lh-title justify-center"
        >
          Zobacz, co udało nam się znależć
        </h1>
      </v-col>

      <v-col cols="12">
        <v-tabs v-model="search" color="primary">
          <v-tab value="map">Mapa</v-tab>
          <v-tab value="parties">Partie</v-tab>
        </v-tabs>

        <v-divider></v-divider>

        <v-tabs-window v-model="search">
          <v-tabs-window-item value="map">
            <HomeHeading title="Mapa koryciarstwa" center />
            <ChartPolandMap />
          </v-tabs-window-item>
          <v-tabs-window-item value="parties">
            <HomeHeading title="Podział na partie" center />
            <v-card
              class="py-4"
              color="surface-variant"
              variant="tonal"
              rounded="lg"
            >
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
          </v-tabs-window-item>
        </v-tabs-window>
      </v-col>

      <v-col cols="12" class="mt-4">
        <HomeHeading class="scroll-topic" title="Zobacz źródła" center />
        <HomeSourceCards />
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
  </HomeSection>
</template>

<script setup lang="ts">
import { useFeminatyw } from "@/composables/feminatyw";
definePageMeta({ affineLink: "7CDdAj6z8PUAFNWT-phhD", fullWidth: true });

const { entities: people } = useEntities("person");
const { koryciarz } = useFeminatyw();

const search = ref("map");
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
