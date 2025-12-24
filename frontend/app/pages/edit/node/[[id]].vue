<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">{{ isNew ? "Utwórz" : "Edytuj" }}</h1>
      </v-col>
    </v-row>

    <v-tabs v-model="tab">
      <v-tab value="content">Treść i Powiązania</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="content">
        <v-card class="mt-4 pa-4">
          <v-form @submit.prevent="saveNode">
            <v-text-field v-model="current.name" label="Nazwa" required />
            <v-select
              v-model="current.type"
              :items="['person', 'company', 'other']"
              label="Typ"
              required
            />
            <v-select
              v-model="current.parties"
              :items="partiesDefault"
              label="Partia"
              multiple
              chips
              deletable-chips
            />
            <v-textarea v-model="current.content" label="Treść (Markdown)" rows="10" />
            
            <div class="d-flex gap-2 mt-4">
              <v-btn color="primary" type="submit" :disabled="!idToken || loading" :loading="loading">
                Zapisz zmianę
              </v-btn>
              <template v-if="!isNew">
                <v-btn
                  color="warning"
                  variant="outlined"
                  class="ml-2"
                  @click="vote('interesting')"
                >
                  Ciekawe
                </v-btn>
                 <v-btn
                  color="error"
                  variant="outlined"
                  class="ml-2"
                  @click="vote('error')"
                >
                  Zgłoś błąd
                </v-btn>
              </template>
            </div>
          </v-form>
        </v-card>
      </v-window-item>
    </v-window>
  </v-container>
</template>

<script setup lang="ts">
import { useNodeEdit } from "~/composables/useNodeEdit";
import EntityPicker from "~/components/form/EntityPicker.vue";

definePageMeta({
  middleware: "auth",
});

const {
    isNew,
    tab,
    current,
    loading,
    edgeTypeOptions,
    newEdge,
    pickerTarget,
    newComment,
    revisions,
    allEdges,
    partiesDefault,
    idToken,
    saveNode,
    addEdge,
    addComment,
    vote,
    fetchRevisions,
    restoreRevision
} = await useNodeEdit();
</script>
