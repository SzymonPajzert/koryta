<template>
  <h4 class="text-subtitle-1 mb-2 mt-4">
    {{ isEditingEdge ? "Edytuj powiązanie" : "Dodaj nowe powiązanie" }}
  </h4>
  <v-form @submit.prevent="processEdge">
    <!-- Visual Connection Editor -->
    <v-row class="align-center my-4">
      <!-- Current Node (Left) -->
      <v-col cols="4" class="text-center d-flex flex-column align-center">
        <div class="d-flex flex-column align-center w-100">
          <v-chip
            class="mb-1 text-truncate"
            style="max-width: 100%"
            color="primary"
            variant="outlined"
          >
            {{ current.name || "Ten węzeł" }}
          </v-chip>
          <div class="text-caption text-medium-emphasis">
            {{ (newEdge as any).direction === "outgoing" ? "Źródło" : "Cel" }}
          </div>
        </div>
      </v-col>

      <!-- Connection (Center) -->
      <v-col
        cols="4"
        class="text-center d-flex flex-column justify-center position-relative px-0"
      >
        <v-select
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

        <div class="d-flex align-center justify-center">
          <v-btn
            variant="tonal"
            rounded="pill"
            size="small"
            color="secondary"
            class="px-4"
            :title="'Odwróć kierunek'"
            @click="
              (newEdge as any).direction =
                (newEdge as any).direction === 'outgoing'
                  ? 'incoming'
                  : 'outgoing'
            "
          >
            <span class="mr-1">
              {{ (newEdge as any).direction === "outgoing" ? "Do" : "Od" }}
            </span>
            <v-icon
              :icon="
                (newEdge as any).direction === 'outgoing'
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
          {{ (newEdge as any).direction === "outgoing" ? "Cel" : "Źródło" }}
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
      <template v-if="edgeType === 'employed'">
        <v-col cols="12" md="6">
          <v-text-field
            v-model="newEdge.start_date"
            label="Data rozpoczęcia"
            type="date"
            density="compact"
            hide-details
            prepend-inner-icon="mdi-calendar"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="newEdge.end_date"
            label="Data zakończenia"
            type="date"
            density="compact"
            hide-details
            prepend-inner-icon="mdi-calendar"
          />
        </v-col>
      </template>
      <v-col cols="12" class="mt-2 d-flex gap-2">
        <v-btn
          v-if="isEditingEdge"
          variant="text"
          class="mr-2"
          @click="cancelEditEdge"
        >
          Anuluj
        </v-btn>
        <v-btn
          color="secondary"
          type="submit"
          block
          :class="{ 'flex-grow-1': isEditingEdge }"
          :disabled="!pickerTarget"
        >
          {{ isEditingEdge ? "Zapisz zmiany" : "Dodaj powiązanie" }}
        </v-btn>
      </v-col>
    </v-row>
  </v-form>
</template>

<script setup lang="ts">
import { useNodeEdit } from "~/composables/useNodeEdit";
import EntityPicker from "~/components/form/EntityPicker.vue";

definePageMeta({
  middleware: "auth",
});

const { node_id, refreshEdges, current, authHeaders, stateKey } =
  await useNodeEdit();
const {
  newEdge,
  processEdge,
  cancelEditEdge,
  isEditingEdge,
  edgeTargetType,
  edgeType,
  availableEdgeTypes,
  pickerTarget,
} = useEdgeEdit({
  nodeId: node_id,
  nodeType: computed(() => current.value.type || "person"),
  authHeaders,
  onUpdate: refreshEdges,
  stateKey,
});
</script>
