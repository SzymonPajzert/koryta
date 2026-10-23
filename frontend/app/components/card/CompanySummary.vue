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
      <!-- On the page, the person header's row (EntityDetailsCard): centred,
           so the draft chip sits on the name's middle rather than its top, and
           wrapping, so a long name in capitals sends the chip to the next line
           rather than squeezing it. In a list `align-start`, so the icon sits
           on the name's first line rather than in the middle of a name that
           wraps to three. -->
      <div
        class="d-flex ga-2"
        :class="linkToPage ? 'align-start mr-auto' : 'flex-wrap align-center'"
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

      <!-- The facts line a person's page has too, in a list as on the page,
           and the chips after it. -->
      <EntityFacts :facts="facts" data-testid="company-facts">
        <span class="company-facts__chips">
          <ChipPublicCompany :company="company" show-unknown />
          <!-- The one caller whose chips are not inside another link. -->
          <ChipCompanyCategories :company="company" as-links />
        </span>
      </EntityFacts>

      <!-- The row of actions a person's page has too (entity/Actions.vue):
           „Zaproponuj zmianę”, then the reader's notes and the page's links,
           then the admin's tools. On the page it stands 16px under the facts,
           as a person's does. -->
      <EntityActions :class="{ 'mt-2': !linkToPage }">
        <DialogProposeEditNode
          :entity="company"
          skip-redirect
          @submitted="onSubmitted"
        >
          <template #activator="{ props: activatorProps }">
            <ButtonProposeChange v-bind="activatorProps" />
          </template>
        </DialogProposeEditNode>

        <!-- On the page, the way to the notes the page already shows further
             down. It used to open a second editor for them here, above the
             first. In a list, where the card is all there is of the company,
             it still opens them under the card. -->
        <ButtonIconAction
          v-if="canEditNotes && !linkToPage"
          :icon="mdiNoteTextOutline"
          label="Notatki"
          @click="goToNotes"
        />
        <ButtonIconAction
          v-else-if="canEditNotes"
          :icon="mdiNoteTextOutline"
          :label="notesOpen ? 'Ukryj notatki' : 'Notatki'"
          @click="notesOpen = !notesOpen"
        />

        <slot name="actions" />

        <template #tools>
          <!-- Where an admin reaches the node's revision list from. The
               person page has had this since the shortcut shipped; the
               company page had nothing, so the only way in was to type the
               node id into a url. -->
          <ButtonIconAction
            v-if="isAdmin && company.id"
            :icon="mdiHistory"
            label="Rewizje"
            :to="`/admin/rewizje/${company.id}`"
            data-testid="admin-revisions-link"
          />
          <!-- Only on the company's own page, where the card is the heading:
               send the people the pipelines know worked here to the site now.
               The datascience group's; the button gates itself on the claim. -->
          <JobsRequestButton
            v-if="company.id && !linkToPage"
            :node-id="company.id"
            :name="company.name"
            target="company"
          />
        </template>
      </EntityActions>

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
    <v-card-text v-if="linkToPage && notesOpen && canEditNotes" class="pt-0">
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
} from "@mdi/js";
import { computed, ref } from "vue";
import { useAuthState } from "~/composables/auth";
import { useNotes } from "~/composables/notes";
import { generateEntityUrl } from "~/composables/slugs";
import { companyIdentifiers } from "~~/shared/identifiers";
import type { Company } from "~~/shared/model";
import { isAllCapsName } from "~/utils/allCapsName";
import type { EntityFact } from "~/components/entity/Facts.vue";

const props = defineProps<{
  company: Company;
  /** Region the company sits in, resolved by the caller from the owns edge. */
  location: string | undefined;
  /** Turn the name into a link to the company's own page. Off by default: the
   * page renders this card as its own heading, and a heading that links to the
   * page you are already on is a dead end. */
  linkToPage?: boolean;
}>();

/** The line under the name, in the order a person's runs: what the company is
 * - its numbers in the registers, where it sits - then the pages about it
 * elsewhere. The Wikipedia link was found by the pipelines through the KRS
 * number the article gives, or added by a reader through „Zaproponuj zmianę”,
 * and it is named by the site it is on, as a person's is. */
const facts = computed<EntityFact[]>(() => [
  ...companyIdentifiers(props.company).map((identifier) => ({
    key: identifier.register,
    label: `${identifier.register}:`,
    value: identifier.value,
    url: identifier.url,
  })),
  ...(props.location
    ? [{ key: "location", label: "Lokalizacja:", value: props.location }]
    : []),
  ...(props.company.wikipedia
    ? [
        {
          key: "wikipedia",
          value: "Wikipedia",
          url: props.company.wikipedia,
          testid: "company-wikipedia",
        },
      ]
    : []),
]);

/** Whether the name is in capitals, which sets the page's title one step
 * down. */
const capsName = computed(() => isAllCapsName(props.company.name));

// In a list the notes are the tallest thing on the card and most visitors only
// want to read the company's details, so they stay behind a button.
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

/** The page's own „Notatki” section: the id place/DetailView.vue gives its
 * `NoteEditor`. */
const NOTES_SECTION_ID = "notatki";

/** Takes the reader to the notes section. Where it stops is the section's to
 * say: `PageSection` keeps its head clear of the sticky app bar with
 * `scroll-margin-top`, which `scrollIntoView` honours. Focus goes to its
 * heading too, as a reading position rather than a control, so a screen
 * reader reads on from there and the next Tab carries on from the notes
 * rather than from the top of the page. `preventScroll`: `scrollIntoView` is
 * what moves the page. */
function goToNotes() {
  const section = document.getElementById(NOTES_SECTION_ID);
  if (!section) return;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  section.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
  const heading = section.querySelector<HTMLElement>("h2");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

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

/* One group after the facts, so the chips wrap together. */
.company-facts__chips {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
