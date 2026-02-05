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
            <div v-if="type === 'place'" class="mb-4 d-flex">
              <v-btn
                variant="tonal"
                prepend-icon="mdi-format-list-bulleted"
                :to="`/lista?miejsce=${node}`"
              >
                Lista pracowników
              </v-btn>
              <v-btn
                class="ml-2"
                variant="tonal"
                prepend-icon="mdi-graph-outline"
                :to="`/graf?miejsce=${node}`"
              >
                Graf połączeń
              </v-btn>
            </div>
            <EntityDetailsCard :entity="entity" :type="type" />

            <div class="mt-4">
              <template v-if="type === 'place' || type === 'region'">
                <CardConnectionList :edges="owners" title="Właściciele" />
                <CardConnectionList
                  :edges="subsidiaries"
                  title="Spółki zależne"
                />
              </template>

              <v-row>
                <v-col
                  v-for="edge in edges.filter((edge) => {
                    if (type === 'place' || type === 'region') {
                      return ['employed', 'connection'].includes(edge.type);
                    }
                    return ['employed', 'connection', 'owns'].includes(
                      edge.type,
                    );
                  })"
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
                v-if="type !== 'region'"
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
                v-if="entity && type !== 'region'"
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
                v-if="type !== 'article' && type !== 'region'"
                :node-id="node"
                class="ml-2"
              />
            </div>

            <div v-if="user && entity" class="mt-4">
              <h4 class="text-subtitle-2 mb-2">Szybkie dodawanie</h4>
              <div class="d-flex flex-column gap-2">
                <v-btn
                  v-for="btn in quickAddButtons"
                  :key="btn.text"
                  variant="tonal"
                  size="small"
                  :prepend-icon="btn.icon"
                  class="mr-2 mb-2"
                  @click="quickAddEdge(btn)"
                >
                  {{ btn.text }}
                </v-btn>
              </div>
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
import type { Person, Company, Article, Region } from "~~/shared/model";
import CommentsSection from "@/components/comment/CommentsSection.vue";
import { useEdgeButtons, type NewEdgeButton } from "~/composables/edgeConfig";

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
  node: Person | Company | Article | Region;
}>(`/api/nodes/entry/${node}`);
const entity = computed(() => response.value?.node);

const { sources, targets, referencedIn } = await useEdges(node);
const edges = computed(() => {
  const allEdges = [...sources.value, ...targets.value];
  return allEdges.sort((a, b) => {
    // 1. Current employments first (start_date && !end_date)
    // TODO find a better place to contain somewhere information if they're currently employed
    const aCurrent = a.start_date && !a.end_date;
    const bCurrent = b.start_date && !b.end_date;
    if (aCurrent && !bCurrent) return -1;
    if (!aCurrent && bCurrent) return 1;

    // 2. Sort by end_date descending (recent finished jobs first)
    if (a.end_date && b.end_date) {
      if (a.end_date > b.end_date) return -1;
      if (a.end_date < b.end_date) return 1;
    }

    // 3. Sort by start_date descending
    if (a.start_date && b.start_date) {
      if (a.start_date > b.start_date) return -1;
      if (a.start_date < b.start_date) return 1;
    }

    return 0;
  });
});

const owners = computed(() => {
  return sources.value.filter((e) => e.type === "owns");
});

const subsidiaries = computed(() => {
  return targets.value.filter((e) => e.type === "owns");
});

const quickAddButtons = computed(() => {
  if (!entity.value) return [];
  // Filter buttons relevant for this node type
  return useEdgeButtons(entity.value.name).filter((b) => b.nodeType === type);
});

function quickAddEdge(btn: NewEdgeButton) {
  router.push({
    path: `/edit/node/${node}`,
    query: {
      type,
      edgeType: btn.edgeType,
      direction: btn.direction,
    },
  });
}
</script>
