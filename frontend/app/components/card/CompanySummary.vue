<template>
  <!-- In a list it is a card on the hairline. On the company's own page it is
       the page's header: unboxed and ruled off underneath, as a person's is. -->
  <v-card
    :variant="linkToPage ? 'outlined' : 'flat'"
    :rounded="linkToPage ? undefined : 0"
    :class="{ 'company-summary--page': !linkToPage }"
    data-testid="company-summary"
  >
    <v-card-text
      class="d-flex flex-wrap align-center ga-4"
      :class="{ 'px-0 pt-0 pb-6': !linkToPage }"
    >
      <!-- `align-start`, so the icon sits on the name's first line rather than
           in the middle of a name that wraps to three. -->
      <div
        class="d-flex align-start ga-2 mr-auto company-head"
        :class="{
          'company-head--page': !linkToPage,
          'company-head--caps': capsName,
        }"
      >
        <v-icon
          :icon="mdiOfficeBuildingOutline"
          class="flex-shrink-0 company-head__icon"
        />
        <!-- On the company's own page this card is the heading, so the name
             is the page's h1 there; everywhere else it is the way through to
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
        <!-- A name in capitals, which is how the register writes most of
             them, is set one size down: capitals carry about a third more
             mass than mixed case. -->
        <h1 v-else-if="!linkToPage" :class="{ 'k-title--caps': capsName }">
          {{ company.name }}
        </h1>
        <span v-else class="text-h6 text-wrap">{{ company.name }}</span>
        <!-- Only where this card is the page's own heading. Linked, it is one
             of a list of companies on somebody else's page, and a badge about
             the state of a page you are not on belongs on the row that leads
             there rather than on every card in the list. -->
        <ChipDraftStatus
          v-if="!linkToPage"
          :published="company.published"
          :node-id="company.id"
          :node-name="company.name"
          @published="emit('published')"
        />
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
        <!-- Beside the registers, the way a person's page carries the link:
             found by the pipelines through the KRS number the article gives,
             or added by a reader through the form below. -->
        <span v-if="company.wikipedia" data-testid="company-wikipedia">
          <strong>Wikipedia:&nbsp;</strong>
          <!-- The span keeps the text from starting with a space: Vue keeps
               the leading whitespace of a text node that begins on a line of
               its own, and on an underlined link it shows. -->
          <a
            :href="company.wikipedia"
            target="_blank"
            class="text-decoration-underline"
          >
            <span>Artykuł z Wikipedii</span>
            <v-icon :icon="mdiOpenInNew" size="small" class="ml-1" />
          </a>
        </span>
        <span v-if="location">
          <strong>Lokalizacja:</strong> {{ location }}
        </span>
        <ChipPublicCompany :company="company" show-unknown />
        <!-- The one caller whose chips are not inside another link. -->
        <ChipCompanyCategories :company="company" as-links />
      </div>

      <!-- Controls, not content - kept out of search snippets. -->
      <div class="d-flex flex-wrap ga-2" data-nosnippet>
        <v-btn
          v-if="canEditNotes"
          variant="tonal"
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
          variant="tonal"
          :prepend-icon="mdiHistory"
          :to="`/admin/rewizje/${company.id}`"
          data-testid="admin-revisions-link"
        >
          Rewizje
        </v-btn>

        <!-- Only on the company's own page, where the card is the heading:
             send the people the pipelines know worked here to the site now.
             The datascience group's; the button gates itself on the claim. -->
        <JobsRequestButton
          v-if="company.id && !linkToPage"
          :node-id="company.id"
          :name="company.name"
          target="company"
        />

        <DialogProposeEditNode
          :entity="company"
          skip-redirect
          @submitted="onSubmitted"
        >
          <template #activator="{ props: activatorProps }">
            <!-- Tonal in the neutral control tint, not `color="warning"`:
                 amber ink on a 12%-amber wash is 2.4:1. -->
            <v-btn
              v-bind="activatorProps"
              variant="tonal"
              :prepend-icon="mdiPencilOutline"
            >
              Zaproponuj zmianę
            </v-btn>
          </template>
        </DialogProposeEditNode>
      </div>

      <!-- `flex-1-1-100`, not `w-100`: Vuetify gives `.v-alert` `flex: 1 1`,
           so its flex basis is 0 whatever `width` says, and `overflow: hidden`
           makes it a scroll container - which zeroes its automatic minimum
           size too. Both together mean it never breaks onto its own line: it
           stayed on the buttons' row and grew into whatever was left of it,
           which was one word wide, so "Zaproponowano zmianę" wrapped four
           characters at a time and stretched the card. A 100% basis is what
           actually makes it wrap. -->
      <v-alert
        v-if="submittedRevisionId && previewUrl"
        type="info"
        variant="tonal"
        density="compact"
        class="flex-1-1-100"
        data-testid="propose-confirmation"
      >
        {{
          wasDuplicate
            ? "Tę zmianę już zgłosiłeś – czeka na redakcję."
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
    <v-card-text
      v-if="notesOpen && canEditNotes"
      class="pt-0"
      :class="{ 'px-0': !linkToPage }"
    >
      <NoteEditor :key="nodeId" :node-id="nodeId" node-type="place" />
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
import { isAllCapsName } from "~/utils/allCapsName";

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

/** Whether the name is in capitals, which sets the page's title one step
 * down - and moves the icon beside it to that line. */
const capsName = computed(() => isAllCapsName(props.company.name));

// The notes are the tallest thing on the card and most visitors only want to
// read the company's details, so they stay behind a button.
const notesOpen = ref(false);

const nodeId = computed(() => props.company.id ?? "");

const emit = defineEmits<{
  (e: "submitted", id: string): void;
  /** The page went live from the badge beside the name; the page around this
   * card holds the response the badge read and has to refetch it. */
  (e: "published"): void;
}>();

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

<style scoped>
.company-summary--page {
  background: transparent;
  border-bottom: 1px solid var(--k-line);
}

/* The icon on the first line of the name. */
.company-head__icon {
  margin-top: 2px;
}

/* On the page the name is the h1, and the icon is centred on its first
   line: half of what the line has over the icon, whose height is its own
   font size (`1em` here). The title's size and line height are the type
   system's (assets/css/type.css) - 40 at 1.1 in mixed case, 32 at 1.15 in
   capitals, 28 and 24 on a phone - so the icon follows it at either size. */
.company-head--page .company-head__icon {
  margin-top: calc((var(--k-title-size) * 1.1 - 1em) / 2);
}

.company-head--page.company-head--caps .company-head__icon {
  margin-top: calc((var(--k-title-caps-size) * 1.15 - 1em) / 2);
}

/* On a phone the icon floats, so only the name's first line gives up its
   width and the rest runs the full row. The head takes the whole row: a
   block holding a float measures only its widest child, and a short name
   would wrap beside the icon. */
@media (max-width: 599.98px) {
  .company-head--page {
    display: block !important;
    flex: 1 1 100%;
    width: 100%;
  }

  .company-head--page .company-head__icon {
    float: left;
    margin: calc((var(--k-title-size-phone) * 1.1 - 1em) / 2) 8px 0 0;
  }

  .company-head--page.company-head--caps .company-head__icon {
    margin-top: calc((var(--k-title-caps-size-phone) * 1.15 - 1em) / 2);
  }
}
</style>
