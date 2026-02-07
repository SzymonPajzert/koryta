<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">Audyt danych</h1>
      </v-col>
    </v-row>

    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="pending">Oczekujące Rewizje</v-tab>
      <v-tab value="edges-no-source">Krawędzie bez źródeł</v-tab>
      <v-tab value="articles-no-edges">Artykuły bez powiązań</v-tab>
      <v-tab value="my-revisions">Moje Propozycje</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="pending">
        <AuditView type="pending-revisions" />
      </v-window-item>
      <v-window-item value="edges-no-source">
        <AuditView type="edges-no-source" />
      </v-window-item>
      <v-window-item value="articles-no-edges">
        <AuditView type="articles-no-edges" />
      </v-window-item>
      <v-window-item value="my-revisions">
        <AuditView type="my-revisions" />
      </v-window-item>
    </v-window>
  </v-container>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AuditView from "@/components/audit/AuditView.vue";

definePageMeta({
  middleware: "auth",
});

const route = useRoute();
const router = useRouter();

const tab = computed({
  get: () => (route.query.tab as string) || "pending",
  set: (val) => {
    router.replace({ query: { ...route.query, tab: val } });
  },
});
</script>
