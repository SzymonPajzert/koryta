<template>
  <!-- The same shell as the "Notatki" directly under it, so the two halves of
       the readers' section read as one thing. The count sits where a section's
       controls go. -->
  <PageSection
    v-if="notes.length > 0"
    title="Notatki z innych stron"
    :icon="mdiNoteMultipleOutline"
    lead="Co czytelnicy zapisali o tym artykule przy osobach i spółkach, których dotyczy."
    data-testid="article-cited-notes"
  >
    <template #actions>
      <v-chip size="x-small" variant="tonal">{{ notes.length }}</v-chip>
    </template>

    <v-row dense>
      <v-col v-for="note in notes" :key="note.key" cols="12" md="6">
        <v-card variant="outlined" class="h-100" data-testid="cited-note">
          <v-card-text class="py-3">
            <!-- Which page it was written on, first: without it the note is a
                 sentence with no subject, and the subject is the whole reason
                 it is interesting here. -->
            <NuxtLink
              v-if="note.nodeName && note.nodeType"
              :to="nodeUrl(note)"
              class="d-inline-flex align-center ga-1 text-body-2 font-weight-medium"
            >
              <v-icon :icon="entityIcon(note.nodeType)" size="16" />
              {{ note.nodeName }}
            </NuxtLink>
            <span v-else class="text-body-2 text-medium-emphasis">
              Nieznana strona
            </span>

            <v-chip
              v-if="note.kind !== 'source'"
              :color="noteKindConfig[note.kind].color"
              variant="tonal"
              size="x-small"
              class="ml-2"
            >
              {{ noteKindConfig[note.kind].title }}
            </v-chip>

            <p v-if="note.note" class="text-body-2 mt-2 mb-0">
              {{ note.note }}
            </p>

            <div
              v-if="note.createdAt"
              class="text-caption text-medium-emphasis mt-2"
            >
              {{ formatDate(note.createdAt) }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </PageSection>
</template>

<script setup lang="ts">
/** Every note entry that cites this article, written anywhere but here.
 *
 * The join is `NoteSource.articleNodeId`, which the promotion stamps on an
 * entry, plus a normalized url match for the entries it cannot stamp - the ones
 * written before promotion existed, and the corrections and gap reports, which
 * carry urls and are never promoted.
 *
 * Signed in only, and fetched with `authRequest` rather than `authFetch`
 * because only the former attaches a token to a GET. Notes on a person are
 * withheld from logged out readers on the person's own page, and this must not
 * be the way around that.
 */
import { mdiNoteMultipleOutline } from "@mdi/js";
import { ref, watchEffect } from "vue";
import { authRequest, useAuthState } from "~/composables/auth";
import { entityIcon } from "~/utils/entityIcon";
import { noteKindConfig } from "~/composables/notes";
import { generateEntityUrl } from "~/composables/slugs";
import type { NoteRow } from "~~/shared/model";
import type { ArticleNotes } from "~~/server/api/articles/[id]/notes.get";

const { nodeId } = defineProps<{ nodeId: string }>();

const { user } = useAuthState();
const notes = ref<NoteRow[]>([]);

watchEffect(async () => {
  if (!user.value) {
    notes.value = [];
    return;
  }
  try {
    const response = await authRequest<ArticleNotes>(
      `/api/articles/${nodeId}/notes`,
      { method: "GET" },
    );
    notes.value = response.notes;
  } catch {
    // An absent section rather than a broken one - the rest of the article page
    // is worth reading either way.
    notes.value = [];
  }
});

function nodeUrl(note: NoteRow) {
  return generateEntityUrl(note.nodeType!, note.nodeId, note.nodeName!);
}

function formatDate(value: string) {
  const date = new Date(value);
  return isNaN(date.getTime()) ? "" : date.toLocaleDateString("pl-PL");
}
</script>
