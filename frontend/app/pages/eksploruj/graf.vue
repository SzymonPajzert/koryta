<template>
  <v-layout class="h-100 w-100">
    <v-navigation-drawer
      v-model="drawer"
      :location="$vuetify.display.mdAndUp ? 'right' : 'bottom'"
      :permanent="$vuetify.display.mdAndUp"
      width="450"
      class="pb-4"
    >
      <v-card-item title="Ustawienia grafu">
        <template v-if="!$vuetify.display.mdAndUp" #append>
          <v-btn
            density="compact"
            icon="mdi-close"
            variant="text"
            @click="drawer = false"
          />
        </template>
      </v-card-item>

      <v-divider />

      <v-card-text>
        <div class="mb-4">
          <div class="text-subtitle-1 font-weight-bold mb-2">
            Węzły centralne
          </div>

          <div
            v-for="nodeId in focusNodeIds"
            :key="nodeId"
            class="d-flex align-center mb-2"
          >
            <v-chip
              closable
              class="mr-2"
              style="max-width: 150px"
              @click:close="removeFocusNode(nodeId)"
            >
              <span class="text-truncate">{{
                nodesFiltered[nodeId]?.name || nodeId
              }}</span>
            </v-chip>
            <v-slider
              v-model="focusNodeWeights[nodeId]"
              :min="0"
              :max="5"
              :step="0.1"
              color="primary"
              hide-details
              class="flex-grow-1"
            />
            <div style="width: 30px" class="text-caption text-right ml-2">
              {{ focusNodeWeights[nodeId]?.toFixed(1) ?? "1.0" }}
            </div>
          </div>

          <OmniSearch
            no-navigate
            width="100%"
            class="mt-2"
            @select="onEntitySelect"
          />
        </div>

        <v-divider class="my-4" />

        <div class="mb-4">
          <div class="text-subtitle-1 font-weight-bold mb-2">Wagi typów</div>

          <div class="d-flex align-center mb-2">
            <div style="width: 80px" class="text-body-2">Osoba</div>
            <v-slider
              v-model="typeWeights.person"
              :min="0"
              :max="5"
              :step="0.1"
              color="primary"
              hide-details
              class="ml-2"
            />
            <div style="width: 30px" class="text-caption text-right ml-2">
              {{ typeWeights.person.toFixed(1) }}
            </div>
          </div>
          <div class="d-flex align-center mb-2">
            <div style="width: 80px" class="text-body-2">Firma</div>
            <v-slider
              v-model="typeWeights.company"
              :min="0"
              :max="5"
              :step="0.1"
              color="primary"
              hide-details
              class="ml-2"
            />
            <div style="width: 30px" class="text-caption text-right ml-2">
              {{ typeWeights.company.toFixed(1) }}
            </div>
          </div>
          <div class="d-flex align-center">
            <div style="width: 80px" class="text-body-2">Region/Inne</div>
            <v-slider
              v-model="typeWeights.region"
              :min="0"
              :max="5"
              :step="0.1"
              color="primary"
              hide-details
              class="ml-2"
            />
            <div style="width: 30px" class="text-caption text-right ml-2">
              {{ typeWeights.region.toFixed(1) }}
            </div>
          </div>
        </div>

        <v-divider class="my-4" />

        <div class="mb-4">
          <div class="text-subtitle-1 font-weight-bold">
            Maksymalny dystans: {{ maxDepth }}
          </div>
          <v-slider
            v-model="maxDepth"
            :min="1"
            :max="5"
            :step="1"
            color="primary"
            thumb-label
            hide-details
            :disabled="!ready && focusNodeIds.length > 0"
          />
        </div>

        <div class="mb-4">
          <div class="text-subtitle-1 font-weight-bold">
            Liczba węzłów: {{ maxNodes }}
          </div>
          <v-slider
            v-model="maxNodes"
            :min="10"
            :max="500"
            :step="10"
            color="primary"
            thumb-label
            hide-details
            :disabled="!ready && focusNodeIds.length > 0"
          />
        </div>

        <div class="mb-4">
          <div class="text-subtitle-1 font-weight-bold">
            Minimalny wynik węzła: {{ minScore }}
          </div>
          <v-slider
            v-model="minScore"
            :min="0"
            :max="1"
            :step="0.01"
            color="primary"
            thumb-label
            hide-details
            :disabled="!ready && focusNodeIds.length > 0"
          />
        </div>
      </v-card-text>
    </v-navigation-drawer>

    <!-- Drawer toggle for mobile -->
    <v-btn
      v-if="!$vuetify.display.mdAndUp"
      icon="mdi-format-list-bulleted"
      variant="elevated"
      position="absolute"
      location="top right"
      class="ma-4 z-index-top"
      @click="drawer = !drawer"
    />

    <v-main class="h-100 bg-grey-lighten-4">
      <div
        v-if="focusNodeIds.length === 0"
        class="h-100 d-flex align-center justify-center"
      >
        <v-card variant="flat" color="transparent" class="text-center">
          <v-icon size="64" color="grey-lighten-1">mdi-account-search</v-icon>
          <div class="text-h6 text-grey-darken-1 mt-4">
            Wybierz osobę lub firmę aby zobaczyć powiązania
          </div>
        </v-card>
      </div>
      <div v-else-if="pending" class="h-100 d-flex align-center justify-center">
        <v-progress-circular indeterminate size="64" color="primary" />
      </div>
      <GraphCanvas
        v-else-if="ready"
        :nodes="nodesVisual"
        :edges="edgesFiltered || []"
        :ready="ready"
        :focus-node-id="undefined"
        class="h-100"
      />
    </v-main>
  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useGraph } from "~/composables/graph";
import { useGraphAdjacent } from "~/composables/graphAdjacent";

definePageMeta({ fullWidth: true });
useHead({
  title: "Eksploruj - Graf - koryta.pl",
});

const drawer = ref(true);

const focusNodeIds = ref<string[]>([]);
const focusNodeWeights = ref<Record<string, number>>({});
const typeWeights = ref({
  person: 1.0,
  company: 1.0,
  region: 1.0,
});
const maxDepth = ref(2);
const maxNodes = ref(50);
const minScore = ref(0);

const onEntitySelect = (item: any) => {
  if (item.path === "/lista") return; // ignore generic list searches
  const id = item.logEventKey?.content_id;
  if (id && id !== "new") {
    if (!focusNodeIds.value.includes(id)) {
      focusNodeIds.value = [...focusNodeIds.value, id];
      focusNodeWeights.value[id] = 1.0;
    }
  }
};

const removeFocusNode = (id: string) => {
  focusNodeIds.value = focusNodeIds.value.filter((n) => n !== id);
  delete focusNodeWeights.value[id];
};

const {
  nodesFiltered,
  edgesFiltered,
  ready,
  pending: fetchPending,
} = useGraph({
  focusNodeIds,
  maxDepthRef: maxDepth,
});

const { nodeWeights } = useGraphAdjacent(nodesFiltered, edgesFiltered, {
  focusNodeIds,
  focusNodeWeights,
  typeWeights,
  maxDepth,
  maxNodes,
  minScore,
});

const pending = computed(() => fetchPending.value);

const nodesVisual = computed(() => {
  if (!nodesFiltered.value) return {};
  return Object.fromEntries(
    Object.entries(nodesFiltered.value).filter(
      ([key, _]) => nodeWeights.value[key] !== undefined,
    ),
  );
});
</script>

<style scoped>
.z-index-top {
  z-index: 100 !important;
}
</style>
