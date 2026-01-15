<template>
  <div
    class="position-absolute top-0 ma-4"
    style="max-width: 800px; width: 100%"
  >
    <v-card width="100%">
      <v-tabs v-model="tab" bg-color="primary">
        <v-tab value="details">Informacje</v-tab>
        <v-tab value="discussion">Dyskusja</v-tab>
      </v-tabs>

      <v-window v-model="tab">
        <v-window-item value="details">
          <div class="pa-4">
            <EntityDetailsCard :entity="entity" :type="type" />

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
                @click="handleEdit"
              >
                <template #prepend>
                  <v-icon color="warning" />
                </template>
                Zaproponuj zmianę
              </v-btn>
              <DialogProposeRemoval
                v-if="entity"
                :id="node"
                :type="type"
                :name="entity.name"
              >
                <template #activator="{ props }">
                  <v-btn
                    v-bind="user ? props : {}"
                    variant="tonal"
                    class="ml-2"
                    @click="!user && handleLoginRedirect()"
                  >
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
            <VoteWidget v-if="entity" :id="node" :entity="entity" type="node" />
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
import type { Person, Company, Article } from "~~/shared/model";
import CommentsSection from "@/components/comment/CommentsSection.vue";

const route = useRoute<"/entity/[destination]/[id]">();

const node = route.params.id as string;
const type = route.params.destination as string;
const tab = ref((route.query.tab as string) || "details");

watch(tab, (newTab) => {
  const query = { ...route.query };
  if (newTab === "discussion") {
    query.tab = "discussion";
  } else {
    delete query.tab;
  }
  useRouter().replace({ query });
});

// Use API fetch to ensure revisions are merged correctly (auth aware)
const { authFetch, user } = useAuthState();
const router = useRouter();

const handleLoginRedirect = () => {
  router.push({
    path: "/login",
    query: { redirect: route.fullPath },
  });
};

const handleEdit = () => {
  if (!user.value) {
    handleLoginRedirect();
  } else {
    router.push({
      path: `/edit/node/${node}`,
      query: { type },
    });
  }
};

const { data: response } = await authFetch<{
  node: Person | Company | Article;
}>(`/api/nodes/entry/${node}`);
const entity = computed(() => response.value?.node);

const { sources, targets, referencedIn } = await useEdges(node);
const edges = computed(() => [...sources.value, ...targets.value]);
</script>
