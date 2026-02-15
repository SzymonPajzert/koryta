<template>
  <div
    class="position-absolute top-0 ma-4"
    style="max-width: 800px; width: 100%"
  >
    <v-card width="100%" style="overflow: visible">
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
            <CardConnectionList :edges="subsidiaries" title="Spółki zależne" />
          </template>

          <v-row>
            <v-col
              v-for="edge in edges.filter((edge) => {
                if (type === 'place' || type === 'region') {
                  return ['employed', 'connection'].includes(edge.type);
                }
                return ['employed', 'connection', 'owns'].includes(edge.type);
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
            <v-col v-for="edge in referencedIn" :key="edge.id" cols="12" md="6">
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

      <v-divider />

      <div class="pa-4">
        <VoteWidget v-if="entity" :id="node" :entity="entity" type="node" />
      </div>
      <div class="pa-4">
        <CommentsSection :node-id="node" />
      </div>
    </v-card>

    <v-card v-if="editedEdge" class="pa-4">
      <FormEditEdge
        :key="`new-${editedEdge.edgeType}`"
        :node-id="node"
        :node-type="type"
        :node-name="entity?.name || ''"
        :edge-type-ext="editedEdge.edgeTypeExt"
        :initial-direction="editedEdge.direction"
        :edited-edge="undefined"
        @update="onEdgeUpdate"
      />
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { useEdges } from "~/composables/edges";
import { useAuthState } from "~/composables/auth";
import type {
  Person,
  Company,
  Article,
  Region,
  NodeType,
} from "~~/shared/model";
import CommentsSection from "@/components/comment/CommentsSection.vue";
import { useEdgeButtons, type NewEdgeButton } from "~/composables/useEdgeTypes";

const route = useRoute<"/entity/[destination]/[id]">();

const node = route.params.id as string;
const type = route.params.destination as NodeType;

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

// Calculate edges and relationships
const { sources, targets, referencedIn, refresh } = await useEdges(node);
const edges = computed(() => [...sources.value, ...targets.value]);
const owners = computed(() => {
  return sources.value.filter((e) => e.type === "owns");
});
const subsidiaries = computed(() => {
  return targets.value.filter((e) => e.type === "owns");
});

// Edge modification buttons
const quickAddButtons = computed(() => {
  if (!entity.value) return [];
  // Filter buttons relevant for this node type
  return useEdgeButtons(entity.value.name).filter((b) => b.nodeType === type);
});

const editedEdge = ref<NewEdgeButton | undefined>(undefined);
function quickAddEdge(btn: NewEdgeButton) {
  editedEdge.value = btn;
}
function onEdgeUpdate() {
  editedEdge.value = undefined;
  refresh();
}
</script>
