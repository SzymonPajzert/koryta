<template>
  <v-card class="mb-3" variant="outlined">
    <v-expand-transition>
      <div v-if="editingUrl" class="pa-2 pb-0 d-flex">
        <v-text-field
          v-model="source.url"
          label="URL"
          density="compact"
          variant="outlined"
          hide-details
          class="flex-grow-1"
          autofocus
          @keyup.enter="saveUrl()"
        />
        <v-btn
          icon="mdi-check"
          size="small"
          color="success"
          variant="text"
          class="ml-1 mt-1"
          @click="saveUrl()"
        />
      </div>
    </v-expand-transition>

    <v-textarea
      v-model="source.note"
      label="Notatka do źródła"
      :readonly="!isEditing"
      variant="plain"
      hide-details
      rows="2"
      auto-grow
      class="px-2 pt-2"
    />

    <div class="d-flex align-center px-2 pb-2 mt-n2">
      <v-chip
        v-if="source.url && !editingUrl"
        color="primary"
        variant="tonal"
        class="mr-2"
        size="small"
        style="max-width: 75%; cursor: pointer"
        @click="openUrl(source.url)"
      >
        <v-icon start>mdi-link</v-icon>
        <span class="text-truncate">{{ source.url }}</span>
      </v-chip>
      <v-chip
        v-else-if="!editingUrl && isEditing"
        color="grey"
        variant="outlined"
        class="mr-2"
        size="small"
        style="cursor: pointer"
        @click="editUrl()"
      >
        <v-icon start>mdi-plus</v-icon>
        Dodaj URL
      </v-chip>

      <v-btn
        v-if="source.url && !editingUrl && isEditing"
        icon="mdi-pencil"
        size="x-small"
        variant="text"
        class="mr-2"
        @click="editUrl()"
      />

      <v-spacer />

      <v-btn
        v-if="isEditing"
        icon="mdi-delete"
        size="small"
        color="error"
        variant="text"
        @click="$emit('remove')"
      />
    </div>
  </v-card>
</template>

<script lang="ts" setup>
import type { NoteSource } from "~~/shared/model";

defineEmits(["remove"]);

const source = defineModel<NoteSource>({ required: true });
const { isEditing } = defineProps<{ isEditing: boolean }>();

const editingUrl = ref(false);

const editUrl = () => {
  editingUrl.value = true;
};

const saveUrl = () => {
  editingUrl.value = false;
};

const openUrl = (url: string) => {
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
};
</script>
