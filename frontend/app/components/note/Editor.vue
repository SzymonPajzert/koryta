<template>
  <!-- A section, not a card. This sits between "Historia powiązań" and the
       graph on a person's page and alongside "Zmiany na stanowisku", all of
       which are headed sections on the page's own background - a raised card
       with a title bar in the middle of them read as something pasted in from
       another site. The same component is the notes on a company, an article
       and a topic, and in the table's side panel, so restyling it here is what
       makes notes look the same everywhere they appear. -->
  <section
    v-if="user || otherSources.length > 0"
    class="px-2 mb-4"
    data-testid="note-editor"
  >
    <div class="sec-head">
      <v-icon :icon="mdiNoteTextOutline" size="18" class="sec-head__icon" />
      <h3 class="text-h6">Notatki</h3>
    </div>

    <p v-if="user && !userNote && !isEditing" class="k-lead">
      Wiesz więcej na temat {{ subject }}? Podziel się dodatkowymi informacjami
      i dodaj linki do źródeł. Możesz też zgłosić poprawkę albo brakujące dane.
      Twoje notatki będą publiczne - w ten sposób pomożesz innym w znajdowaniu
      powiązań.
    </p>

    <p v-if="!user && otherSources.length > 0" class="k-lead">
      Zaloguj się, aby dodać własną notatkę i pomóc innym w znajdowaniu
      powiązań.
    </p>

    <div>
      <!-- `dense`, and the cards carry no bottom margin of their own: the
           default gutter is 12px a side and each card added another 12 below
           itself, so two rows of entries stood 36px apart - more air between
           two notes than inside one. The dense gutter puts 8px between them,
           which still reads as separate cards. -->
      <v-row dense>
        <v-col
          v-for="(source, index) in otherSources"
          :key="'other-' + index"
          cols="12"
          :md="singleColumn ? '12' : '6'"
        >
          <NoteSourceCard :model-value="source" :is-editing="false" />
        </v-col>

        <v-col
          v-for="(source, index) in formData.sources"
          :key="source.url || index"
          cols="12"
          :md="singleColumn ? '12' : '6'"
        >
          <NoteSourceCard
            :model-value="source"
            :is-editing="isEditing"
            @update:model-value="formData.sources[index] = $event"
            @remove="removeSource(index)"
          />
        </v-col>
        <v-col v-if="user" cols="12" :md="singleColumn ? '12' : '6'">
          <div class="d-flex flex-wrap ga-2">
            <v-btn
              v-for="(config, value) in noteKindConfig"
              :key="value"
              variant="outlined"
              size="small"
              :color="config.color"
              @click="addSource(value)"
            >
              <v-icon start :icon="config.icon" />
              {{ config.addLabel }}
            </v-btn>
          </div>
        </v-col>
      </v-row>

      <div v-if="user" class="d-flex justify-end mt-4">
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
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, toRaw, computed } from "vue";
import { mdiNoteTextOutline } from "@mdi/js";
import { useNotes, noteKindConfig } from "~/composables/notes";
import { useAuthState } from "~/composables/auth";
import type {
  Note,
  NodeType,
  NoteEntryKind,
  NoteSource,
} from "~~/shared/model";
import { articlePayloadFor, ensureArticle } from "~/composables/articles";
import { promoteNoteSources } from "~/utils/notePromotion";
import { NoteSourceCard } from "#components";

const props = withDefaults(
  defineProps<{
    nodeId: string;
    singleColumn?: boolean;
    /** Kind of node the note hangs off, which the prompt refers to. */
    nodeType?: NodeType;
  }>(),
  { nodeType: "person" },
);

/** The node kind in the genitive, to read as "Wiesz więcej na temat ...?". */
const noteSubject: Record<NodeType, string> = {
  person: "tej osoby",
  place: "tej spółki",
  article: "tego artykułu",
  region: "tego regionu",
  topic: "tego tematu",
};

const subject = computed(() => noteSubject[props.nodeType]);

const emit = defineEmits(["saved"]);

const { user } = useAuthState();
const { userNote, otherNotes, saveNote } = useNotes(
  computed(() => props.nodeId),
);

const otherSources = computed(() => {
  return otherNotes.value.flatMap((n) => n.sources || []);
});

const isEditing = ref(false);
const saving = ref(false);

type NodeEditable = Omit<Partial<Note>, "sources"> & {
  sources: Required<Note>["sources"];
};

const formData = ref<NodeEditable>({
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

const addSource = (kind: NoteEntryKind) => {
  if (!isEditing.value) {
    startEditing();
  }
  formData.value.sources.push({
    url: "",
    note: "",
    kind,
  });
};

const removeSource = (index: number) => {
  formData.value.sources.splice(index, 1);
};

/** The article node for a url, made if this is the first time anyone cites it.
 *
 * A page that will not give up its title is still worth having, so it goes in
 * under its own address - the same thing the article list does with the pieces
 * that reached us without one. */
const articleIdFor = async (url: string) => {
  const payload = await articlePayloadFor(url);
  const { nodeId } = await ensureArticle({
    ...payload,
    name: payload.name || payload.url,
  });
  return nodeId;
};

/** Promote the note's sources once it is stored.
 *
 * After the save rather than before it: promoting fetches every new url to
 * read its title, which is seconds of somebody else's server, and nobody
 * should watch a save spinner for that. The note is what the author came to
 * write; the articles follow from it.
 *
 * Reads the entries back off the stored note, so an author who is already
 * writing the next one does not have that entry dropped by this second write -
 * falling back to what was just saved, for the first note on a node, where the
 * collection has not caught up with its own new document yet.
 */
const promoteSources = async () => {
  const saved = userNote.value?.sources?.length
    ? userNote.value.sources
    : formData.value.sources;
  const stored = saved.map((source) => ({ ...source })) as NoteSource[];

  try {
    const promoted = await promoteNoteSources(stored, articleIdFor);
    if (promoted) await saveNote({ sources: promoted });
  } catch (error) {
    console.error("Failed to promote note sources to articles", error);
  }
};

const save = async () => {
  saving.value = true;
  try {
    isEditing.value = false;
    await saveNote(toRaw(formData.value));
    emit("saved");
  } catch (error) {
    console.error("Failed to save note", error);
    return;
  } finally {
    saving.value = false;
  }

  await promoteSources();
};

// Automatically show editor if not created yet, wait, we have "startEditing" button for that
</script>

<style scoped>
/* Kept in step with the other sections on an entity page - `sec-head` and
   `k-lead` are the same rules `succession/PersonChanges.vue` carries, and a
   note heading that did not match one sitting directly above it was the whole
   complaint. */
.sec-head {
  align-items: center;
  display: flex;
  gap: 8px;
}

.sec-head__icon {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.k-lead {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.75rem;
  line-height: 1.5;
  margin: 4px 0 12px;
  max-width: 78ch;
}
</style>
