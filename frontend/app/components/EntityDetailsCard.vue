<template>
  <!-- Unboxed: the page's header, ruled off from what follows by the one
       hairline rather than framed. Three lines, the way a company's page
       opens: the name, one line of facts, one row of controls - then the bio. -->
  <header v-if="type == 'person'" class="entity-header">
    <!-- `align-center`: PartyChip centres itself, and a name stretched to
         the height of the row kept its text at the top of that box - two
         alignments in one row, and the chip reading as if it had slipped.

         `ga-2` rather than a margin on each child: two parties painted the
         same red - Nowa Lewica and SLD are the same party renamed - ran into
         one block with nothing between them.

         `flex-wrap`: whatever does not fit goes to the next line whole, and a
         name too long for the line breaks between its words. On one line the
         chips - `overflow: hidden`, so free to shrink - took all the squeeze,
         and on a 393px phone „Wioletta Paprocka-Ślusarska” left her „PO” 13px
         of its 40. -->
    <!-- The name is the page's h1: the one title every page opens with, at
         the type system's title size (assets/css/type.css). The parties
         beside it are drawn at the title's chip size, set below. -->
    <div class="d-flex flex-wrap align-center ga-2 entity-head">
      <h1>
        {{ entity?.name }}
      </h1>
      <!-- Before the parties, because it is about the page rather than about
           the person on it: whoever is reading this is the only kind of reader
           who can be here at all while it shows. -->
      <ChipDraftStatus
        :published="entity?.published"
        :node-id="entity?.id"
        :node-name="entity?.name"
        @published="emit('published')"
      />
      <PartyChip
        v-for="party in personEntity?.parties"
        :key="party"
        :party="party"
      />
    </div>

    <!-- Above everything the page says about the person, because while the
         mark stands, everything it says is about two of them. Admin-only:
         the component gates itself. -->
    <AdminNeedsSplitBanner
      v-if="entity?.id"
      :node-id="entity.id"
      :needs-split="personEntity?.needs_split"
      class="mt-3"
    />

    <CardPersonInfo :person="personEntity" inline class="mt-2" />

    <!-- One row of controls, on every screen: on a phone the row used to be
         hidden, so the change anybody may propose was not on the page at all.
         The reader's two first - „Zaproponuj zmianę” with its words, the one
         action every signed in reader has, then how interesting they found
         the person - and then the tools only some readers get, as icons in
         one group that wraps as a whole: on a phone an admin's five tools
         make the row's second line rather than splitting round the vote. -->
    <div class="entity-actions" data-testid="person-actions">
      <DialogProposeEditNode v-if="entity" :entity="entity">
        <template #activator="{ props: activatorProps }">
          <!-- The same button on every entity page (button/ProposeChange). -->
          <ButtonProposeChange
            v-bind="activatorProps"
            class="entity-actions__propose"
            data-testid="person-propose-change"
          />
        </template>
      </DialogProposeEditNode>
      <ButtonVoteNumber
        v-if="entity"
        :id="entity.id ?? ''"
        :key="entity.id ?? ''"
        category="interesting"
        show-label
      />
      <div class="entity-actions__tools">
        <template v-if="isAdmin && entity?.id">
          <!-- The table's "Eksploruj" icon, for the reader who arrived on the
               page directly: the same rejestr.io, Wikipedia and Google queries
               it offers, so checking somebody found through search costs what
               checking somebody found through /eksploruj does.
               A menu rather than the table's straight-to-eight-tabs button.
               On a row it is a scanning action - the reader has not looked at
               this person yet and wants everything at once - while on the
               person's own page they have just read the page and usually know
               which one lookup is missing. -->
          <ButtonPersonSearchMenu
            :person="richPerson"
            :extra-locations="extraLocations"
            data-testid="admin-explore-link"
          />
          <!-- Admins reach a person from a list - /eksploruj/tabela, a search
               result - and the revision list, which is where a page gets
               published, was reachable only by typing the node id into a
               url. -->
          <ButtonIconAction
            :icon="mdiHistory"
            label="Rewizje"
            :to="`/admin/rewizje/${entity.id}`"
            data-testid="admin-revisions-link"
          />
          <!-- The two verdicts about who this page is: a second copy of
               somebody, or two people who were never told apart. They sit with
               the other admin controls because that is where an admin already
               looks when a page reads wrong. -->
          <AdminNodeIdentityActions
            :node-id="entity.id"
            :node-name="entity.name"
            node-type="person"
          />
        </template>
        <!-- The datascience group's, not only the admins': send what the
             pipelines know about this person to this page now, rather than
             whenever a night reaches them. Gates itself on the claim. -->
        <JobsRequestButton
          v-if="entity?.id"
          :node-id="entity.id"
          :name="entity.name"
          target="person"
          variant="icon"
        />
      </div>
    </div>

    <!-- Reading text, at a reading measure. On a phone a long bio shows
         four lines, ending in the clamp's ellipsis, and the rest is one tap
         away: hidden, not cut, so a screen reader and a search engine still
         get all of it. Wider screens show it whole. Whether it folds is
         decided by length rather than measured, so the server's html
         already has the button and nothing moves when the page hydrates. -->
    <p
      v-if="entity?.content"
      :id="bioId"
      ref="bio"
      class="person-bio"
      :class="{ 'person-bio--folded': bioLong && !bioOpen }"
      :tabindex="bioLong ? -1 : undefined"
      data-testid="person-bio"
    >
      {{ nbsp(entity.content) }}
    </p>
    <!-- A button that goes once the bio is open, rather than a toggle that
         stays as „Pokaż mniej” (Szymon, 2026-10-15). It is only ever shown
         collapsed, so `aria-expanded` stays false: it still tells a screen
         reader the button opens something. -->
    <v-btn
      v-if="bioLong && !bioOpen"
      variant="text"
      class="person-bio__more px-2"
      :append-icon="mdiChevronDown"
      aria-expanded="false"
      :aria-controls="bioId"
      data-testid="person-bio-more"
      @click="openBio"
    >
      Pokaż więcej
    </v-btn>
  </header>

  <v-card v-if="type == 'place'" width="100%" variant="flat">
    <v-card-title class="headline px-0 text-wrap">
      <v-icon start :icon="mdiOfficeBuildingOutline" />
      <h1 class="d-inline">
        {{ entity?.name }}
      </h1>
    </v-card-title>
    <v-card-text class="px-0">
      <div v-if="identifiers.length > 0" class="text-caption mb-2">
        {{ identifiers.join(" · ") }}
      </div>
      {{ entity?.content }}
    </v-card-text>
  </v-card>

  <v-card v-if="type == 'article'" width="100%" variant="flat">
    <v-card-title class="headline px-0 text-wrap">
      <v-icon start :icon="mdiFileDocumentOutline" />
      <h1 class="d-inline">
        {{ entity?.name }}
      </h1>
    </v-card-title>
    <v-card-text class="px-0">
      <div v-if="article?.sourceURL" class="text-caption mb-2">
        URL:
        <a :href="article?.sourceURL" target="_blank">{{
          article?.sourceURL
        }}</a>
      </div>
      {{ entity?.content }}
    </v-card-text>
  </v-card>

  <v-card v-if="type == 'region'" width="100%" variant="flat">
    <v-card-title class="headline px-0 text-wrap">
      <v-icon start :icon="mdiMapMarkerRadiusOutline" />
      <h1 class="d-inline">
        {{ region?.name }}
      </h1>
    </v-card-title>
    <v-card-text class="px-0">
      {{ region?.content }}
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import {
  mdiChevronDown,
  mdiFileDocumentOutline,
  mdiHistory,
  mdiMapMarkerRadiusOutline,
  mdiOfficeBuildingOutline,
} from "@mdi/js";
import type {
  Person,
  Company,
  Article,
  Region,
  PersonRich,
} from "~~/shared/model";
import { companyIdentifiers } from "~~/shared/identifiers";
import { nbsp } from "~/utils/nbsp";

