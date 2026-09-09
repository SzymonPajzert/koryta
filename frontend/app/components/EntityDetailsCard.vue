<template>
  <v-card v-if="type == 'person'" width="100%" variant="flat">
    <!-- `align-center`: without it the row is `align-items: stretch`, so the
         h2 stretched to the height of the control block on the right and kept
         its text at the top of that box, while PartyChip centres itself - two
         alignments in one row, and the chip reading as if it had slipped.

         `ga-2` rather than a margin on each child: two parties painted the
         same red - Nowa Lewica and SLD are the same party renamed - ran into
         one block with nothing between them. The gap is the same 8px `mr-2`
         was, which is why it comes off the h2 and off ChipDraftStatus here
         rather than being added on top of them. -->
    <v-card-title class="px-0 d-flex align-center ga-2">
      <h2 class="text-h5 font-weight-bold">
        {{ entity?.name }}
      </h2>
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
      <v-spacer />
      <!-- One row of controls, in the order they escalate: the two an admin
           gets, then the change anybody may propose, then how interesting the
           reader found the person. The admin pair sits first so that a reader
           without the claim is left with exactly the row that was there
           before - the vote pill stays on the right edge either way. -->
      <div class="d-none d-md-flex align-center ga-2">
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
        <DialogProposeEditNode
          v-if="entity && type === 'person'"
          :entity="entity"
        />
        <ButtonVoteNumber
          v-if="entity"
          :id="entity.id ?? ''"
          :key="entity.id ?? ''"
          category="interesting"
          show-label
        />
      </div>
    </v-card-title>
    <template #append> </template>
    <v-card-text class="px-0 pt-2">
      <!-- Above everything the page says about the person, because while the
           mark stands, everything it says is about two of them. Admin-only:
           the component gates itself. -->
      <AdminNeedsSplitBanner
        v-if="entity?.id"
        :node-id="entity.id"
        :needs-split="personEntity?.needs_split"
      />
      <CardPersonInfo :person="personEntity" class="mb-2" />
      {{ entity?.content }}
    </v-card-text>
  </v-card>

  <v-card v-if="type == 'place'" width="100%" variant="flat">
    <v-card-title class="headline px-0">
      <v-icon start :icon="mdiOfficeBuildingOutline" />
      <h2 class="text-h5 font-weight-bold d-inline">
        {{ entity?.name }}
      </h2>
    </v-card-title>
    <v-card-text class="px-0">
      <div v-if="identifiers.length > 0" class="text-caption mb-2">
        {{ identifiers.join(" · ") }}
      </div>
      {{ entity?.content }}
    </v-card-text>
  </v-card>

  <v-card v-if="type == 'article'" width="100%" variant="flat">
    <v-card-title class="headline px-0">
      <v-icon start :icon="mdiFileDocumentOutline" />
      <h2 class="text-h5 font-weight-bold d-inline">
        {{ entity?.name }}
      </h2>
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
    <v-card-title class="headline px-0">
      <v-icon start :icon="mdiMapMarkerRadiusOutline" />
      <h2 class="text-h5 font-weight-bold d-inline">
        {{ region?.name }}
      </h2>
    </v-card-title>
    <v-card-text class="px-0">
      {{ region?.content }}
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import {
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

const props = withDefaults(
  defineProps<{
    entity: Company | Person | Article | Region;
    type: string;
    /** Places to search the person in besides the ones the node carries.
     * A node fetched by id has no `elections` - only the table builds those,
     * from the subgraph it fetches - so the page derives them from its edges
     * and hands them down. */
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
</script>
