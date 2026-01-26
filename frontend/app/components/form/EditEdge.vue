<template>
  <div class="d-flex align-center justify-space-between mb-2 mt-4">
    <h4 class="text-subtitle-1">
      {{ isEditingEdge ? "Edytuj powiązanie" : "Dodaj nowe powiązanie" }}
    </h4>
    <v-btn
      v-if="mode !== 'initial'"
      icon="mdi-close"
      variant="text"
      size="small"
      title="Anuluj"
      @click="resetMode"
    />
  </div>

  <div
    v-if="!isEditingEdge && mode === 'initial'"
    class="d-flex flex-column gap-2"
  >
    <!-- Initial Buttons to pick edge type for a given node type -->
    <v-btn
      v-for="button in filteredButtons"
      :key="button.edgeType + '-' + button.direction"
      variant="tonal"
      :prepend-icon="button.icon"
      color="primary"
      class="mb-2"
      @click="startAddEdge(button.edgeType, button.direction)"
    >
      {{ button.text }}
    </v-btn>
  </div>

  <v-form v-else @submit.prevent="processEdge">
    <v-row class="align-center my-4">
      <v-col cols="4" class="text-center d-flex flex-column align-center">
        <div v-if="effectiveNodeType === 'article'" class="w-100">
          <EntityPicker
            v-model="pickerSource"
            :entity="edgeSourceType"
            label="Wyszukaj źródło"
            density="compact"
            hide-details
            data-testid="entity-picker-source"
          />
        </div>
        <div v-else class="d-flex flex-column align-center w-100">
          <v-chip
            class="mb-1 text-truncate"
            style="max-width: 100%"
            color="primary"
            variant="outlined"
          >
            {{ current.name || "Ten węzeł" }}
          </v-chip>
          <div class="text-caption text-medium-emphasis">
            {{ newEdge.direction === "outgoing" ? "Źródło" : "Cel" }}
          </div>
        </div>
      </v-col>

      <!-- Connection (Center) -->
      <v-col
        cols="4"
        class="text-center d-flex flex-column justify-center position-relative px-0"
      >
        <v-select
          v-if="isEditingEdge || mode === 'generic'"
          v-model="edgeType"
          :items="availableEdgeTypes"
          item-title="label"
          item-value="value"
          label="Relacja"
          density="compact"
          variant="solo-filled"
          hide-details
          class="mb-2"
          :disabled="!availableEdgeTypes.length"
          :placeholder="availableEdgeTypes.length ? undefined : 'Brak relacji'"
        />
        <div v-else class="text-caption font-weight-bold mb-2">
          {{
            availableEdgeTypes.find((t) => t.value === edgeType)?.label ||
            edgeType
          }}
        </div>

        <div class="d-flex align-center justify-center">
          <v-btn
            variant="tonal"
            rounded="pill"
            size="small"
            color="secondary"
            class="px-4"
            :title="'Odwróć kierunek'"
            :disabled="!isEditingEdge && mode !== 'generic'"
            @click="
              newEdge.direction =
                newEdge.direction === 'outgoing' ? 'incoming' : 'outgoing'
            "
          >
            <span class="mr-1">
              {{ newEdge.direction === "outgoing" ? "Do" : "Od" }}
            </span>
            <v-icon
              :icon="
                effectiveNodeType === 'article'
                  ? 'mdi-arrow-right'
                  : newEdge.direction === 'outgoing'
                    ? 'mdi-arrow-right'
                    : 'mdi-arrow-left'
              "
            />
          </v-btn>
        </div>
      </v-col>

      <!-- Picker (Right) -->
      <v-col cols="4" class="text-center d-flex flex-column align-center">
        <div class="w-100">
          <EntityPicker
            :key="edgeTargetType"
            v-model="pickerTarget"
            :entity="edgeTargetType"
            :label="`Wyszukaj ${edgeTargetType === 'person' ? 'osobę' : edgeTargetType === 'place' ? 'firmę' : 'obiekt'}`"
            density="compact"
            hide-details
            :disabled="!availableEdgeTypes.length"
            data-testid="entity-picker-target"
          />
        </div>
        <div class="text-caption text-center mt-1 text-medium-emphasis">
          {{ newEdge.direction === "outgoing" ? "Cel" : "Źródło" }}
        </div>
      </v-col>
    </v-row>

    <v-row dense>
      <v-col cols="12" md="6">
        <v-text-field
          v-model="newEdge.name"
          label="Nazwa relacji"
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
      <v-col v-if="effectiveNodeType !== 'article'" cols="12">
        <EntityPicker
          v-model="articleReference"
          entity="article"
          label="Źródło informacji (artykuł)"
          density="compact"
          hide-details
          data-testid="entity-picker-reference"
        />
      </v-col>
      <template v-if="edgeType === 'employed'">
        <v-col cols="12" md="6">
          <v-text-field
            v-model="newEdge.start_date"
            label="Data rozpoczęcia"
            placeholder="RRRR-MM-DD"
            density="compact"
            hide-details="auto"
            :rules="[dateRule]"
            prepend-inner-icon="mdi-calendar"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="newEdge.end_date"
            label="Data zakończenia"
            placeholder="RRRR-MM-DD"
            density="compact"
            hide-details="auto"
            :rules="[dateRule]"
            prepend-inner-icon="mdi-calendar"
          />
        </v-col>
      </template>
      <v-col cols="12" class="mt-2 d-flex gap-2">
        <v-btn
          v-if="isEditingEdge || mode !== 'initial'"
          variant="text"
          class="mr-2"
          @click="resetMode"
        >
          Anuluj
        </v-btn>
        <v-btn
          color="secondary"
          type="submit"
          :block="!isEditingEdge"
          :class="{ 'flex-grow-1': isEditingEdge }"
          :disabled="!pickerTarget"
        >
          {{ isEditingEdge ? "Zapisz zmiany" : "Dodaj powiązanie" }}
        </v-btn>
        <DialogProposeRemoval
          v-if="isEditingEdge"
          :id="newEdge.id!"
          collection="edges"
          class="ml-2"
          @success="cancelEditEdge"
        />
      </v-col>
    </v-row>
  </v-form>
