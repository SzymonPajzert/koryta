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
    <v-row class="align-center">
      <v-col cols="12" md="8" class="d-flex pa-8">
        <omni-search width="400px" />
      </v-col>
      <v-col cols="12" md="4">
        <v-btn
          append-icon="mdi-chevron-right"
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
definePageMeta({
  affineLink: "7CDdAj6z8PUAFNWT-phhD",
  fullWidth: true,
  hideSearch: true,
});
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
