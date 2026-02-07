<template>
  <v-container :key="(route.params.id as string) || 'new'">
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
            <FormAlreadyExisting
              v-model="current.name"
              label="Nazwa"
              :entity="current.type || 'person'"
              :create="isNew"
              navigate
              required
            />
            <v-select
              v-model="current.type"
              :items="[
                {
                  title: 'Osoba',
                  value: 'person',
                },
                {
                  title: 'Firma',
                  value: 'place',
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
            <template v-if="current.type === 'place'">
              <v-text-field
                v-model="current.krsNumber"
                label="Numer KRS"
                hint="Numer w Krajowym Rejestrze Sądowym"
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
              <v-btn
                color="secondary"
                variant="text"
                :to="isNew ? '/' : `/entity/${current.type}/${node_id}`"
              >
                Anuluj
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
                  <v-btn
                    icon="mdi-open-in-new"
                    variant="text"
                    size="small"
                    target="_blank"
                    :to="`/entity/${edge.richNode.type}/${edge.richNode.id}`"
                    title="Otwórz w nowej karcie"
                  />
                </template>
              </v-list-item>
            </v-list>
            <div v-else class="text-caption mb-4">
              Brak istniejących powiązań.
            </div>

            <FormEditEdge />
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
          <v-btn variant="text" @click="fetchRevisions">Odśwież</v-btn>
        </v-card>
      </v-window-item>
    </v-window>
  </v-container>
</template>

<script setup lang="ts">
import { useNodeEdit } from "~/composables/useNodeEdit";
import type { NodeType } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});

const route = useRoute();
const {
  isNew,
  tab,
  current,
  loading,
  revisions,
  allEdges,
  partiesDefault,
  idToken,
  saveNode,
  fetchRevisions,
} = await useNodeEdit();

const { node_id, refreshEdges, authHeaders, stateKey } = await useNodeEdit();
const { openEditEdge } = useEdgeEdit({
  nodeId: node_id,
  nodeType: computed(() => {
    if (route.query.type) return route.query.type as NodeType;
    return current.value.type || "person";
  }),
  authHeaders,
  onUpdate: refreshEdges,
  stateKey,
});

if (route.query.type === "region" || current.value.type === "region") {
  // Region is read-only
  useRouter().replace(`/entity/region/${node_id.value}`);
}
</script>
