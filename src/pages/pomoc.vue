<template>
  <v-navigation-drawer
    location="right"
    permanent>
    <OpenAbstractDialog dialog="data"/>
    <OpenAbstractDialog dialog="suggestion"/>
    <OpenAbstractDialog dialog="employed"/>
    <OpenAbstractDialog dialog="company"/>
  </v-navigation-drawer>
  <v-row cols="12">
    <p> Jeśli masz pytania,
      <a href="https://discord.gg/pnyPh7zXxS" target="_blank" @click.stop>
        dołącz do serwera Discord
      </a> - mamy kanał specjalnie dla koryta.pl
    </p>
    <v-col cols="12">
      <h2 class="text-h5 font-weight-bold">
        Przejrzyj te artykuły - zgłoszone przez Ciebie pojawią się po lewej stronie
      </h2>
    </v-col>
    <v-col cols="12" v-if="!user">
      <v-container>
        Zaloguj się, by zobaczyć zawartość.
      </v-container>
    </v-col>
  </v-row>
  <!-- TODO this is hard coded and I don't know how to fix it -->
  <v-col cols="12" md="6">
    <v-virtual-scroll
      :height="400"
      :items="articlesAssigned"
      >
      <template v-slot:default="{ item: article }">
        <ArticleCard :article="article[1]" :articleID="article[0]" />
      </template>
    </v-virtual-scroll>
  </v-col>
  <v-col cols="12" md="6">
    <v-virtual-scroll
      :height="400"
      :items="articlesUnssigned"
      >
      <template v-slot:default="{ item: article }">
        <ArticleCard :article="article[1]" :articleID="article[0]" />
      </template>
    </v-virtual-scroll>
  </v-col>
  <v-col cols="12">
    <h2 class="text-h5 font-weight-bold">
      Statystyki aktywności:
    </h2>
    <UserActivityTable />
  </v-col>
</template>

<script lang="ts" setup>
import { useAuthState } from '@/composables/auth';
import { useArticles } from '@/composables/entities/articles'

const { articlesAssigned, articlesUnssigned } = useArticles()
const { user } = useAuthState();

</script>
