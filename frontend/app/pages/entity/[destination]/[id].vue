<template>
  <div
    class="position-absolute top-0 ma-4"
    style="max-width: 800px; width: 100%"
  >
    <v-card width="100%">
      <v-tabs v-model="tab" bg-color="surface-variant">
        <v-tab value="details">Informacje</v-tab>
        <v-tab value="discussion">Dyskusja</v-tab>
      </v-tabs>

      <v-window v-model="tab">
        <v-window-item value="details">
          <div class="pa-4">
            <v-card v-if="type == 'person'" width="100%" variant="flat">
              <v-card-title class="headline px-0">
                <PartyChip
                  v-for="party in person?.parties"
                  :key="party"
                  :party
                />
                <h2 class="text-h5 font-weight-bold">
                  {{ person?.name }}
                </h2>
              </v-card-title>
              <v-card-text class="px-0">
                {{ person?.content }}
              </v-card-text>
            </v-card>

            <v-card v-if="type == 'place'" width="100%" variant="flat">
              <v-card-title class="headline px-0">
                <v-icon start icon="mdi-office-building-outline" />
                <h2 class="text-h5 font-weight-bold d-inline">
                  {{ person?.name }}
                </h2>
              </v-card-title>
              <v-card-text class="px-0">
                <div
                  v-if="(person as any)?.krsNumber"
                  class="text-caption mb-2"
                >
                  KRS: {{ (person as any)?.krsNumber }}
                </div>
                {{ person?.content }}
              </v-card-text>
            </v-card>

            <v-card v-if="type == 'article'" width="100%" variant="flat">
              <v-card-title class="headline px-0">
                <v-icon start icon="mdi-file-document-outline" />
                <h2 class="text-h5 font-weight-bold d-inline">
                  {{ person?.name }}
                </h2>
              </v-card-title>
              <v-card-text class="px-0">
                <div
                  v-if="(person as any)?.sourceURL"
                  class="text-caption mb-2"
                >
                  URL:
                  <a :href="(person as any)?.sourceURL" target="_blank">{{
                    (person as any)?.sourceURL
                  }}</a>
                </div>
                {{ person?.content }}
              </v-card-text>
            </v-card>

            <div class="mt-4">
              <v-row>
                <v-col
                  v-for="edge in edges.filter((edge) =>
                    ['employed', 'connection', 'owns'].includes(edge.type),
                  )"
                  :key="edge.richNode?.name"
                  cols="12"
                  md="6"
                >
                  <CardShortNode :edge="edge" />
                </v-col>
              </v-row>
            </div>

            <div class="mt-4">
              <v-row>
                <v-col
                  v-for="edge in edges.filter((edge) =>
                    ['comment', 'mentions'].includes(edge.type),
                  )"
                  :key="edge.richNode?.name"
                  cols="12"
                  md="6"
                >
                  <CardShortNode :edge="edge" />
                </v-col>
              </v-row>
            </div>

            <div v-if="referencedIn.length" class="mt-4">
              <h3 class="text-h6 mb-2">Artykuł stanowi źródło dla:</h3>
              <v-row>
                <v-col
                  v-for="edge in referencedIn"
                  :key="edge.id"
                  cols="12"
                  md="6"
                >
                  <CardShortNode :edge="edge" />
                </v-col>
              </v-row>
            </div>

            <div class="mt-4">
              <v-btn
                variant="tonal"
                prepend-icon="mdi-pencil-outline"
                :to="{ path: `/edit/node/${node}`, query: { type } }"
              >
                <template #prepend>
                  <v-icon color="warning" />
                </template>
                Zaproponuj zmianę
              </v-btn>
              <DialogProposeRemoval
                v-if="person"
                :id="node"
                :type="type"
                :name="person.name"
              >
                <template #activator="{ props }">
                  <v-btn v-bind="props" variant="tonal" class="ml-2">
                    <template #prepend>
                      <v-icon color="error" icon="mdi-delete-outline" />
                    </template>
                    Zaproponuj usunięcie
                  </v-btn>
                </template>
              </DialogProposeRemoval>
              <QuickAddArticleButton
                v-if="type !== 'article'"
                :node-id="node"
                class="ml-2"
              />
            </div>
          </div>
        </v-window-item>

        <v-window-item value="discussion">
          <div class="pa-4">
            <VoteWidget v-if="person" :id="node" :entity="person" type="node" />
          </div>
          <div class="pa-4">
            <CommentsSection :node-id="node" />
          </div>
        </v-window-item>
      </v-window>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { useEdges } from "~/composables/edges";
import { useAuthState } from "~/composables/auth";
import type { Person } from "~~/shared/model";
import CommentsSection from "@/components/comment/CommentsSection.vue";

const route = useRoute<"/entity/[destination]/[id]">();

const node = route.params.id as string;
const type = route.params.destination as string;
const tab = ref("details");

// Use API fetch to ensure revisions are merged correctly (auth aware)
const { authFetch } = useAuthState();

const { data: response } = await authFetch<{ node: Person }>(
  `/api/nodes/entry/${node}`,
);
const person = computed(() => response.value?.node);

const { sources, targets, referencedIn } = await useEdges(node);
const edges = computed(() => [...sources.value, ...targets.value]);
</script>
