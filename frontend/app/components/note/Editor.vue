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
    <!-- What to write, said with three written notes rather than with an
         adjective. „Nie wiadomo trochę, jakie info tam wklejać” is what an
         alpha tester said about the paragraph that stood here, which described
         the notes („dodatkowe informacje”) without showing one. The examples
         are `noteKindConfig`'s, so they are the same sentences the fields
         themselves offer as placeholders. An article's page asks for a
         snippet instead, and has no kinds to give examples of. -->
    <template #lead>
      <template v-if="user && !userNote && !isEditing">
        <p v-if="snippetOnly" class="k-lead">
          Co w tym artykule jest warte zapamiętania? Zapisz fragment albo własny
          komentarz. Notatki są publiczne - w ten sposób pomożesz innym
          zrozumieć, dlaczego ten tekst jest tu trzymany.
        </p>
        <template v-else>
          <p class="k-lead mb-1">
            Wiesz więcej na temat {{ subject }}? Wklej tu, co udało Ci się
            znaleźć, razem z linkiem do źródła. Notatki są publiczne i to z nich
            powstają kolejne powiązania w bazie - nie musi to być nic
            odkrywczego.
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
          :snippet-only="snippetOnly"
        />

        <NoteSourceCard
          v-for="(source, index) in formData.sources"
          :key="source.url || index"
          :model-value="source"
          :is-editing="isEditing"
          :snippet-only="snippetOnly"
          @update:model-value="formData.sources[index] = $event"
          @remove="removeSource(index)"
        />
      </div>

      <!-- On an article there is one button and it makes a snippet: the url
           an entry would carry is the page you are already on, and typing
           another one there made a second article node out of a note filed
           against the first. A correction to the article record itself goes
           through "Zgłoś" like any other. -->
      <div v-if="user && snippetOnly" class="d-flex flex-wrap ga-2 mt-3">
        <v-btn
          variant="outlined"
          size="small"
          rounded="lg"
          data-testid="note-add-snippet"
          @click="addSource('source')"
        >
          <v-icon start :icon="mdiNoteTextOutline" />
          Dodaj notatkę
        </v-btn>
      </div>
      <!-- Neutral, like the one "Dodaj" in "Historia powiązań" above: three
           buttons in primary, warning and info were the most coloured thing on
           a page whose entries carry no colour at all. The kind still has its
           colour - on the chip you pick while writing the entry, where it is
           telling you something. -->
      <div v-else-if="user" class="d-flex flex-wrap ga-2 mt-3">
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
import { articleIdsForSources } from "~/utils/notePromotion";
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
