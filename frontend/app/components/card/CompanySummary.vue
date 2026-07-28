<template>
  <v-card variant="outlined">
    <v-row no-gutters align="start">
      <v-col cols="12" :md="notesOpen ? 6 : 12">
        <v-card-text class="d-flex flex-wrap align-center ga-4">
          <div class="d-flex align-center ga-2 mr-auto">
            <v-icon :icon="mdiOfficeBuildingOutline" class="flex-shrink-0" />
            <span class="text-h6 text-wrap">{{ company.name }}</span>
          </div>

          <div class="d-flex flex-wrap align-center ga-4 text-body-2">
            <span v-if="company.krsNumber">
              <strong>KRS:</strong> {{ company.krsNumber }}
            </span>
            <span v-if="location">
              <strong>Lokalizacja:</strong> {{ location }}
            </span>
            <ChipPublicCompany :is-public="company.isPublic" />
          </div>

          <div class="d-flex flex-wrap ga-2">
            <v-btn
              v-if="canEditNotes"
              variant="tonal"
              :prepend-icon="mdiNoteTextOutline"
              @click="notesOpen = !notesOpen"
            >
              {{ notesOpen ? "Ukryj notatki" : "Notatki" }}
            </v-btn>

            <DialogProposeEditNode
              :entity="company"
              skip-redirect
              @submitted="submittedRevisionId = $event"
            >
              <template #activator="{ props: activatorProps }">
                <v-btn
                  v-bind="activatorProps"
                  variant="tonal"
                  color="warning"
                  :prepend-icon="mdiPencilOutline"
                >
                  Zaproponuj zmianę
                </v-btn>
              </template>
            </DialogProposeEditNode>
          </div>

          <v-alert
            v-if="submittedRevisionId && previewUrl"
            type="info"
            variant="tonal"
            density="compact"
            class="w-100"
          >
            Zaproponowano zmianę.
            <a
              :href="previewUrl"
              target="_blank"
              class="text-primary font-weight-bold"
            >
              Podgląd zmiany
              <v-icon :icon="mdiOpenInNew" size="small" />
            </a>
          </v-alert>
        </v-card-text>
      </v-col>

      <v-col v-if="notesOpen && canEditNotes" cols="12" md="6">
        <v-card-text class="pt-0 pt-md-4">
          <NoteEditor
            :key="nodeId"
            :node-id="nodeId"
            node-type="place"
            single-column
            class="mb-0"
          />
        </v-card-text>
      </v-col>
    </v-row>
  </v-card>
</template>

<script lang="ts" setup>
import {
  mdiNoteTextOutline,
  mdiOfficeBuildingOutline,
  mdiOpenInNew,
  mdiPencilOutline,
} from "@mdi/js";
import { computed, ref } from "vue";
import { useAuthState } from "~/composables/auth";
import { useNotes } from "~/composables/notes";
import { generateEntityUrl } from "~/composables/slugs";
import type { Company } from "~~/shared/model";

const props = defineProps<{
  company: Company;
  /** Region the company sits in, resolved by the caller from the owns edge. */
  location: string | undefined;
}>();

// The notes are the tallest thing on the card and most visitors only want to
// read the company's details, so they stay behind a button.
const notesOpen = ref(false);

const nodeId = computed(() => props.company.id ?? "");

const { user } = useAuthState();
const { userNote, otherNotes } = useNotes(nodeId);

// The editor renders nothing for a logged out visitor with no notes to read,
// so the button that opens it would only ever reveal an empty panel.
const canEditNotes = computed(
  () =>
    !!props.company.id &&
    (!!user.value || !!userNote.value || otherNotes.value.length > 0),
);

const submittedRevisionId = ref<string | undefined>(undefined);

const previewUrl = computed(() => {
  if (!props.company.id || !submittedRevisionId.value) return undefined;
  const base = generateEntityUrl("place", props.company.id, props.company.name);
  return `${base}?revisionId=${submittedRevisionId.value}`;
});
</script>
