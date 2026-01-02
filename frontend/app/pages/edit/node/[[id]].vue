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
              :items="[
                {
                  title: 'Osoba',
                  value: 'person',
                },
                {
                  title: 'Firma',
                  value: 'company',
                },
                {
                  title: 'Artykuł',
                  value: 'article',
                },
              ]"
              label="Typ"
              required
            />
            <v-select
              v-if="current.type === 'person'"
              v-model="current.parties"
              :items="partiesDefault"
              label="Partia"
              multiple
              chips
              deletable-chips
            />
            <template v-if="current.type === 'article'">
              <v-text-field
                v-model="current.sourceURL"
                label="URL Źródła"
                hint="Link do artykułu"
                persistent-hint
              />
              <v-text-field
                v-model="current.shortName"
                label="Krótka nazwa"
                hint="Np. Onet, WP, etc."
                persistent-hint
              />
            </template>
            <v-textarea
              v-model="current.content"
              label="Treść (Markdown)"
              rows="10"
            />

            <div class="d-flex gap-2 mt-4">
              <v-btn
                color="primary"
                type="submit"
                :disabled="!idToken || loading"
                :loading="loading"
              >
                Zapisz zmianę
              </v-btn>
            </div>
          </v-form>

          <template v-if="!isNew">
            <v-divider class="my-6" />

            <h3 class="text-h6 mb-4">Powiązania</h3>

            <v-list v-if="allEdges.length">
              <v-list-item
                v-for="edge in allEdges"
                :key="edge.richNode.id"
                class="px-0"
              >
                <template #prepend>
                  <v-icon
                    :icon="
                      edge.type === 'employed' ? 'mdi-briefcase' : 'mdi-link'
                    "
                    class="mr-2"
                  />
                </template>
                <v-list-item-title>{{ edge.richNode.name }}</v-list-item-title>
                <v-list-item-subtitle>{{
                  edge.label || edge.type
                }}</v-list-item-subtitle>
                <template #append>
                  <v-btn
                    icon="mdi-pencil"
                    variant="text"
                    size="small"
                    @click="openEditEdge(edge)"
                  />
                </template>
              </v-list-item>
            </v-list>
            <div v-else class="text-caption mb-4">
              Brak istniejących powiązań.
            </div>

            <h4 class="text-subtitle-1 mb-2 mt-4">
              {{
                isEditingEdge ? "Edytuj powiązanie" : "Dodaj nowe powiązanie"
              }}
            </h4>
            <v-form @submit.prevent="processEdge">
              <v-row dense>
                <v-col cols="12" md="6">
                  <v-select
                    v-model="edgeType"
                    :items="edgeTypeOptions"
                    item-title="label"
                    item-value="value"
                    label="Rodzaj relacji"
                    density="compact"
                    required
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <EntityPicker
                    v-model="pickerTarget"
                    :key="edgeTargetType"
                    :entity="edgeTargetType"
                    :label="`Wyszukaj ${edgeTargetType === 'person' ? 'osobę' : edgeTargetType === 'place' ? 'firmę' : 'obiekt'}`"
                    density="compact"
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="newEdge.name"
                    label="Nazwa relacji (opcjonalnie)"
                    density="compact"
                    hide-details
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="newEdge.content"
                    label="Opis relacji (opcjonalnie)"
                    density="compact"
                    hide-details
                  />
                </v-col>
                <v-col cols="12" class="mt-2 d-flex gap-2">
                  <v-btn
                    v-if="isEditingEdge"
                    variant="text"
                    @click="cancelEditEdge"
                    class="mr-2"
                  >
                    Anuluj
                  </v-btn>
                  <v-btn
                    color="secondary"
                    type="submit"
                    block
                    :class="{ 'flex-grow-1': isEditingEdge }"
                    :disabled="!pickerTarget"
                  >
                    {{ isEditingEdge ? "Zapisz zmiany" : "Dodaj powiązanie" }}
                  </v-btn>
                </v-col>
              </v-row>
            </v-form>
          </template>
        </v-card>
      </v-window-item>

      <v-window-item value="revisions">
        <v-card class="mt-4 pa-4">
          <v-list>
            <v-list-item v-for="rev in revisions" :key="rev.id">
              <v-list-item-title>{{ rev.update_time }}</v-list-item-title>
              <v-list-item-subtitle>{{ rev.update_user }}</v-list-item-subtitle>
            </v-list-item>
            <div v-if="!revisions.length" class="text-caption pa-4">
              Brak historii zmian.
            </div>
          </v-list>
          <v-btn @click="fetchRevisions" variant="text">Odśwież</v-btn>
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
  revisions,
  allEdges,
  partiesDefault,
  idToken,
  saveNode,
  processEdge,
  cancelEditEdge,
  isEditingEdge,
  fetchRevisions,
  openEditEdge,
  edgeTargetType,
  edgeType,
} = await useNodeEdit();
</script>
