<template>
  <!-- One note, as a card rather than as a form.
       It carries no margin of its own: `note/Editor.vue` - the only place this
       is used - sets the gap between entries, and a margin here was added on
       top of that gap rather than instead of it.
       `k-card k-card--accent` is the site's card, the same rule that draws a
       handover in "Zmiany na stanowisku" directly above this section on a
       person's page. That is the whole point of this component's shape: a
       reader told us twice that the notes came from another site, and they did
       - they were the only thing on the page rendered inside input fields. -->
  <article class="k-card k-card--accent note-entry" data-testid="note-entry">
    <!-- Reading a note. The kind of entry, where it came from and where that
         source ended up, in the idiom of a handover card's head: a 15px muted
         icon and small muted text above the thing itself. -->
    <template v-if="!isEditing">
      <div v-if="hasHead" class="note-entry__head">
        <!-- A plain source needs no label - the link under it says what it is.
             A correction or a gap is a different kind of claim and says so. -->
        <template v-if="kind !== 'source'">
          <v-icon
            :icon="noteKindConfig[kind].icon"
            size="15"
            class="note-entry__icon"
          />
          <span class="note-entry__kind">{{ noteKindConfig[kind].title }}</span>
        </template>

        <!-- On an article's page an entry is a snippet of that article, so
             the source it would name is the page itself. -->
        <a
          v-if="host && !snippetOnly"
          :href="source.url"
          :title="source.url"
          target="_blank"
          rel="noopener noreferrer"
          class="link-plain source-link"
        >
          <v-icon :icon="mdiLink" size="13" />
          {{ host }}
        </a>
        <!-- Not a url, and readers do write things like "gazeta, strona 3"
             here. Shown as what it is rather than as a link that would open a
             relative path on this site. -->
        <span v-else-if="source.url && !snippetOnly" class="note-entry__kind">
          {{ source.url }}
        </span>

        <!-- Where the url ended up: every source added to a note becomes an
             article, and this is the way to the page that holds its tags, its
             mentions and whatever else we know about it. -->
        <NuxtLink
          v-if="source.articleNodeId && !snippetOnly"
          :to="generateEntityUrl('article', source.articleNodeId)"
          class="link-plain note-entry__article"
        >
          <v-icon :icon="mdiFileDocumentOutline" size="13" />
          Artykuł
        </NuxtLink>
      </div>

      <!-- The note itself, at the scale of the names in the sections around it
           rather than at a text field's 16px. The author's prompt ("Czego tu
           brakuje?") is deliberately absent: it is a question put to whoever
           wrote this, and showing it to everybody else is what made the
           section read as an unfinished form. -->
      <p v-if="source.note" class="note-entry__text">{{ source.note }}</p>
    </template>

    <!-- Writing one. A form is right here, and only here. -->
    <template v-else>
      <v-chip-group
        v-if="!snippetOnly"
        v-model="kind"
        mandatory
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

      <!-- The example sits in the field while it is empty. A snippet has no
           kinds to give an example of; its prompt is the label. -->
      <v-textarea
        v-model="source.note"
        :label="snippetOnly ? SNIPPET_PROMPT : noteKindConfig[kind].prompt"
        :placeholder="
          snippetOnly ? undefined : `np. ${noteKindConfig[kind].example}`
        "
        :persistent-placeholder="!snippetOnly"
        variant="outlined"
        density="compact"
        hide-details
        rows="2"
        auto-grow
        :class="snippetOnly ? undefined : 'mt-2'"
      />

      <v-expand-transition>
        <div v-if="editingUrl && !snippetOnly" class="d-flex mt-2">
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

      <div class="d-flex align-center ga-2 mt-2">
        <!-- One control for the url instead of two: the chip shows what is
             stored and opens the field again, where before a separate pencil
             button sat beside it doing the same thing. -->
        <v-chip
          v-if="!editingUrl && !snippetOnly"
          size="small"
          variant="outlined"
          style="cursor: pointer"
          @click="editUrl()"
        >
          <v-icon start :icon="source.url ? mdiPencil : mdiPlus" />
          {{ source.url ? host || source.url : "Dodaj URL" }}
        </v-chip>

        <v-spacer />

        <v-btn
          :icon="mdiDelete"
          size="small"
          color="error"
          variant="text"
          @click="$emit('remove')"
        />
      </div>
    </template>
  </article>
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
import { sourceDomain } from "~/utils/sourceDomain";
import type { NoteEntryKind, NoteSource } from "~~/shared/model";

defineEmits(["remove"]);

const source = defineModel<NoteSource>({ required: true });
const { isEditing, snippetOnly } = defineProps<{
  isEditing: boolean;
  /** On an article page an entry is a piece of text and nothing else: the url
   * it would carry is the page it is already attached to, and the kinds exist
   * to report that a record is wrong, which is a revision rather than a note.
   * So the address field, the "Artykuł" link and the kind picker all go. */
  snippetOnly?: boolean;
}>();

// Replaces the object rather than mutating it so the parent's
// `update:model-value` handler sees the change.
const kind = computed<NoteEntryKind>({
  get: () => noteKindOf(source.value),
  set: (value) => {
    source.value = { ...source.value, kind: value };
  },
});

/** The source named by its host, or null where what was typed is not an
 * address at all. The full url stays on the link. */
const host = computed(() => sourceDomain(source.value.url));

/** Whether the row above the note says anything. A plain source with neither a
 * url nor an article behind it yet has nothing to put there, and an empty flex
 * row still costs its gap. */
const hasHead = computed(
  () =>
    kind.value !== "source" ||
    (!snippetOnly && (!!source.value.url || !!source.value.articleNodeId)),
);

/** What the text area asks for on an article, where the entry is the note. */
const SNIPPET_PROMPT = "Co ciekawego jest w tym artykule?";

const editingUrl = ref(false);

const editUrl = () => {
  editingUrl.value = true;
};

const saveUrl = () => {
  editingUrl.value = false;
};
</script>

<style scoped>
.note-entry {
  /* `.succ`'s padding, so a note and a handover are the same object with the
     same amount of air in it. The extra 2px on the left is the sage rail. */
  padding: 11px 12px 12px 14px;
}

.note-entry__head {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.6);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.75rem;
  gap: 4px 10px;
  line-height: 1.4;
}

.note-entry__icon {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.note-entry__kind {
  overflow-wrap: anywhere;
}

/* Both links read as body text rather than as sage ink, which is 1.85:1 on
   this theme - `link-plain` carries the colour, these carry the layout. */
.source-link,
.note-entry__article {
  align-items: center;
  display: inline-flex;
  gap: 3px;
  min-width: 0;
}

/* `.succ__name`'s scale: 0.8125rem, which is what every other entry on a
   person's page is set in. Inside a v-textarea this was 16px, and the notes
   were the loudest text on the page. */
.note-entry__text {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 0.8125rem;
  line-height: 1.45;
  margin: 0;
  /* Notes are written by hand, in paragraphs, and sometimes with a url in the
     middle of a word that has no break in it. */
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.note-entry__head + .note-entry__text {
  margin-top: 6px;
}
</style>
