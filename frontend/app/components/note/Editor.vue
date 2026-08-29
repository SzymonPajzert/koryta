<template>
  <!-- A section, not a card, and now literally the same section component as
       "Zmiany na stanowisku" and "Fakty z artykułów" - which is the point.
       Twice a reader said the notes did not belong on the page, and twice the
       answer had been to copy the heading rules across by hand and let them
       drift again. `PageSection` is the shell; the entries below it are drawn
       by the same `k-card` rule as the cards in every neighbouring section.
       The same component is the notes on a company, an article and a topic,
       and in the table's side panel, so this is what notes look like
       everywhere they appear. -->
  <PageSection
    v-if="user || otherSources.length > 0"
    title="Notatki"
    :icon="mdiNoteTextOutline"
    data-testid="note-editor"
  >
    <template #lead>
      <p v-if="user && !userNote && !isEditing" class="k-lead">
        Wiesz więcej na temat {{ subject }}? Podziel się dodatkowymi
        informacjami i dodaj linki do źródeł. Możesz też zgłosić poprawkę albo
        brakujące dane. Twoje notatki będą publiczne - w ten sposób pomożesz
        innym w znajdowaniu powiązań.
      </p>

      <p v-if="!user && otherSources.length > 0" class="k-lead">
        Zaloguj się, aby dodać własną notatkę i pomóc innym w znajdowaniu
        powiązań.
      </p>
    </template>

    <div>
      <!-- Full width, one under another, 8px apart - `.succ`'s spacing. The
           two-up grid this was is what made the section read as its own
           layout: every other section on a person's page stacks its entries,
           and three of the six places that draw these notes already passed
           `single-column` to opt out of the columns. That prop is gone with
           the grid. -->
      <div class="note-entries">
        <NoteSourceCard
          v-for="(source, index) in otherSources"
          :key="'other-' + index"
          :model-value="source"
          :is-editing="false"
        />

        <NoteSourceCard
          v-for="(source, index) in formData.sources"
          :key="source.url || index"
          :model-value="source"
          :is-editing="isEditing"
          @update:model-value="formData.sources[index] = $event"
          @remove="removeSource(index)"
        />
      </div>

      <!-- Neutral, like the one "Dodaj" in "Historia powiązań" above: three
           buttons in primary, warning and info were the most coloured thing on
           a page whose entries carry no colour at all. The kind still has its
           colour - on the chip you pick while writing the entry, where it is
           telling you something. -->
      <div v-if="user" class="d-flex flex-wrap ga-2 mt-3">
        <v-btn
          v-for="(config, value) in noteKindConfig"
          :key="value"
          variant="outlined"
          size="small"
          rounded="lg"
          @click="addSource(value)"
        >
          <v-icon start :icon="config.icon" />
          {{ config.addLabel }}
        </v-btn>
      </div>

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
  </PageSection>
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
/* The gap between two notes, and between the heading and the first of them.
   8px is what `.succ` puts between two handovers in the section above, and a
   gap rather than a margin per card so that an entry carries no spacing of its
   own - the grid this replaced gave each card a 12px gutter *and* a 12px
   margin, which stood two notes further apart than a note is tall. */
.note-entries {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
</style>
