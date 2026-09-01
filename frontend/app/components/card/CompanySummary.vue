<template>
  <v-card variant="outlined">
    <v-card-text class="d-flex flex-wrap align-center ga-4">
      <div class="d-flex align-center ga-2 mr-auto">
        <v-icon :icon="mdiOfficeBuildingOutline" class="flex-shrink-0" />
        <!-- On the company's own page this card is the heading, so the name
             is plain text there; everywhere else it is the way through to
             the page. `link-plain` because a heading that is already the
             largest thing on the card does not also need to be blue. -->
        <NuxtLink
          v-if="linkToPage && pageUrl"
          :to="pageUrl"
          class="text-h6 text-wrap link-plain"
        >
          {{ company.name }}
          <v-icon :icon="mdiArrowRight" size="small" />
        </NuxtLink>
        <span v-else class="text-h6 text-wrap">{{ company.name }}</span>
      </div>

      <div class="d-flex flex-wrap align-center ga-4 text-body-2">
        <span v-for="identifier in identifiers" :key="identifier.register">
          <!-- The gap belongs to the label: Vue drops the whitespace
               between two tags, and "REGON:123456785" reads as one number.
               Non-breaking, so a register never wraps off its own value. -->
          <strong>{{ identifier.register }}:&nbsp;</strong>
          <!-- Underlined ink rather than `text-primary`. The theme's sage
               is #a8c79f, which is 1.85:1 on white - it reads as a
               disabled label, not a link. Sage is a fill colour here. -->
          <a
            v-if="identifier.url"
            :href="identifier.url"
            target="_blank"
            class="text-decoration-underline"
          >
            {{ identifier.value }}
            <v-icon :icon="mdiOpenInNew" size="small" />
          </a>
          <template v-else>{{ identifier.value }}</template>
        </span>
        <span v-if="location">
          <strong>Lokalizacja:</strong> {{ location }}
        </span>
        <ChipPublicCompany :company="company" show-unknown />
        <ChipCompanyCategories :company="company" />
      </div>

      <div class="d-flex flex-wrap ga-2">
        <v-btn
          v-if="canEditNotes"
          variant="outlined"
          :prepend-icon="mdiNoteTextOutline"
          @click="notesOpen = !notesOpen"
        >
          {{ notesOpen ? "Ukryj notatki" : "Notatki" }}
        </v-btn>

        <!-- Where an admin reaches the node's revision list from. The
             person page has had this since the shortcut shipped; the
             company page had nothing, so the only way in was to type the
             node id into a url. Not hidden below `md` the way the person
             page's is: this row already wraps. -->
        <v-btn
          v-if="isAdmin && company.id"
          variant="outlined"
          :prepend-icon="mdiHistory"
          :to="`/admin/rewizje/${company.id}`"
          data-testid="admin-revisions-link"
        >
          Rewizje
        </v-btn>

        <DialogProposeEditNode
          :entity="company"
          skip-redirect
          @submitted="onSubmitted"
        >
          <template #activator="{ props: activatorProps }">
            <!-- Outlined, not `tonal color="warning"`: amber ink on a
                 12%-amber wash is 2.4:1. The icon carries the colour. -->
            <v-btn
              v-bind="activatorProps"
              variant="outlined"
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
        data-testid="propose-confirmation"
      >
        {{
          wasDuplicate
            ? "Tę zmianę już zgłosiłeś - czeka na redakcję."
            : "Zaproponowano zmianę."
        }}
        <a
          :href="previewUrl"
          target="_blank"
          class="font-weight-bold text-decoration-underline"
        >
          Podgląd zmiany
          <v-icon :icon="mdiOpenInNew" size="small" />
        </a>
      </v-alert>
    </v-card-text>

    <!-- Under the details rather than beside them. Opening the notes used to
         split the card in two, which left each note in half a card - and on
         /eksploruj/tabela, where this card carries a whole filter's worth of
         companies, that half was too narrow to read a pasted quote in. Full
         width costs nothing: the notes are behind a button, so the card is one
         line until somebody asks for them. -->
    <v-card-text v-if="notesOpen && canEditNotes" class="pt-0">
      <NoteEditor
        :key="nodeId"
        :node-id="nodeId"
        node-type="place"
        single-column
        class="mb-0"
      />
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
import {
  mdiArrowRight,
  mdiHistory,
  mdiNoteTextOutline,
  mdiOfficeBuildingOutline,
  mdiOpenInNew,
  mdiPencilOutline,
} from "@mdi/js";
import { computed, ref } from "vue";
import { useAuthState } from "~/composables/auth";
import { useNotes } from "~/composables/notes";
import { generateEntityUrl } from "~/composables/slugs";
import { companyIdentifiers } from "~~/shared/identifiers";
import type { Company } from "~~/shared/model";

const props = defineProps<{
  company: Company;
  /** Region the company sits in, resolved by the caller from the owns edge. */
  location: string | undefined;
  /** Turn the name into a link to the company's own page. Off by default: the
   * page renders this card as its own heading, and a heading that links to the
   * page you are already on is a dead end. */
  linkToPage?: boolean;
}>();

const identifiers = computed(() => companyIdentifiers(props.company));

// The notes are the tallest thing on the card and most visitors only want to
// read the company's details, so they stay behind a button.
const notesOpen = ref(false);

const nodeId = computed(() => props.company.id ?? "");

const emit = defineEmits<{ (e: "submitted", id: string): void }>();

const { user, isAdmin } = useAuthState();
const { userNote, otherNotes } = useNotes(nodeId);

// The editor renders nothing for a logged out visitor with no notes to read,
// so the button that opens it would only ever reveal an empty panel.
const canEditNotes = computed(
  () =>
    !!props.company.id &&
    (!!user.value || !!userNote.value || otherNotes.value.length > 0),
);

const submittedRevisionId = ref<string | undefined>(undefined);
/** Whether the submission landed on a proposal this user had already made,
 * which is what `/api/revisions/create` answers now instead of filing a second
 * copy of it. Saying so is the difference between "it worked" and "it worked,
 * twice". */
const wasDuplicate = ref(false);

function onSubmitted(id: string, duplicate?: boolean) {
  submittedRevisionId.value = id;
  wasDuplicate.value = duplicate === true;
  // The page around this card lists what the reader has proposed, and it has
  // to hear about a proposal made from inside the card.
  emit("submitted", id);
}

/** The company's own page. A company that was never saved has no id and so no
 * page - it is rendered from a revision that nothing points at yet. */
const pageUrl = computed(() =>
  props.company.id
    ? generateEntityUrl("place", props.company.id, props.company.name)
    : undefined,
);

const previewUrl = computed(() =>
  pageUrl.value && submittedRevisionId.value
    ? `${pageUrl.value}?revisionId=${submittedRevisionId.value}`
    : undefined,
);
</script>