const props = withDefaults(
  defineProps<{
    entity: Company | Person | Article | Region;
    type: string;
    /** Places to search the person in besides the ones the node carries.
     * A node fetched by id has no `elections` or `workLocations` - only the
     * table builds those, from what it fetches - so the page derives both
     * from its edges and hands them down. */
    extraLocations?: string[];
  }>(),
  { extraLocations: undefined },
);

/** The page went live from the badge above. The card holds no data of its own
 * - the entity is handed to it - so the only thing it can do is say so. */
const emit = defineEmits<{ published: [] }>();

const { isAdmin } = useAuthState();

const company = computed(() =>
  props.type === "place" ? (props.entity as Company) : undefined,
);

const identifiers = computed(() =>
  companyIdentifiers(company.value ?? {}).map(
    ({ register, value }) => `${register}: ${value}`,
  ),
);
const article = computed(() =>
  props.type === "article" ? (props.entity as Article) : undefined,
);
const region = computed(() =>
  props.type === "region" ? (props.entity as Region) : undefined,
);

const personEntity = computed(() =>
  props.type === "person" ? (props.entity as Person) : undefined,
);

/** The node as the search menu wants it. A page loads a plain `Person`, whose
 * extra rich fields are simply absent - `usePersonSearch` reads them
 * optionally, and `extraLocations` covers the one that matters here. */
