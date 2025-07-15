<template>
  <v-navigation-drawer location="right" permanent>
    <OpenAbstractDialog dialog="data" />
    <OpenAbstractDialog dialog="suggestion" />
    <OpenAbstractDialog dialog="employed" />
    <OpenAbstractDialog dialog="company" />
  </v-navigation-drawer>
  <v-alert type="info">
    Jeśli masz pytania,
    <a href="https://discord.gg/pnyPh7zXxS" target="_blank" class="text-white">
      dołącz do serwera Discord
    </a>
    - mamy kanał specjalnie dla koryta.pl
  </v-alert>
  <v-col cols="12">
    <h2 class="text-h5 font-weight-bold">Przejrzyj te artykuły</h2>
  </v-col>
  <v-col cols="12" v-if="!user">
    <v-container> Zaloguj się, by zobaczyć zawartość. </v-container>
  </v-col>
  <v-col cols="12" md="6" alignSelf="start">
    <h3 class="text-h6 font-weight-bold">
      Oczekujące artykuły do których się zgłosiłeś
    </h3>
    <v-virtual-scroll
      :maxHeight="400"
      :items="articlesAssigned"
      v-if="articlesAssigned.length > 0"
    >
      <template v-slot:default="{ item: article }">
        <ArticleCard :article="article[1]" :articleID="article[0]" />
      </template>
    </v-virtual-scroll>
    <v-container v-else>
      <p>Nie masz żadnych oczekujących artykułów do których się zgłosiłeś.</p>
    </v-container>
  </v-col>
  <v-col cols="12" md="6" alignSelf="start">
    <h3 class="text-h6 font-weight-bold">Pozostałe oczekujące artykuły</h3>
    <v-virtual-scroll
      :maxHeight="400"
      :items="articlesUnssigned"
      v-if="articlesUnssigned.length > 0"
    >
      <template v-slot:default="{ item: article }">
        <ArticleCard :article="article[1]" :articleID="article[0]" />
      </template>
    </v-virtual-scroll>
    <v-container v-else>
      <p>Nie ma żadnych artykułów do przypisania do Ciebie.</p>
    </v-container>
  </v-col>
  <v-col cols="12">
    <h2 class="text-h5 font-weight-bold">Statystyki aktywności:</h2>
    <UserActivityTable />
  </v-col>
</template>

<script lang="ts" setup>
import { useAuthState } from "@/composables/auth";
import { useArticles } from "@/composables/entities/articles";

const { articlesAssigned, articlesUnssigned } = useArticles();
const { user } = useAuthState();
</script>
