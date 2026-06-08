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
            class="d-inline-block mb-8 mx-auto"
            style="width: 200px"
          >
            <NuxtImg
              width="200"
              height="200"
              src="/logo.png"
              class="d-block"
              fetchpriority="high"
              preload
              alt="Koryta.pl logo"
            />
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
    <v-row class="align-center">
      <v-col cols="12" md="8" class="d-flex pa-8">
        <omni-search width="400px" />
      </v-col>
      <v-col cols="12" md="4">
        <v-btn
          :append-icon="mdiChevronRight"
          color="secondary"
          border
          class="text-none"
          flat
          rounded="lg"
          slim
          text="Dowiedz się więcej"
          to="/o-nas"
        />
      </v-col>
    </v-row>
  </HomeSection>
  <HomeSection>
    <HomeExplorer />
  </HomeSection>
  <HomeSection>
    <v-row>
      <v-col cols="12" class="pa-0">
        <HomeHeading class="scroll-topic" title="Przeglądaj osoby" center />
      </v-col>
      <v-col cols="12" sm="6">
        <v-card
          to="/eksploruj/tabela"
          hover
          class="h-100 pa-4"
          color="surface-variant"
          variant="tonal"
          rounded="lg"
        >
          <v-list-item :append-icon="mdiTable">
            <template #title>
              <strong>TABELA POWIĄZAŃ</strong>
            </template>
          </v-list-item>
          <v-card-text class="text-body-1">
            Przeglądaj pełną bazę w formie interaktywnej tabeli i samodzielnie
            badaj powiązania między osobami, regionami i stanowiskami.
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6">
        <v-card
          to="/eksploruj/nowe"
          hover
          class="h-100 pa-4"
          color="surface-variant"
          variant="tonal"
          rounded="lg"
        >
          <v-list-item :append-icon="mdiLayersSearchOutline">
            <template #title>
              <strong>PRZEGLĄDAJ NOWE</strong>
            </template>
          </v-list-item>
          <v-card-text class="text-body-1">
            Znajdź osoby, które nie są jeszcze opublikowane na naszej stronie.
            Aktualnie jest ich jeszcze {{ toCheck }}.
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </HomeSection>
  <HomeSection>
    <v-row>
      <v-col cols="12">
        <HomeHeading class="scroll-topic" title="Zobacz źródła" center />
        <HomeSourceCards />
      </v-col>

      <v-col cols="12" class="text-center">
        <CardCallToAction />
      </v-col>
    </v-row>
  </HomeSection>
</template>

<script setup lang="ts">
import { mdiChevronRight, mdiLayersSearchOutline, mdiTable } from "@mdi/js";
import { useStats } from "~/composables/stats/useStats";

useSeoMeta({
  title: "Największy, niezależny agregator koryciarstwa",
  description:
    "Jesteśmy największym, ogólnopolskim, niezależnym agregatorem koryciarstwa. Sprawdź którymi stanowiskami w publicznych spółkach podzielili się politycy.",
  ogTitle: "Największy, niezależny agregator koryciarstwa",
  ogDescription:
    "Jesteśmy największym, ogólnopolskim i niezależnym agregatorem koryciarstwa. Sprawdź którymi stanowiskami w publicznych spółkach podzielili się politycy.",
  ogImage: "/logo.png",
});

definePageMeta({
  affineLink: "7CDdAj6z8PUAFNWT-phhD",
  fullWidth: true,
  hideSearch: true,
});

const { toCheck } = useStats();
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
