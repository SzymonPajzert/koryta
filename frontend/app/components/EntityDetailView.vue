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
          :prepend-icon="mdiRefresh"
          @click="refreshNode()"
        >
          Odśwież stronę
        </v-btn>
        <v-btn
          color="secondary"
          variant="text"
          to="/"
          :prepend-icon="mdiHome"
          class="ml-2"
        >
          Strona główna
        </v-btn>
      </v-card-text>
    </v-card>
    <template v-else-if="node == 'teryt1261'">
      <v-row>
        <v-col cols="12" sm="9">
          <v-card>
            <v-card-title class="d-flex justify-center mt-3 text-wrap">
              <h2 class="text-h4 font-weight-bold mr-2">
                Statystyki koryciarstwa Krakowa
              </h2>
            </v-card-title>
            <v-card-text class="justify-center text-center">
              Podsumowanie, ile osób aktualnie u władzy jest lub kiedykolwiek
              było zatrudnionych w spółkach publicznych lub instytucjach.
            </v-card-text>
          </v-card>
        </v-col>
        <v-col
          cols="12"
          sm="3"
          height="100%"
          class="d-flex align-center justify-center"
        >
          <v-hover v-slot="{ isHovering, props: hoverProps }">
            <v-btn
              v-bind="hoverProps"
              border="md opacity-100 primary"
              class="text-none pl-6"
              color="primary"
              height="60"
              rounded="pill"
              spaced="end"
              text="Zobacz wszystkie osoby"
              variant="outlined"
              width="250"
              to="/eksploruj/tabela?teryt=1261"
            >
              <template #append>
                <v-avatar variant="text">
                  <v-progress-circular
                    bg-color="transparent"
                    color="primary"
                    :model-value="isHovering ? 100 : 0"
                    width="2"
                  >
                    <v-icon :icon="mdiArrowRight" />
                  </v-progress-circular>
                </v-avatar>
              </template>
            </v-btn>
          </v-hover>
        </v-col>
      </v-row>

      <RegionPeopleStatistics teryt="1261" class="mt-2" />
      <RegionPeopleStatistics teryt="12" />
    </template>
    <v-card v-else width="100%" style="overflow: visible">
      <div class="pa-4">
        <v-alert v-if="revisionId" type="info" variant="tonal" class="mb-4">
          Wyświetlasz podgląd zaproponowanej zmiany na tej stronie.
          <br />
          <nuxt-link :to="`/admin/rewizje/${node}?revisionId=${revisionId}`"
            >Zobacz historię zmian</nuxt-link
          >.
        </v-alert>

        <div v-if="entity?.type === 'place'" class="mb-4 d-flex">
          <v-btn
            class="ml-2"
            variant="tonal"
            :prepend-icon="mdiGraphOutline"
            :to="`/graf?miejsce=${node}`"
          >
            Graf połączeń
          </v-btn>
        </div>
        <div v-if="entity?.type === 'region'" class="mb-4 d-flex">
          <v-btn
            variant="tonal"
            :prepend-icon="mdiFormatListBulleted"
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
          v-if="!smAndDown || showGraph"
          class="mt-4"
          style="
            height: 500px;
            width: 100%;
            position: relative;
            overflow: visible;
            border: 1px solid #ccc;
          "
        >
          <LazyGraphContainer
            :key="node"
            :focus-node-id="node"
            :max-depth="1"
          />
        </div>
        <div v-else class="mt-4 d-flex justify-center">
          <v-btn
            color="primary"
            variant="tonal"
            :prepend-icon="mdiGraphOutline"
            @click="showGraph = true"
          >
            Pokaż graf powiązań
          </v-btn>
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
                :prepend-icon="mdiPencilOutline"
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
                      <v-icon color="error" :icon="mdiDeleteOutline" />
                    </template>
                    Zaproponuj usunięcie
                  </v-btn>
                </template>
              </DialogProposeRemoval>
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
import {
  mdiArrowRight,
  mdiFormatListBulleted,
  mdiGraphOutline,
  mdiHome,
  mdiRefresh,
} from "@mdi/js";
import { useEdges } from "~/composables/edges";
import { useAuthState, authFetch } from "@/composables/auth";
import type {
  Person,
  Company,
  Article,
  Region,
  NodeType,
  Revision,
} from "~~/shared/model";
import CommentsSection from "@/components/comment/CommentsSection.vue";
import { useDisplay } from "vuetify";

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

const { smAndDown } = useDisplay();
const showGraph = ref(false);

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

const revisionId = computed(() => route.query.revisionId as string | undefined);

const { data: revisionResponse } = await useAsyncData<Revision | null>(
  `revision-${route.query.revisionId || "none"}`,
  async () => {
    if (!revisionId.value) return null;
    return $fetch<Revision>(`/api/revisions/${revisionId.value}` as never);
  },
  { watch: [revisionId] },
);

const entity = computed(() => {
  if (revisionId.value && revisionResponse.value?.data) {
    return {
      ...response.value?.node,
      ...revisionResponse.value.data,
    } as unknown as Person | Company | Article | Region;
  }
  return response.value?.node;
});

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

// SEO: rich previews for shared node links (social cards + search snippets)
const seoTypeLabels: Record<NodeType, string> = {
  person: "Osoba",
  place: "Instytucja",
  region: "Region",
  article: "Artykuł",
};

function formatConnectionCount(n: number): string {
  if (n === 1) return "1 udokumentowane powiązanie";
  const last = n % 10;
  const lastTwo = n % 100;
  if ([2, 3, 4].includes(last) && ![12, 13, 14].includes(lastTwo)) {
    return `${n} udokumentowane powiązania`;
  }
  return `${n} udokumentowanych powiązań`;
}

const connectionCount = computed(
  () =>
    edges.value.filter((e) =>
      ["employed", "connection", "owns", "election"].includes(e.type),
    ).length,
);

const seoDescription = computed(() => {
  const e = entity.value;
  if (!e) return undefined;
  const connections = formatConnectionCount(connectionCount.value);
  switch (e.type) {
    case "person": {
      const parties = e.parties?.length
        ? ` Komitety i partie: ${e.parties.join(", ")}.`
        : "";
      return `${e.name} — ${connections} w bazie Koryta.pl: zatrudnienie w spółkach publicznych, starty w wyborach i źródła.${parties}`;
    }
    case "place":
      return `${e.name} — ${connections} w bazie Koryta.pl: sprawdź, które osoby ze świata polityki są związane z tą instytucją.`;
    case "region":
      return `${e.name} — statystyki koryciarstwa regionu w bazie Koryta.pl: osoby u władzy zatrudnione w spółkach publicznych i instytucjach.`;
    case "article":
      return `${e.name} — artykuł źródłowy w bazie powiązań Koryta.pl.`;
    default:
      return undefined;
  }
});

const seoTitle = computed(() => {
  if (status.value !== "success") {
    return "Strona nieznaleziona";
  }
  return entity.value?.name ?? "Strona nieznaleziona";
});

useSeoMeta({
  title: seoTitle,
  description: seoDescription,
  ogTitle: seoTitle,
  ogDescription: seoDescription,
  twitterCard: "summary_large_image",
});

if (status.value === "success" && entity.value) {
  defineOgImageComponent("NodeCard", {
    title: entity.value.name,
    typeLabel: seoTypeLabels[entity.value.type] ?? "",
    connectionsLabel: formatConnectionCount(connectionCount.value),
  });
}
</script>
