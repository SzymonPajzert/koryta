<template>
  <div>
    <v-row>
      <v-col cols="12" md="8">
        <HomeCard height="100%">
          <template #header> Co tutaj robimy? </template>
          Polskie partie oskarżają się od lat o koryciarstwo - ale kto robi go
          najwięcej? Koryta.pl to pierwsza baza danych, w której znajdziesz
          polityków i ich bliskich, którzy pracują w publicznych spółkach.
          Największy, ogólnopolski i bezpartyjny agregator informacji o
          politycznych układach.
          <!-- TODO VSCode is autoadding breaks here, I don't know why -->
          <br /><br />
          Te dane są oficjalnie publiczne i dostępne, jednak trzeba wiedzieć,
          czego szukać. My wiemy i szukamy.
        </HomeCard>
      </v-col>
      <v-col cols="12" md="4">
        <HomeCard height="100%">
          ❤️ Robimy ten projekt z miłości do przejrzystej i publicznej
          informacji. Nie mamy sponsorów ani partyjnego wsparcia.
          <br />
          <br />
          <strong>
            Jeśli chcesz pomóc w rozbiciu politycznego betonu, wesprzyj nas:
          </strong>
          <v-container class="d-flex flex-wrap ga-2 pa-2">
            <v-spacer />
            <v-btn
              href="https://zrzutka.pl/z/rd7ssx/pay"
              target="_blank"
              color="#E64164"
            >
              <v-img
                :width="30"
                aspect-ratio="16/9"
                cover
                src="@/assets/zrzutka.png"
              />
            </v-btn>
            <v-btn
              href="https://patronite.pl/romb.me?podglad-autora"
              target="_blank"
              color="white"
            >
              <v-img
                :width="30"
                aspect-ratio="16/9"
                cover
                src="@/assets/patronite.png"
              />
            </v-btn>
            <v-spacer />
          </v-container>
        </HomeCard>
      </v-col>
      <v-col cols="12" sm="3" class="text-center">
        <a
          href="https://zrzutka.pl/rd7ssx/award/g3z29z/przypinka-z-podziekowaniami"
          target="_blank"
        >
          <v-img position="center" height="300" src="@/assets/logo.png" />
        </a>
      </v-col>
      <v-col cols="12" sm="9" class="text-center">
        <CardCallToAction />
      </v-col>
      <v-col cols="12" sm="7">
        <omni-search-fake />
      </v-col>
      <v-col cols="12" sm="5">
        <HomeCard>
          Wyszukaj na górze znanych Ci polityków, miasta albo publiczne spółki.
          Kliknij po lewej, by sprawdzić zaproponowanych.
        </HomeCard>
      </v-col>
      <v-col cols="12" md="6">
        <v-card
          class="py-4"
          color="surface-variant"
          variant="tonal"
          rounded="lg"
        >
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

      <v-col cols="12" md="6">
        <v-card
          to="/graf?miejsce=0qGH8AL9bwUCQvrLNwiO"
          class="py-4"
          color="surface-variant"
          variant="tonal"
          rounded="lg"
        >
          <v-card-title>
            <h2 class="text-h5 font-weight-bold">
              Zobacz jak PSL przejęło PKP
            </h2>
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
            <h2 class="text-h5 font-weight-bold">
              Albo PL2050 ministerstwo klimatu
            </h2>
          </v-card-title>
          <v-card-text>
            <v-img class="mb-4" height="250" src="@/assets/polska2050.png" />
          </v-card-text>
        </v-card>
      </v-col>

      <CardHomeItem router="pomoc" icon="mdi-plus-box-outline">
        <template #header> Dodaj osoby i artykuły </template>
        Dodaj brakujące osoby w spółkach państwa lub samorządu albo linki do
        artykułów wypisujących je.
      </CardHomeItem>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { useFeminatyw } from "@/composables/feminatyw";

const { entities: people } = await useEntity("person");
const { koryciarz } = useFeminatyw();
</script>
