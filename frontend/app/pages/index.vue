<template>
  <HomeSection color>
    <!-- Desktop only. On a phone the logo and the headline are most of the
         first screen, and neither of them is something a reader can act on -
         the search below is, so it starts the page instead. -->
    <v-container
      fluid
      class="d-none d-md-flex align-center justify-center overflow-hidden w-100"
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
    <!-- Search and button in one wrapping flex line rather than an 8/4 grid.
         The grid put them in columns with different padding, so on a phone,
         where the columns stack, the button sat 20px to the left of the search
         bar above it, and on a desktop it started at the 8/12 mark - a gap
         wide enough to read as a stray control rather than as the search's
         companion. Wrapping puts it under the search on a phone, at the same
         left edge, and beside it everywhere else. -->
    <v-row class="align-center">
      <v-col
        cols="12"
        class="home-actions d-flex flex-wrap align-center ga-4 pa-4 pa-md-8"
      >
        <omni-search />
        <v-btn
          :append-icon="mdiChevronRight"
          color="secondary"
          border
          class="text-none"
          flat
          rounded="lg"
          slim
          text="Działaj z nami"
          to="/pomoc"
        />
      </v-col>
    </v-row>
  </HomeSection>
  <HomeSection>
    <HomeExplorer />
  </HomeSection>
  <!-- Desktop only, for now. Both cards are a screen tall on a phone and both
       lead somewhere the search bar already offers - "Lista wszystkich osób"
       is its first entry, and it is the first thing on the page now. -->
  <HomeSection class="d-none d-md-block">
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
      <v-col cols="12" class="text-center">
        <CardCallToAction />
      </v-col>
    </v-row>
  </HomeSection>
  <!-- Last on the page, and it has to be: the feed keeps growing as the reader
       scrolls, so anything below it is pushed further away every time it does. -->
  <HomeSection>
    <HomeRecentEmployments />
  </HomeSection>
</template>

<script setup lang="ts">
import { mdiChevronRight, mdiLayersSearchOutline, mdiTable } from "@mdi/js";
import { useStats } from "~/composables/stats/useStats";
import { SOCIAL_CARD } from "~/composables/entitySeo";

useSeoMeta({
  title: "Największy, niezależny agregator koryciarstwa",
  description:
    "Jesteśmy największym, ogólnopolskim, niezależnym agregatorem koryciarstwa. Sprawdź którymi stanowiskami w publicznych spółkach podzielili się politycy.",
  ogTitle: "Największy, niezależny agregator koryciarstwa",
  ogDescription:
    "Jesteśmy największym, ogólnopolskim i niezależnym agregatorem koryciarstwa. Sprawdź którymi stanowiskami w publicznych spółkach podzielili się politycy.",
  // logo.png is 5906px square and 1.4 MB - cropped to a circle by every
  // platform that accepts it at all. social-card.png is the 1200x630 they ask
  // for.
  ogImage: SOCIAL_CARD,
  twitterCard: "summary_large_image",
  twitterImage: SOCIAL_CARD,
});

definePageMeta({
  affineLink: "7CDdAj6z8PUAFNWT-phhD",
  fullWidth: true,
  hideSearch: true,
});

const { toCheck } = useStats();
</script>

<style scoped>
/* OmniSearch's root is `display: contents`, so the field itself is the flex
   item on this line - which is why the `width: 400px` this page used to pass
   never took, `.v-input` being `flex: 1 1 auto` and free to grow past it.
   Sizing it as the flex item is what holds: it fills the line on a phone and
   stops at the width the search was always meant to have. The basis is below
   the narrowest phone, so the button wraps under it rather than squeezing it. */
.home-actions :deep(.v-input) {
  flex: 1 1 280px;
  max-width: 400px;
}

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
