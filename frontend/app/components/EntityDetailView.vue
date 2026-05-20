<template>
  <div style="width: 100%">
    <v-card
      v-if="status != 'success'"
      class="mb-4"
      :title="!user ? 'Dostęp zastrzeżony' : status"
    >
      <v-card-text v-if="!user" class="pt-0">
        <p class="mb-4">
          Ta strona nie została znaleziona lub oczekuje na zatwierdzenie.
          Niezaakceptowane strony są widoczne tylko dla zalogowanych
          użytkowników.
        </p>
        <v-btn color="primary" @click="handleLoginRedirect()">
          Zaloguj się
        </v-btn>
      </v-card-text>
      <v-card-text v-else class="pt-0">
        <v-alert type="warning" variant="tonal" class="mb-4">
          <p class="mb-2">Strona nie mogła zostać załadowana.</p>
          <p class="text-caption">
            Prawdopodobnie strona nie istnieje, została usunięta lub nie masz do
            niej dostępu. Upewnij się, że adres URL jest prawidłowy.
          </p>
        </v-alert>
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-refresh"
          @click="refreshNode()"
        >
          Odśwież stronę
        </v-btn>
        <v-btn
          color="secondary"
          variant="text"
          to="/"
          prepend-icon="mdi-home"
          class="ml-2"
        >
          Strona główna
        </v-btn>
      </v-card-text>
    </v-card>
    <v-card v-else width="100%" style="overflow: visible">
      <div class="pa-4">
        <div v-if="entity?.type === 'place'" class="mb-4 d-flex">
          <v-btn
            class="ml-2"
            variant="tonal"
            prepend-icon="mdi-graph-outline"
            :to="`/graf?miejsce=${node}`"
          >
            Graf połączeń
          </v-btn>
        </div>
        <div v-if="entity?.type === 'region'" class="mb-4 d-flex">
          <v-btn
            variant="tonal"
            prepend-icon="mdi-format-list-bulleted"
            :to="`/eksploruj/tabela?teryt=${regionTeryt}`"
          >
            Eksploruj region
          </v-btn>
        </div>
        <EntityDetailsCard
          v-if="entity"
          :key="sourcePath"
          :entity="entity"
          :type="type"
        />

        <div
          class="mt-4"
          style="
            height: 500px;
            width: 100%;
            position: relative;
            overflow: visible;
            border: 1px solid #ccc;
          "
        >
          <GraphContainer :key="node" :focus-node-id="node" :max-depth="1" />
        </div>

        <NoteEditor :node-id="node" class="mt-4" />

        <div class="mt-4">
          <template v-if="entity?.type === 'place'">
            <CardConnectionList :edges="owners" title="Właściciele" />
            <CardConnectionList :edges="subsidiaries" title="Spółki zależne" />
          </template>
          <template v-if="entity?.type === 'region'">
            <CardConnectionList :edges="owners" title="Część regionu" />
            <CardConnectionList :edges="subregions" title="Regiony" />
            <CardConnectionList :edges="subsidiaries" title="Spółki zależne" />
          </template>
          <template v-if="entity?.type === 'person'">
            <CardEmploymentHistory :edges="edges" />
          </template>
          <v-row v-else>
            <v-col
              v-for="edge in edges.filter((edge) => {
                const t = entity?.type || type;
                if (t === 'place' || t === 'region') {
                  return ['employed', 'connection'].includes(edge.type);
                }
                return ['employed', 'connection', 'owns', 'election'].includes(
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
            <v-col v-for="edge in referencedIn" :key="edge.id" cols="12" md="6">
              <CardShortNode :edge="edge" />
            </v-col>
          </v-row>
        </div>

        <!-- template v-if="user && entity">
          <template v-if="userWantsEdit">
            <div class="mt-4">
              <v-btn
                v-if="entity?.type !== 'region'"
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
                v-if="entity && entity.type !== 'region'"
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
                v-if="entity?.type !== 'article' && entity?.type !== 'region'"
                :node-id="node"
                class="ml-2"
              />
            </div>

            <div class="mt-4">
              <h4 class="text-subtitle-2 mb-2">Szybkie dodawanie</h4>
              <div class="d-flex flex-column gap-2">
                <v-btn
                  v-for="btn in quickAddButtons"
                  :key="btn.text"
                  variant="tonal"
                  size="small"
                  :prepend-icon="btn.icon"
                  class="mr-2 mb-2"
                  :data-testid="'edge-picker-' + btn.edgeType"
                  @click="quickAddEdge(btn)"
                >
                  {{ btn.text }}
                </v-btn>
              </div>
            </div>
          </template>
          <div v-else class="d-flex mt-4">
            <v-spacer />
            <v-btn color="primary" @click="userWantsEdit = true">
              Edytuj stronę
            </v-btn>
            <v-spacer />
          </div>
        </template-->
      </div>

      <!--div v-if="editedEdge" class="pa-4">
        <FormEditEdge
          :key="node"
          :node-id="node"
          :node-type="type"
          :node-name="entity?.name || ''"
          :edge-type-ext="editedEdge.edgeTypeExt"
          :initial-direction="editedEdge.direction"
          :edited-edge="undefined"
          @update="onEdgeUpdate"
        />
      </div -->

      <v-divider />

      <template v-if="!!user">
        <div class="pa-4">
          <CommentsSection :node-id="node" />
        </div>
      </template>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { useEdges } from "~/composables/edges";
import { useAuthState, authFetch } from "@/composables/auth";
import type {
  Person,
  Company,
  Article,
  Region,
  NodeType,
} from "~~/shared/model";
import CommentsSection from "@/components/comment/CommentsSection.vue";

definePageMeta({
  affineLink: "0Jk7aUVzpBbKpnGw-NNqZ",
});

const props = defineProps<{
  node: string;
  type: NodeType;
}>();

const node = props.node;
const type = props.type;

const route = useRoute();

const { user } = useAuthState();
const router = useRouter();

const handleLoginRedirect = () => {
  router.push({
    path: "/login",
    query: { redirect: route.fullPath },
  });
};

const sourcePath = computed(() => `/api/nodes/${node}`);
const {
  data: response,
  status,
  refresh: refreshNode,
} = await authFetch<{
  node: Person | Company | Article | Region;
}>(sourcePath);

watch(
  user,
  (newUser) => {
    if (newUser && status.value === "error") {
      refreshNode();
    }
  },
  { immediate: true },
);

useHead({
  title: computed(() => {
    if (status.value !== "success") {
      return "Strona nieznaleziona";
    }
    return response.value?.node?.name ?? "Strona nieznaleziona";
  }),
});

const entity = computed(() => response.value?.node);
const regionTeryt = computed(() => {
  if (entity.value && entity.value.type === "region") {
    return entity.value.teryt;
  }
  return undefined;
});

// Calculate edges and relationships
const { sources, targets, referencedIn } = await useEdges(node);
const edges = computed(() => [...sources.value, ...targets.value]);
const owners = computed(() => {
  return sources.value.filter((e) => e.type === "owns");
});
const subregions = computed(() => {
  return targets.value.filter(
    (e) => e.type === "owns" && e.richNode.type === "region",
  );
});
const subsidiaries = computed(() => {
  return targets.value.filter(
    (e) => e.type === "owns" && e.richNode.type == "place",
  );
});
</script>
