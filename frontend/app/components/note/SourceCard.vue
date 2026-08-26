<template>
  <!-- No bottom margin: the grid in `note/Editor.vue` - the only place this is
       used - sets the spacing between entries, and a margin here was added on
       top of the gutter rather than instead of it. -->
  <v-card variant="outlined">
    <v-chip-group
      v-if="isEditing"
      v-model="kind"
      mandatory
      class="px-2 pt-1"
      density="compact"
    >
      <v-chip
        v-for="(config, value) in noteKindConfig"
        :key="value"
        :value="value"
        :color="config.color"
        size="small"
        variant="outlined"
      >
        <v-icon start :icon="config.icon" />
        {{ config.title }}
      </v-chip>
    </v-chip-group>

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
          :icon="mdiCheck"
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
      :label="noteKindConfig[kind].prompt"
      :readonly="!isEditing"
      variant="plain"
      hide-details
      rows="2"
      auto-grow
      class="px-2 pt-2"
    />

    <div class="d-flex align-center px-2 pb-2 mt-n2">
      <v-chip
        v-if="!isEditing && kind !== 'source'"
        :color="noteKindConfig[kind].color"
        variant="tonal"
        class="mr-2"
        size="small"
      >
        <v-icon start :icon="noteKindConfig[kind].icon" />
        {{ noteKindConfig[kind].title }}
      </v-chip>

      <v-chip
        v-if="source.url && !editingUrl"
        color="primary"
        variant="tonal"
        class="mr-2"
        size="small"
        style="max-width: 75%; cursor: pointer"
        @click="openUrl(source.url)"
      >
        <v-icon start :icon="mdiLink" />
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
        <v-icon start :icon="mdiPlus" />
        Dodaj URL
      </v-chip>

      <!-- Where the url ended up: every source added to a note becomes an
           article, and this is the way to the page that holds its tags, its
           mentions and whatever else we know about it. -->
      <v-chip
        v-if="source.articleNodeId && !editingUrl"
        :to="generateEntityUrl('article', source.articleNodeId)"
        color="secondary"
        variant="tonal"
        class="mr-2"
        size="small"
      >
        <v-icon start :icon="mdiFileDocumentOutline" />
        Artykuł
      </v-chip>

      <v-btn
        v-if="source.url && !editingUrl && isEditing"
        :icon="mdiPencil"
        size="x-small"
        variant="text"
        class="mr-2"
        @click="editUrl()"
      />

      <v-spacer />

      <v-btn
        v-if="isEditing"
        :icon="mdiDelete"
        size="small"
        color="error"
        variant="text"
        @click="$emit('remove')"
      />
    </div>
  </v-card>
</template>

<script lang="ts" setup>
import {
  mdiCheck,
  mdiDelete,
  mdiFileDocumentOutline,
  mdiLink,
  mdiPencil,
  mdiPlus,
} from "@mdi/js";
import { generateEntityUrl } from "~/composables/slugs";
import { noteKindConfig, noteKindOf } from "~/composables/notes";
import type { NoteEntryKind, NoteSource } from "~~/shared/model";

defineEmits(["remove"]);

const source = defineModel<NoteSource>({ required: true });
const { isEditing } = defineProps<{ isEditing: boolean }>();

// Replaces the object rather than mutating it so the parent's
// `update:model-value` handler sees the change.
const kind = computed<NoteEntryKind>({
  get: () => noteKindOf(source.value),
  set: (value) => {
    source.value = { ...source.value, kind: value };
  },
});

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