</template>

<script setup lang="ts">
import { useNodeEdit } from "~/composables/useNodeEdit";
import EntityPicker from "~/components/form/EntityPicker.vue";
import type { Link, NodeType, EdgeType } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});

const route = useRoute();
const { node_id, refreshEdges, current, authHeaders, stateKey } =
  await useNodeEdit();
const effectiveNodeType = computed(() => {
  if (route.query.type) return route.query.type as NodeType;
  return current.value.type || "person";
});

type NewEdgeButton = {
  edgeType: string;
  direction: "incoming" | "outgoing";
  nodeType: NodeType;
  icon: string;
  text: string;
};

// TODO migrate it somewhere to edge model since it looks like a global config
const newEdgeButtons = computed<NewEdgeButton[]>(() => [
  {
    edgeType: "mentioned_person",
    direction: "incoming",
    nodeType: "person",
    icon: "mdi-file-document-plus-outline",
    text: "Dodaj artykuł wspominający " + current.value.name,
  },
  {
    edgeType: "employed",
    direction: "outgoing",
    nodeType: "person",
    icon: "mdi-briefcase-plus-outline",
    text: "Dodaj gdzie " + current.value.name + " pracuje",
  },
  {
    edgeType: "connection",
    direction: "outgoing",
    nodeType: "person",
    icon: "mdi-account-plus-outline",
    text: "Dodaj osobę, którą " + current.value.name + " zna",
  },
  {
    edgeType: "mentioned_company",
    direction: "incoming",
    nodeType: "place",
    icon: "mdi-file-document-plus-outline",
    text: "Dodaj artykuł wspominający " + current.value.name,
  },
  {
    edgeType: "owns",
    direction: "outgoing",
    nodeType: "place",
    icon: "mdi-domain-plus",
    text: "Dodaj firmę córkę",
  },
  {
    edgeType: "owns",
    direction: "incoming",
    nodeType: "place",
    icon: "mdi-domain",
    text: "Dodaj firmę matkę",
  },
  {
    edgeType: "mentioned_person",
    direction: "outgoing",
    nodeType: "article",
    icon: "mdi-account-plus-outline",
    text: "Wspomniana osoba w artykule",
  },
  {
    edgeType: "mentioned_company",
    direction: "outgoing",
    nodeType: "article",
    icon: "mdi-domain-plus",
    text: "Wspomniane miejsce w artykule",
  },
]);

const filteredButtons = computed(() =>
  newEdgeButtons.value.filter((b) => b.nodeType === effectiveNodeType.value),
);

const {
  newEdge,
  processEdge,
  cancelEditEdge,
  isEditingEdge,
  edgeTargetType,
  edgeSourceType,
  edgeType,
  availableEdgeTypes,
  pickerTarget,
  pickerSource,
} = useEdgeEdit({
  nodeId: node_id,
  nodeType: effectiveNodeType,
  authHeaders,
  onUpdate: refreshEdges,
  stateKey,
});

const mode = ref<"initial" | "form" | "generic">("initial");

function resetMode() {
  cancelEditEdge();
  mode.value = "initial";
}

// If we are editing, we are always in form mode
watch(
  isEditingEdge,
  (val) => {
    if (val) {
      mode.value = "form";
    }
  },
  { immediate: true },
);

function startAddEdge(
  typeValue: string,
  direction: "outgoing" | "incoming" = "outgoing",
) {
  edgeType.value = typeValue as EdgeType;
  newEdge.value.direction = direction;
  mode.value = "form";
}

// Fallback for non-person nodes or generic add
watch(
  effectiveNodeType,
  (type) => {
    // If it's a known type, we support the initial buttons mode
    const supportedTypes = ["person", "place", "article"];
    if (!supportedTypes.includes(type) && !isEditingEdge.value) {
      mode.value = "generic";
    } else if (supportedTypes.includes(type) && mode.value === "generic") {
      mode.value = "initial";
    }
  },
  { immediate: true },
);

const articleReference = computed({
  get: () => {
    const id = newEdge.value.references?.[0];
    if (!id) return undefined;
    return { id, type: "article", name: "" } as Link<"article">; // Name is not strictly required by EntityPicker for display if it's just the model
  },
  set: (val) => {
    if (val) {
      newEdge.value.references = [val.id];
    } else {
      newEdge.value.references = [];
    }
  },
});

if (current.value.type === "article") {
  newEdge.value.references = [node_id.value!];
}

function dateRule(value: string) {
  if (!value) return true;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  return regex.test(value) || "Format daty musi być RRRR-MM-DD";
}
</script>
