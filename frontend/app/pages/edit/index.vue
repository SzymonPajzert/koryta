<template>
  <v-container>
    <v-row class="mb-4">
      <v-col>
        <h1 class="text-h4">Edycja encji</h1>
      </v-col>
      <v-col class="text-right">
        <v-btn color="primary" to="/edit/node/" prepend-icon="mdi-plus">
          Dodaj nową
        </v-btn>
      </v-col>
    </v-row>

    <v-card>
      <v-tabs v-model="tab">
        <v-tab value="person">Osoby</v-tab>
        <v-tab value="place">Firmy</v-tab>
        <v-tab value="article">Artykuły</v-tab>
      </v-tabs>

      <v-card-text>
        <v-window v-model="tab">
          <v-window-item value="person">
            <entity-list type="person" />
          </v-window-item>
          <v-window-item value="place">
            <entity-list type="place" />
          </v-window-item>
          <v-window-item value="article">
            <entity-list type="article" />
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import EntityList from "~/components/EntityList.vue";

definePageMeta({
  middleware: "auth",
});

const tab = ref("person");
</script>
