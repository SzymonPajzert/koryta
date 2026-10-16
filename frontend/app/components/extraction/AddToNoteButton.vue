<template>
  <client-only>
    <v-btn
      v-if="entry"
      class="add-to-note"
      size="x-small"
      density="comfortable"
      variant="text"
      :color="tone"
      :prepend-icon="icon"
      :loading="saving"
      :disabled="added"
      data-testid="extraction-add-to-note"
      @click.stop.prevent="add"
    >
      {{ label }}
      <v-tooltip
        v-if="!added"
        activator="parent"
        location="bottom"
        max-width="280"
      >
        Zapisz ten fakt jako źródło w swojej notatce o tej osobie - z cytatem i
        linkiem do artykułu. Notatki są publiczne.
      </v-tooltip>
    </v-btn>
  </client-only>
</template>

<script setup lang="ts">
/** Turns one extracted fact into an entry in the reader's own note.
 *
 * What a reader who has just voted a fact „poprawny” asked for: a verdict is a
 * number nobody reads back, while a note entry is the sentence, its quote and
 * its url standing in the section above, publicly, under their name - and it is
 * the thing the article promotion already runs over, so a fact filed this way
 * ends up as an article node and a „wspomniany w artykule” edge without anybody
 * retyping the url into the note form.
 *
 * The entry is written as `source` rather than as a correction: the reader is
 * saying „this piece is worth reading about them”, which is exactly what a
 * source is, and `noteNeedsAction` would otherwise put every promoted fact into
 * the admin queue.
 */
import { computed, ref } from "vue";
import { mdiAlertCircleOutline, mdiCheck, mdiNotePlusOutline } from "@mdi/js";
import { useNotes } from "~/composables/notes";
import { ClientOnly } from "#components";
import {
  factConnector,
  factSubject,
  factTarget,
  factTypeLabel,
} from "~/utils/extraction";
import type { ExtractionFact, NoteSource } from "~~/shared/model";

const { fact, nodeId } = defineProps<{
  /** The fact being filed. */
  fact: ExtractionFact;
  /** The node the note hangs off - the person whose page this is, never
   * `fact.personNodeId`: the card is also drawn on other people's pages, and a
   * note belongs to the page it was written on. */
  nodeId: string;
}>();

/** The reader's note on this person, live.
 *
 * This is not the per-card listener the section refuses. Every card asks the
 * same question - `notes where nodeId == this person` - so the Firestore client
 * folds them into the one target `NoteEditor` above already has open, and the
 * reads are paid once for the page. `useVotes` is a different document per
 * card, which is what makes it a cost per fact rather than per page.
 */
const { userNote, saveNote } = useNotes(computed(() => nodeId));

/** The fact said as one line, the way the card draws it: subject, connector,
 * target. Prefixed with the kind, because a note entry is read in a list of
 * other people's entries with no card around it. */
const claim = computed(() =>
  [factSubject(fact), factConnector(fact), factTarget(fact)]
    .filter(Boolean)
    .join(" - "),
);

/** The article's own words - the thing that makes an entry worth filing, and
 * what tells a fact already in the note apart from one that is not.
 * Defensively defaulted: `justification` is declared required, but these
 * documents come out of a pipeline and one without it must cost a button
 * rather than the section. */
const quote = computed(() => (fact.justification || "").trim());

/** The article, with the protocol the stored url leaves off. */
const articleUrl = computed(() => {
  const raw = fact.articleUrl;
  if (!raw) return "";
  return raw.includes("://") ? raw : `https://${raw}`;
});

/** What gets written, or undefined when there would be nothing to write.
 *
 * A fact with neither a quote nor a url is already on screen in full, so an
 * entry made of it would only repeat the card back at the reader; everything
 * that makes the entry worth having comes from the article.
 */
const entry = computed<NoteSource | undefined>(() => {
  if (!quote.value && !articleUrl.value) return undefined;
  return {
    kind: "source",
    // "" rather than undefined: Firestore rejects an undefined field, and an
    // empty url is what the note form itself stores for an entry without one.
    url: articleUrl.value,
    note: quote.value
      ? `${factTypeLabel(fact)}: ${claim.value}. Cytat z artykułu: „${quote.value}”`
      : `${factTypeLabel(fact)}: ${claim.value}.`,
  };
});

/** Set the moment a write lands, so the button settles before the snapshot
 * carrying it comes back. */
const filed = ref(false);
const saving = ref(false);
const failed = ref(false);

/** Whether this fact is already in the note.
 *
 * Matched on the quote inside the entry rather than on the whole entry: the
 * note is the reader's own text and they may rewrite the sentence around the
 * citation, and an entry they edited must not read as absent and be filed a
 * second time. A fact with no quote falls back to its claim line, which is then
 * the only thing identifying it.
 */
const added = computed(() => {
  if (filed.value) return true;
  const needle = quote.value || claim.value;
  if (!needle) return false;
  return (userNote.value?.sources ?? []).some((source) =>
    (source.note || "").includes(needle),
  );
});

const label = computed(() => {
  if (failed.value) return "Nie udało się zapisać";
  return added.value ? "W Twojej notatce" : "Dodaj do notatki";
});

const icon = computed(() => {
  if (failed.value) return mdiAlertCircleOutline;
  return added.value ? mdiCheck : mdiNotePlusOutline;
});

/* `ink-success` rather than Vuetify's `success`: this is a text button, and
   `success` is picked as a fill - it measures 2.78:1 as text. `shared/colors.ts`
   carries the pair. */
const tone = computed(() => {
  if (failed.value) return "error";
  return added.value ? "ink-success" : undefined;
});

async function add() {
  if (!entry.value || added.value || saving.value) return;
  saving.value = true;
  failed.value = false;
  try {
    // Read at click time and copied out of the vuefire proxy, because
    // `saveNote` merges *fields* and `sources` is one field - handing it a
    // stale array replaces every entry the author has written since.
    const sources = (userNote.value?.sources ?? []).map((source) => ({
      ...source,
    }));
    await saveNote({ sources: [...sources, entry.value] });
    filed.value = true;
  } catch (error) {
    // Loud enough to be seen on the button, because the reader has no other way
    // of telling: the note is a section away and its own save is not involved.
    console.error("Failed to add an extracted fact to the note", error);
    failed.value = true;
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
/* Sits beside the verdict buttons and has to read as their equal rather than as
   the card's call to action - the same quiet the „To nie ta osoba” flag keeps. */
.add-to-note {
  letter-spacing: normal;
  text-transform: none;
  /* Its own gap, because Vuetify only spaces `.v-btn ~ .v-btn` in a card's
     action row and the verdict row beside it is a `div`. */
  margin-inline-end: 4px;
}
</style>
