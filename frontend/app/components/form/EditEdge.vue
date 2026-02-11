<template>
  <div class="d-flex align-center justify-space-between mb-2 mt-4">
    <h4 class="text-subtitle-1">
      {{ editedEdge ? "Edytuj powiązanie" : "Dodaj nowe powiązanie" }}
    </h4>
    <v-btn
      icon="mdi-close"
      variant="text"
      size="small"
      title="Anuluj"
      @click="emit('update')"
    />
  </div>

  <v-form @submit.prevent="processEdge">
    <v-row class="align-center my-4">
      <!-- Left Condition: Source -->
      <v-col cols="5" class="text-center d-flex flex-column align-center">
        <FormEdgeSourceTarget
          v-model="layout.source.ref.value"
          :node-name="layout.source.id.value ? props.nodeName : undefined"
          :node-type="layout.source.type.value"
          :label="sourceLabel"
          data-testid="entity-picker-source"
        />
      </v-col>

      <!-- Connection (Center) -->
      <v-col
        cols="2"
        class="text-center d-flex flex-column justify-center position-relative px-0"
      >
        <div class="d-flex align-center justify-center">
          <v-chip
            variant="tonal"
            rounded="pill"
            size="small"
            color="secondary"
            class="px-4"
          >
            <span class="mr-1">
              {{ edgeLabel }}
            </span>
            <v-icon :icon="arrowIcon" />
          </v-chip>
        </div>
      </v-col>

      <!-- Right Condition: Target -->
      <v-col cols="5" class="text-center d-flex flex-column align-center">
        <FormEdgeSourceTarget
          v-model="layout.target.ref.value"
          :node-name="layout.target.id.value ? props.nodeName : undefined"
          :node-type="layout.target.type.value"
          :label="targetLabel"
          data-testid="entity-picker-target"
        />
      </v-col>
    </v-row>

    <v-row dense>
      <v-col cols="12" md="6">
        <v-text-field
          v-model="newEdge.name"
          label="Nazwa relacji"
          density="compact"
          hide-details
          data-testid="edge-name-field"
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
      <v-col v-if="nodeType !== 'article'" cols="12">
        <EntityPicker
          v-model="referenceNode.ref.value"
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
          v-if="editedEdge"
          variant="text"
          class="mr-2"
          @click="emit('update')"
        >
          Anuluj
        </v-btn>
        <v-btn
          color="secondary"
          type="submit"
          :block="!editedEdge"
          :class="{ 'flex-grow-1': editedEdge }"
          :disabled="!readyToSubmit"
          data-testid="submit-edge-button"
        >
          {{ editedEdge ? "Zapisz zmiany" : "Dodaj powiązanie" }}
        </v-btn>
        <DialogProposeRemoval
          v-if="editedEdge"
          :id="newEdge.id!"
          collection="edges"
          class="ml-2"
          @success="emit('update')"
        />
      </v-col>
    </v-row>
  </v-form>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import EntityPicker from "~/components/form/EntityPicker.vue";
import type { NodeType, Link } from "~~/shared/model";
import {
  type edgeTypeExt as EdgeTypeExt,
  edgeTypeOptions,
} from "~/composables/useEdgeTypes";

definePageMeta({
  middleware: "auth",
});

const props = defineProps<{
  nodeId: string;
  nodeType: NodeType;
  nodeName: string;
  editedEdge?: string;
  edgeTypeExt: EdgeTypeExt;
  initialDirection?: "incoming" | "outgoing";
}>();

// Used to notify that the component has finished.
const emit = defineEmits<{
  (e: "update"): void;
}>();

const arrowIcon = computed(() => "mdi-arrow-right");

const referenceNode: NodeRef = {
  type: "article",
  ref: ref<Link<NodeType> | undefined>(undefined),
};

const {
  newEdge,
  processEdge,
  openEditEdge,
  edgeType,
  edgeLabel,
  layout,
  readyToSubmit,
} = useEdgeEdit({
  fixedNode: {
    id: props.nodeId,
    type: props.nodeType,
    ref: ref<Link<NodeType> | undefined>(undefined),
  },
  edgeType: props.edgeTypeExt,
  referenceNode,
  initialDirection: props.initialDirection,
  onUpdate: async () => emit("update"),
});

const currentOption = computed(() => {
  return edgeType.value ? edgeTypeOptions[edgeType.value] : undefined;
});

const sourceLabel = computed(() => currentOption.value?.sourceLabel);
const targetLabel = computed(() => currentOption.value?.targetLabel);

defineExpose({
  openEditEdge,
});

function dateRule(value: string) {
  if (!value) return true;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  return regex.test(value) || "Format daty musi być RRRR-MM-DD";
}
</script>
