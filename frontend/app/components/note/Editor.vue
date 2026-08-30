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

    <!-- What to write, said with three written notes rather than with an
         adjective. „Nie wiadomo trochę, jakie info tam wklejać” is what an
         alpha tester said about the paragraph that stood here, which described
         the notes („dodatkowe informacje”) without showing one. The examples
         are `noteKindConfig`'s, so they are the same sentences the fields
         themselves offer as placeholders. An article's page asks for a
         snippet instead, and has no kinds to give examples of. -->
    <template v-if="user && !userNote && !isEditing">
      <p v-if="snippetOnly" class="k-lead">
        Co w tym artykule jest warte zapamiętania? Zapisz fragment albo własny
        komentarz. Notatki są publiczne - w ten sposób pomożesz innym zrozumieć,
        dlaczego ten tekst jest tu trzymany.
      </p>
      <template v-else>
        <p class="k-lead mb-1">
          Wiesz więcej na temat {{ subject }}? Wklej tu, co udało Ci się
          znaleźć, razem z linkiem do źródła. Notatki są publiczne i to z nich
          powstają kolejne powiązania w bazie - nie musi to być nic odkrywczego.
        </p>
        <ul class="k-lead k-examples">
          <li v-for="(config, value) in noteKindConfig" :key="value">
            <strong>{{ config.title }}</strong> - „{{ config.example }}”
          </li>
        </ul>
      </template>
    </template>

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
          <NoteSourceCard
            :model-value="source"
            :is-editing="false"
            :snippet-only="snippetOnly"
          />
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
            :snippet-only="snippetOnly"
            @update:model-value="formData.sources[index] = $event"
            @remove="removeSource(index)"
          />
        </v-col>
        <v-col v-if="user" cols="12" :md="singleColumn ? '12' : '6'">
          <!-- On an article there is one button and it makes a snippet: the
               url an entry would carry is the page you are already on, and
               typing another one there made a second article node out of a
               note filed against the first. A correction to the article record
               itself goes through "Zgłoś" like any other. -->
          <div v-if="snippetOnly" class="d-flex flex-wrap ga-2">
            <v-btn
              variant="outlined"
              size="small"
              color="primary"
              data-testid="note-add-snippet"
              @click="addSource('source')"
            >
              <v-icon start :icon="mdiNoteTextOutline" />
              Dodaj notatkę
            </v-btn>
          </div>
          <div v-else class="d-flex flex-wrap ga-2">
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

      <v-alert
        v-if="saveFailed"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-testid="note-save-error"
      >
        Nie udało się zapisać notatki. Sprawdź połączenie i spróbuj ponownie -
        wpisany tekst jest nadal tutaj.
      </v-alert>
      <v-alert
        v-else-if="promotionFailed"
        type="warning"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-testid="note-promotion-error"
      >
        Notatka została zapisana, ale nie udało się utworzyć strony artykułu z
        podanego adresu. Spróbujemy ponownie przy następnym zapisie.
      </v-alert>

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
import { articleIdsForSources } from "~/utils/notePromotion";
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

/** Whether an entry here is a snippet rather than a source with an address.
 *
 * On an article, the url a source entry would carry is the page the note is
 * already attached to: the field was noise at best, and at worst it minted a
 * second article node out of a note filed against the first. So an article's
 * notes are text, and the kinds - which exist to say "this record is wrong" -
 * go with the url, since a wrong article record is a revision rather than a
 * note.
 */
const snippetOnly = computed(() => props.nodeType === "article");

const emit = defineEmits(["saved"]);

const { user } = useAuthState();
const { userNote, otherNotes, saveNote, attachArticleIds } = useNotes(
  computed(() => props.nodeId),
);

const otherSources = computed(() => {
  return otherNotes.value.flatMap((n) => n.sources || []);
});

const isEditing = ref(false);
const saving = ref(false);
/** The note itself would not store. Said out loud, because the entries stay on
 * screen either way and a lost note otherwise looks exactly like a saved one. */
const saveFailed = ref(false);
/** The note stored but its urls did not become articles. A softer failure -
 * nothing the author wrote is lost, and the next save tries again - so it says
 * so without asking them to do anything. */
const promotionFailed = ref(false);

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
  // Never over an open editor. The promotion writes the note a second time a
  // few seconds after the save, and this watcher fired on that write and
  // replaced whatever the author had started typing since.
  if (isEditing.value) {
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

/** Who the article is about, as far as this note can say.
 *
 * The node the note hangs off: filing a url under a person is saying the page
 * is about them, and that is the only moment anybody says so. Only a person or
 * a company - `mentions` is not declared for a region, and on an article's own
 * page the subject would be the article itself. The server checks the type
 * again and ignores anything else, so this is which claim to make rather than
 * the guard on it.
 */
const mentionedNodes = computed(() =>
  props.nodeType === "person" || props.nodeType === "place"
    ? [props.nodeId]
    : [],
);

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
    mentions: mentionedNodes.value,
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
 * Reads the entries back off the stored note, falling back to what was just
 * saved for the first note on a node, where the collection has not caught up
 * with its own new document yet. Only to decide *which urls to fetch*, though -
 * the ids are written back by `attachArticleIds`, which re-reads the entries
 * inside a transaction, so an entry added while this was in flight survives.
 */
const promoteSources = async () => {
  const saved = userNote.value?.sources?.length
    ? userNote.value.sources
    : formData.value.sources;
  const stored = saved.map((source) => ({ ...source })) as NoteSource[];

  try {
    const articleIds = await articleIdsForSources(stored, articleIdFor);
    await attachArticleIds(articleIds);
  } catch (error) {
    console.error("Failed to promote note sources to articles", error);
    promotionFailed.value = true;
  }
};

const save = async () => {
  saving.value = true;
  saveFailed.value = false;
  promotionFailed.value = false;
  try {
    await saveNote(toRaw(formData.value));
    // Only once the write has actually landed. Closing the editor first made a
    // rejected save - a revoked token, a Firestore error - look exactly like a
    // stored one, and the entry was gone on the next navigation.
    isEditing.value = false;
    emit("saved");
  } catch (error) {
    console.error("Failed to save note", error);
    saveFailed.value = true;
    saving.value = false;
    return;
  }

  // Still inside the spinner: promotion writes the note a second time, and an
  // author who was handed the "Edytuj" button back could save over it.
  try {
    await promoteSources();
  } finally {
    saving.value = false;
  }
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

/* The three examples, as a list rather than as a sentence with semicolons in
   it: they are read by somebody looking for the one that matches what they
   have, not read through. */
.k-examples {
  padding-left: 1.1rem;
}

.k-examples li + li {
  margin-top: 2px;
}
</style>
