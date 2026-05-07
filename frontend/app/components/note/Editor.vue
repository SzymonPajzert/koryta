<template>
  <v-card v-if="user" class="mb-4">
    <v-card-title>Notatki</v-card-title>

    <v-card-text v-if="!userNote && !isEditing">
      <div>
        <p class="text-body-1 mb-4">
          Notatki pozwalają na prywatne gromadzenie informacji, powiązań i
          źródeł, a inni użytkownicy mogą przeglądać twoje notatki. Dodaj własną
          notatkę do tego obiektu!
        </p>
      </div>
    </v-card-text>
    <v-card-text>
      <v-row>
        <v-col
          v-for="(source, index) in formData.sources"
          :key="source.url || index"
          cols="12"
          md="6"
        >
          <NoteSourceCard
            :model-value="source"
            :is-editing="isEditing"
            @update:model-value="
              formData.sources && (formData.sources[index] = $event)
            "
            @remove="removeSource(index)"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-btn
            variant="outlined"
            size="small"
            color="primary"
            @click="addSource"
          >
            <v-icon start>mdi-plus</v-icon>
            Dodaj źródło
          </v-btn>
        </v-col>
      </v-row>

      <div class="d-flex justify-end mt-4">
        <v-btn
          v-if="userNote && !isEditing"
          variant="tonal"
          @click="startEditing"
        >
          Edytuj
        </v-btn>
        <v-btn v-if="isEditing" variant="text" class="mr-2" @click="cancelEdit"
          >Anuluj</v-btn
        >
        <v-btn v-if="isEditing" color="primary" :loading="saving" @click="save"
          >Zapisz</v-btn
        >
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, toRaw } from "vue";
import { useNotes } from "~/composables/notes";
import { useAuthState } from "~/composables/auth";
import type { Note } from "~~/shared/model";
import { NoteSourceCard } from "#components";

const props = defineProps<{
  nodeId: string;
}>();

const { user } = useAuthState();
const { userNote, saveNote } = useNotes(computed(() => props.nodeId));

const isEditing = ref(false);
const saving = ref(false);

const formData = ref<Partial<Note>>({
  sources: [],
});

const startEditing = () => {
  if (userNote.value) {
    // Clone to prevent mutating store/firestore proxy directly before saving
    formData.value = {
      sources: (userNote.value.sources || []).map((s) => ({ ...s })),
    };
  } else {
    formData.value = {
      sources: [],
    };
  }
  isEditing.value = true;
};
watch(userNote, (note) => {
  if (!note) {
    return;
  }
  formData.value = {
    sources: (note.sources || []).map((s) => ({ ...s })),
  };
});

const cancelEdit = () => {
  isEditing.value = false;
};

const addSource = () => {
  if (!isEditing.value) {
    startEditing();
  }
  if (!formData.value.sources) {
    formData.value.sources = [];
  }
  formData.value.sources.push({
    url: "",
    note: "",
  });
};

const removeSource = (index: number) => {
  if (formData.value.sources) {
    formData.value.sources.splice(index, 1);
  }
};

const save = async () => {
  saving.value = true;
  try {
    isEditing.value = false;
    await saveNote(toRaw(formData.value));
  } catch (error) {
    console.error("Failed to save note", error);
  } finally {
    saving.value = false;
  }
};

// Automatically show editor if not created yet, wait, we have "startEditing" button for that
</script>
