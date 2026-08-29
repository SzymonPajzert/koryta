<template>
  <v-navigation-drawer
    v-model="open"
    :location="mdAndUp ? 'end' : 'bottom'"
    :rounded="mdAndUp ? undefined : 't-xl'"
    temporary
    :width="drawerSize"
  >
    <v-card-item>
      <template #append>
        <v-btn
          density="compact"
          icon="$close"
          variant="text"
          @click="open = false"
        />
      </template>
    </v-card-item>

    <CardExplorePerson
      v-if="!node || person"
      :key="node?.id"
      :person="person"
      :region="region"
      :company="company"
      :work-locations="workLocations"
    />
    <v-card v-else class="ma-2" flat>
      <v-card-title class="text-wrap text-h5">
        <!-- The drawer's title for every node that is not a person, and it
             was `text-decoration-none text-primary`: the brand's pale sage on
             the drawer's white is 1.85:1, against the 3:1 that `text-h5`'s
             24px has to clear. The palette's sage ink is 6.43:1 there, and the
             underline is back with it, because a reader who cannot tell sage
             from grey has nothing else saying the title opens a page. -->
        <NuxtLink
          :to="generateEntityUrl(node.type, node.id, node.name)"
          class="text-ink-sage"
          target="_blank"
        >
          {{ node.name }}
        </NuxtLink>
      </v-card-title>
    </v-card>

    <ChartPersonLocations
      v-if="person && mapLocations.length"
      :key="`map-${person.id}`"
      :locations="mapLocations"
    />

    <div v-if="node" class="pa-4 pt-0">
      <ExploreProposeChange v-if="person" :key="person.id" :person="person">
        <ButtonVoteNumber
          :id="person.id"
          :key="person.id"
          category="interesting"
          show-label
        />
        <!-- The same shortcut the person's own page carries, in the row that
             already holds what an admin may do here. Reaching a person from
             the table and then having to open their page to publish them was
             the long way round to the one screen that publishes. The same
             square outlined button as on that page, too: the small grey tonal
             one this used to be was the only control of its kind in the
             drawer, and it read as disabled next to the vote pill. -->
        <ButtonIconAction
          v-if="isAdmin"
          :icon="mdiHistory"
          label="Rewizje"
          :to="`/admin/rewizje/${person.id}`"
          data-testid="drawer-admin-revisions-link"
        />
      </ExploreProposeChange>

      <NoteEditor :key="node.id" :node-id="node.id" :node-type="node.type" />
      <v-divider class="my-4" />
      <CardEmploymentHistory
        :edges="edges"
        :can-correct="canEditRelations"
        :can-remove="canRemoveRelations"
        @edit="openEdit"
        @remove="openRemove"
      />

      <DialogEditRelationHost
        v-model="editOpen"
        v-model:outcome="editedOutcome"
        :edge="editEdge"
        :label="editLabel"
        :can-apply="canApplyEdits"
        @saved="onEdgeEdited"
      />

      <DialogRemoveEdgeHost
        v-model="removeOpen"
        v-model:shown="removedShown"
        :edge="removeEdge"
        :label="removeLabel"
        @removed="onEdgeRemoved()"
      />
    </div>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiHistory } from "@mdi/js";
import { useDisplay } from "vuetify";
import { generateEntityUrl } from "~/composables/slugs";
import type { EdgeNode } from "~/composables/edges";
import type { NodeMaybeRich, PersonRich } from "~~/shared/model";
import type { PlaceRegion } from "~/utils/companyLocation";
import { usePersonPlaces } from "~/composables/personPlaces";
import { useEdgeRemoval } from "~/composables/edgeRemoval";
import { useEdgeEditing } from "~/composables/edgeEditing";

const props = withDefaults(
  defineProps<{
    /** Any node. The person-specific cards only appear for a person; every
     * other kind gets the plain header. */
    node?: NodeMaybeRich;
    /** Edges around `node`, which the caller fetches - `useEdges` suspends,
     * and doing that in here would suspend the page that hosts the drawer. */
    edges?: EdgeNode[];
    /** Context for the search suggestions, where the caller has any. */
    region?: [string, string];
    company?: [string, string];
    /** The region each company node id sits in, from `useCompanyLocations`.
     * Turns the employers in `edges` into the cities to search the person in
     * and the shapes to colour on the map - the drawer works them out here
     * rather than reading `person.workLocations`, so that a node opened
     * straight from an id, as the note queues do, is covered too. */
    companyRegions?: Record<string, PlaceRegion>;
  }>(),
  {
    node: undefined,
    edges: () => [],
    region: undefined,
    company: undefined,
    companyRegions: undefined,
  },
);

const emit = defineEmits<{
  /** One of `edges` was corrected or taken off the graph. The drawer does not
   * own the fetch - `edges` is the caller's - so the caller re-reads it. */
  changed: [];
}>();

/** Removing a relation from the drawer, which is how /eksploruj/tabela and
 * /admin/notatki read one node's relations. See
 * `.agent/skills/relation-surfaces.md`. */
const {
  canRemove: canRemoveRelations,
  removeOpen,
  removeEdge,
  removedShown,
  removeLabel,
  openRemove,
  onEdgeRemoved,
} = useEdgeRemoval({
  subjectName: () => props.node?.name,
  refresh: () => emit("changed"),
});

/** Correcting one, from the same rows. The drawer and /eksploruj/nowe are the
 * same job in two shapes, so a capability on one belongs on the other - see
 * `.agent/skills/relation-surfaces.md`. */
const {
  canEdit: canEditRelations,
  canApply: canApplyEdits,
  editOpen,
  editEdge,
  editedOutcome,
  editLabel,
  openEdit,
  onEdgeEdited,
} = useEdgeEditing({
  subjectName: () => props.node?.name,
  refresh: () => emit("changed"),
});

const open = defineModel<boolean>({ required: true });

const { isAdmin } = useAuthState();

const { mdAndUp, height } = useDisplay();

/** On a phone the drawer comes up from the bottom rather than the side: 280px
 * of a 360px screen is too narrow for the map and the employment table, and it
 * leaves a sliver of the page behind it that invites a mis-tap. `width` is the
 * cross axis, so under `location="bottom"` it is the height - and it has to be
 * a number of pixels, because Vuetify puts it straight into the transform that
 * slides the drawer off screen. */
const drawerSize = computed(() =>
  mdAndUp.value ? 600 : Math.round(height.value * 0.85),
);

const person = computed(() =>
  props.node?.type === "person" ? (props.node as PersonRich) : undefined,
);

const { workLocations, mapLocations } = usePersonPlaces(
  person,
  () => props.edges,
  () => props.companyRegions,
);
</script>
