<template>
  <v-row>
    <v-col cols="12">
      <h2>Współtwórz bazę</h2>
    </v-col>
    <v-col cols="12">
      <HomeCard>
        <template #header>Dodaj artykuł</template>
        <div class="mb-4">
          To najważniejszy sposób w jaki możesz pomóc. Masz ciekawe źródło?
          Dodaj artykuł i powiąż go z osobami i firmami.
        </div>
        <v-btn
          :to="{ path: '/edit/node/new', query: { type: 'article' } }"
          color="primary"
          prepend-icon="mdi-file-document-plus"
        >
          Dodaj artykuł
        </v-btn>
      </HomeCard>
    </v-col>
    <v-col cols="12" md="6">
      <HomeCard>
        <template #header>Dodaj osobę</template>
        <div class="mb-4">
          Brakuje polityka lub urzędnika? Dodaj nowy profil.
        </div>
        <v-btn
          :to="{ path: '/edit/node/new', query: { type: 'person' } }"
          color="secondary"
          variant="tonal"
          prepend-icon="mdi-account-plus"
          block
        >
          Dodaj osobę
        </v-btn>
      </HomeCard>
    </v-col>
    <v-col cols="12" md="6">
      <HomeCard>
        <template #header>Dodaj firmę</template>
        <div class="mb-4">Uzupełnij bazę o brakujące spółki i instytucje.</div>
        <v-btn
          :to="{ path: '/edit/node/new', query: { type: 'place' } }"
          color="secondary"
          variant="tonal"
          prepend-icon="mdi-domain-plus"
          block
        >
          Dodaj firmę
        </v-btn>
      </HomeCard>
    </v-col>
    <v-col cols="12" md="6">
      <HomeCard>
        <template #header>Weryfikuj zmiany</template>
        <div class="mb-4">
          Przeglądaj ostatnie edycje i pomóż nam dbać o jakość danych.
        </div>
        <v-btn
          to="/revisions"
          color="info"
          variant="tonal"
          prepend-icon="mdi-format-list-bulleted"
          block
        >
          Lista rewizji
        </v-btn>
      </HomeCard>
    </v-col>
    <v-col cols="12" md="6">
      <HomeCard height="100%">
        <template #header>Zgłoś błąd</template>
        <div class="mb-4">Masz pomysł na usprawnienie lub znalazłeś błąd?</div>
        <v-spacer class="mb-4" />
        <v-btn
          href="https://github.com/SzymonPajzert/koryta/issues/new"
          target="_blank"
          color="warning"
          variant="tonal"
          prepend-icon="mdi-github"
          block
        >
          Zgłoś na GitHub
        </v-btn>
      </HomeCard>
    </v-col>

    <v-col cols="12" class="mt-8">
      <h2>Dołącz do społeczności</h2>
    </v-col>
    <v-col cols="12">
      <!-- TODO update the link before the end of January 2025 -->
      <nuxt-link
        to="https://join.slack.com/t/korytapl/shared_invite/zt-3mx37782c-X2tRnWIYdMkSJm5oqK6yqQ"
        tag="div"
        class="clickable-card"
      >
        <HomeCard height="100px"
          ><template #header>Dołącz do Slacka</template>
          Pracują z nami ludzie od UX, programowania, analizy danych i
          czegokolwiek co może się przydać.
        </HomeCard>
      </nuxt-link>
    </v-col>
    <v-col cols="12" md="6">
      <nuxt-link
        to="https://docs.google.com/forms/d/e/1FAIpQLSfZX4ekzLEhX60f6Frn3JMKkYwbqG2tE1NNNN0Eu_Ozr814FQ/viewform"
        tag="div"
        class="clickable-card"
      >
        <HomeCard height="100px"
          ><template #header>Wypełnij formularz zgłoszeniowy</template>
          A my odpiszemy Ci z podprojektami, w których możesz wziąć udział.
        </HomeCard>
      </nuxt-link>
    </v-col>
    <v-col cols="12" md="6">
      <nuxt-link to="https://forum.koryta.pl" tag="div" class="clickable-card">
        <HomeCard height="100px"
          ><template #header>Dołącz do forum.koryta.pl</template> I dyskutuj z
          resztą użytkowników nad kolejnymi użytecznościami na
          stronie.</HomeCard
        >
      </nuxt-link>
    </v-col>

    <v-col cols="12" md="6" align="center">
      <iframe
        src="https://discord.com/widget?id=1338546021319315468&theme=dark"
        width="400"
        height="300"
        allowtransparency="true"
        frameborder="0"
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
      />
    </v-col>
    <v-col cols="12" md="6" align="center">
      <iframe
        src="https://widgets.sociablekit.com/facebook-group-posts/iframe/25619702"
        frameborder="0"
        width="400px"
        height="300px"
      />
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
import { HomeCard } from "#components";

definePageMeta({
  title: "Działaj z nami",
  isHelp: true,
  middleware: "auth",
});
</script>

<style scoped>
.clickable-card {
  cursor: pointer;
  text-decoration: none;
}
</style>
