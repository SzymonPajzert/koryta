<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">Leads / Wolne wątki</h1>
        <p class="mb-4">
          Tutaj znajdują się komentarze i uwagi, które nie zostały jeszcze
          przypisane do żadnego węzła ani krawędzi.
        </p>

        <v-card>
          <div class="pa-4">
            <CommentsSection lead-mode />
          </div>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import CommentsSection from "@/components/comment/CommentsSection.vue";

definePageMeta({
  middleware: "auth",
});
</script>
