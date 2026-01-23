<template>
  <h4 class="text-subtitle-1 mb-2 mt-4">
    {{ isEditingEdge ? "Edytuj powiązanie" : "Dodaj nowe powiązanie" }}
  </h4>

  <div
    v-if="
      !isEditingEdge && mode === 'initial' && effectiveNodeType === 'person'
    "
    class="d-flex flex-column gap-2"
  >
    <v-btn
      variant="tonal"
      prepend-icon="mdi-file-document-plus-outline"
      color="primary"
      class="mb-2"
      @click="startAddEdge('mentioned_person', 'incoming')"
    >
      Dodaj artykuł wspominający {{ current.name }}
    </v-btn>
    <v-btn
      variant="tonal"
      prepend-icon="mdi-briefcase-plus-outline"
      color="primary"
      class="mb-2"
      @click="startAddEdge('employed', 'outgoing')"
    >
      Dodaj gdzie {{ current.name }} pracuje
    </v-btn>
    <v-btn
      variant="tonal"
      prepend-icon="mdi-account-plus-outline"
      color="primary"
      @click="startAddEdge('connection', 'outgoing')"
    >
      Dodaj osobę, którą {{ current.name }} zna
    </v-btn>
  </div>

  <v-form v-else @submit.prevent="processEdge">
    <!-- Visual Connection Editor -->
    <v-row class="align-center my-4">
      <!-- Source Picker / Current Node -->
      <v-col cols="4" class="text-center d-flex flex-column align-center">
        <div v-if="effectiveNodeType === 'article'" class="w-100">
          <EntityPicker
            v-model="pickerSource"
            :entity="edgeSourceType"
            label="Wyszukaj źródło"
            density="compact"
            hide-details
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
      <v-col v-if="effectiveNodeType !== 'article'" cols="12">
        <EntityPicker
          v-model="articleReference"
          entity="article"
          label="Źródło informacji (artykuł)"
          density="compact"
          hide-details
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
  // Find real type from options
  // This logic repeats somewhat useEdgeEdit internal, but we need to force it here
  edgeType.value = typeValue as EdgeType;
  newEdge.value.direction = direction;

  // Wait for watchers in useEdgeEdit to settle?
  // They are sync, so it should be fine. However, useEdgeEdit watchers might try to reset things.
  // We'll see.
  mode.value = "form";
}

// Fallback for non-person nodes or generic add
watch(
  effectiveNodeType,
  (type) => {
    if (type !== "person" && !isEditingEdge.value) {
      mode.value = "generic";
    } else if (type === "person" && mode.value === "generic") {
      // Optional: switch back to initial if going back to person?
      // For now, if we loaded as person, we are fine.
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
