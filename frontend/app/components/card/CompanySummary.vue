<template>
  <!-- In a list it is a card on the hairline. On the company's own page it is
       the page's header: unboxed and ruled off underneath, as a person's is. -->
  <v-card
    :variant="linkToPage ? 'outlined' : 'flat'"
    :rounded="linkToPage ? undefined : 0"
    :class="{ 'company-summary--page': !linkToPage }"
    data-testid="company-summary"
  >
    <!-- In a list, one wrapping row: the name, the facts, the buttons. On the
         page, three lines - the name, the facts, the buttons - and a column
         that does not wrap: a wrapping column sizes its line to the widest
         child's unwrapped width, and on a phone that is the button row. -->
    <v-card-text
      class="d-flex"
      :class="
        linkToPage
          ? 'flex-wrap align-center ga-4'
          : 'flex-column ga-2 px-0 pt-0 pb-6'
      "
    >
      <!-- `align-start`, so the icon sits on the name's first line rather than
           in the middle of a name that wraps to three. -->
      <div
        class="d-flex align-start ga-2 company-head"
        :class="{ 'mr-auto': linkToPage }"
      >
        <!-- Only in a list, where it says what kind of thing the row is. On
             the company's own page the name is the title and needs no badge
             to say it is a company. -->
        <v-icon
          v-if="linkToPage"
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

      <!-- On the page the facts are one quiet line: the labels in the grey
           of a label rather than bold, the facts divided by a middot, the
           chips after a wider gap. In a list they keep their bold labels. -->
      <div
        class="d-flex flex-wrap align-center text-body-2"
        :class="linkToPage ? 'ga-4' : 'company-facts--page'"
      >
        <span
          v-for="identifier in identifiers"
          :key="identifier.register"
          class="company-fact"
        >
          <!-- The gap belongs to the label: Vue drops the whitespace
               between two tags, and "REGON:123456785" reads as one number.
               Non-breaking, so a register never wraps off its own value. -->
          <span class="company-fact__label"
            >{{ identifier.register }}:&nbsp;</span
          >
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
        <span
          v-if="company.wikipedia"
          class="company-fact"
          data-testid="company-wikipedia"
        >
          <span class="company-fact__label">Wikipedia:&nbsp;</span>
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
        <span v-if="location" class="company-fact">
          <span class="company-fact__label">Lokalizacja:</span> {{ location }}
        </span>
        <!-- One group, so the page can set the chips off from the facts. In
             a list the group is not a box at all (`display: contents`) and
             the chips sit in the row's own gap, as they did. -->
        <span class="company-facts__chips">
          <ChipPublicCompany :company="company" show-unknown />
          <!-- The one caller whose chips are not inside another link. -->
          <ChipCompanyCategories :company="company" as-links />
        </span>
      </div>

      <!-- „Zaproponuj zmianę” first: it is the one action every signed in
           reader has, and behind an admin's three tools it was pushed off a
           phone's screen. Then the reader's own notes, the admin's tools, and
           whatever the page adds (its links to the graph and the table). On
           a phone the page's buttons other than the first are icons; each
           keeps its label in the DOM for a screen reader. -->
      <div
        class="d-flex flex-wrap ga-2"
        :class="{ 'company-actions--page mt-2': !linkToPage }"
      >
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
              class="company-actions__primary"
            >
              Zaproponuj zmianę
            </v-btn>
          </template>
        </DialogProposeEditNode>

        <v-btn
          v-if="canEditNotes"
          variant="tonal"
          :prepend-icon="mdiNoteTextOutline"
          @click="notesOpen = !notesOpen"
        >
          {{ notesOpen ? "Ukryj notatki" : "Notatki" }}
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

        <slot name="actions" />
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

/* The icon on the first line of a listed company's name. */
.company-head__icon {
  margin-top: 2px;
}

/* In a list the facts carry bold labels; on the page a label is the quiet
   grey of every other label, and the value after it is what reads. */
.company-fact__label {
  font-weight: 700;
}

.company-facts--page {
  gap: 6px 0;
}

.company-facts--page .company-fact__label {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-weight: 400;
}

/* A middot inside the fact it introduces, so it wraps with that fact rather
   than ending a line on its own. */
.company-facts--page .company-fact + .company-fact::before {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  content: "·";
  padding: 0 10px;
}

/* In a list the chips sit in the row's own gap, as they always have. */
.company-facts__chips {
  display: contents;
}

.company-facts--page .company-facts__chips {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* The wider gap after the last fact, as its trailing margin: a company with
   no register number and no seat starts its chips on the page's edge, and
   chips that wrap start their line there too. */
.company-facts--page .company-fact:has(+ .company-facts__chips) {
  margin-right: 16px;
}

/* A phone drops the middots and the facts wrap one to a line or two to a
   line, with the chips under them. */
@media (max-width: 599.98px) {
  .company-facts--page {
    gap: 4px 16px;
  }

  .company-facts--page .company-fact + .company-fact::before {
    content: none;
  }

  .company-facts--page .company-fact:has(+ .company-facts__chips) {
    margin-right: 0;
  }

  /* „Zaproponuj zmianę” keeps its words; the page's other buttons become
     40px squares, so the row fits a phone and the graph stays one tap away.
     The label is clipped rather than `display: none`, which would take the
     button's name away from a screen reader along with the pixels. An
     admin's extra tools wrap to a second row. */
  .company-actions--page :deep(.v-btn:not(.company-actions__primary)) {
    min-width: 40px;
    padding: 0;
    width: 40px;
  }

  .company-actions--page
    :deep(.v-btn:not(.company-actions__primary) > .v-btn__prepend) {
    margin: 0;
  }

  .company-actions--page
    :deep(.v-btn:not(.company-actions__primary) > .v-btn__content) {
    clip: rect(0, 0, 0, 0);
    height: 1px;
    margin: -1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
}
</style>