const richPerson = computed(() => personEntity.value as PersonRich | undefined);

/** The shortest bio that folds on a phone. Measured rather than guessed: the
 * 890 published bios of the 2026-10-15 export, set in the bio's own CSS and
 * Roboto at every phone width from 320px to 440px.
 *
 * A fold pays from the sixth line on: four lines and the button row are 139px,
 * six lines 149px, but five lines only 124px. On a 375px phone every bio of
 * 214 characters or more takes six lines or more, and none under it does, so
 * there the cut is clean. A wider phone fits more on a line, so there some
 * bios of 214 or more take five and fold anyway (16 of the 70 at 412px, 20 at
 * 430px), and on a 360px phone 7 six-line bios of 200-213 stay whole. But at
 * no phone width does a bio of 214 or more fit in four lines (the longest that
 * does, at 440px, has 209), so no button has nothing behind it. Wider than a
 * phone that stops holding - at 449px a 218-character bio fits in four, at
 * 480px 10 of the 70 do - so the fold ends with the widest phone, a 440px
 * iPhone Pro Max. */
const BIO_FOLD_MIN_LENGTH = 214;

const bioLong = computed(
  () => (props.entity.content?.length ?? 0) >= BIO_FOLD_MIN_LENGTH,
);
const bioOpen = ref(false);
const bioId = useId();
const bio = useTemplateRef<HTMLElement>("bio");

/** Opening the bio takes the focused button away, which would drop a keyboard
 * or screen-reader user back to the top of the page. Focus goes to the bio
 * instead: a screen reader reads on from its start, and the next Tab carries
 * on from where the button was. `preventScroll`: the bio opens downwards from
 * where the reader already is, so nothing needs to move. */
async function openBio() {
  bioOpen.value = true;
  await nextTick();
  bio.value?.focus({ preventScroll: true });
}
</script>

<style scoped>
.entity-header {
  border-bottom: 1px solid var(--k-line);
  padding-bottom: 24px;
}

/* The controls under the facts: a row that wraps, the tools as one group. */
.entity-actions,
.entity-actions__tools {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.entity-actions {
  margin-top: 16px;
}

.entity-actions__tools {
  flex-wrap: nowrap;
}

.entity-actions__tools:empty {
  display: none;
}

/* The vote's arrows are 32px buttons, sized for the table's rows. In the
   header on a phone they are the reader's to tap: 40px, the pill with them,
   and „Zaproponuj zmianę” beside it at the same 40px. */
@media (max-width: 599.98px) {
  .entity-actions :deep(.v-btn--icon.v-btn--size-x-small) {
    height: 40px;
    width: 40px;
  }

  .entity-actions__propose {
    --v-btn-height: 40px;
  }
}

/* The parties beside the h1 are set one step up from a list's 12px. */
.entity-head {
  --k-party-chip-size: 16px;
}

.person-bio {
  font-size: 1rem;
  line-height: 1.55;
  margin: 16px 0 0;
  max-width: 72ch;
}

/* Focus only lands here from „Pokaż więcej”, as a reading position, not a
   control: a ring round the whole bio would frame it like something to press.
   The text opening where the button was shows where the reader is. */
.person-bio:focus {
  outline: none;
}

/* Four lines and the clamp's ellipsis: the soft end, in the text's own ink.
   Phones only, up to the widest at 440px rather than Vuetify's 600: the
   length the fold is decided by holds that far, and past it a folded bio can
   fit in four lines (BIO_FOLD_MIN_LENGTH). The button goes at the same width. */
@media (max-width: 440.98px) {
  .person-bio--folded {
    -webkit-box-orient: vertical;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    overflow: hidden;
  }
}

@media (min-width: 441px) {
  .person-bio__more {
    display: none;
  }
}

/* A neutral text button in ink, its chevron in the label's ink too. Its
   label lines up with the text's left edge; the 8px of padding that keeps the
   press tint off the label hangs into the gutter instead. */
.person-bio__more {
  margin-inline-start: -8px;
  margin-top: 4px;
}

/* Taps reach 4px past the 36px button on either side: a 44px target,
   without a taller row under the bio. */
.person-bio__more::before {
  content: "";
  inset: -4px 0;
  position: absolute;
}
</style>
