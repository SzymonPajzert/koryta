<template>
  <!-- The site's section head, as over every other section of an entity
       page: on the heading's baseline, 8px over the list. -->
  <PageSection v-if="edges.length > 0 || canAdd" :title="title">
    <!-- Still the sage text it was, unlike the history's neutral „Dodaj”:
         a colour change, and colours wait for the palette. -->
    <template v-if="canAdd" #actions>
      <v-btn
        variant="text"
        size="small"
        color="primary"
        :prepend-icon="mdiPlus"
        :data-testid="`add-relation-${addTestid}`"
        @click="emit('add')"
      >
        Dodaj
      </v-btn>
    </template>
    <!-- A ruled list on the hairline, not a card lifted on a shadow; edge to
         edge on a phone, like the relation history. Only entity pages list
         these, at their full width. -->
    <v-card v-if="edges.length > 0" variant="flat" border class="k-bleed-xs">
      <v-list density="compact">
        <v-list-item
          v-for="edge in edgesSorted"
          :key="edge.richNode.id"
          :to="nodeLinkUrl(edge.richNode)"
          :prepend-icon="entityIcon(edge.richNode.type)"
        >
          <!-- Wrapped rather than cut: a registry name runs to sixty
               characters, and on a phone the ellipsis took the city with it.
               Bold, as an entity's name is in the history's rows and every
               other list of them; how many people it holds stays regular. -->
          <v-list-item-title class="text-wrap font-weight-bold">
            {{ edge.richNode.name }}
            <span
              v-if="getPeopleCount(edge) > 0"
              class="font-weight-regular text-medium-emphasis"
            >
              ({{ getPeopleCount(edge) }})
            </span>
          </v-list-item-title>

          <!-- Which sector the institution belongs to. The rows here are a
               company's owners and subsidiaries, or a region's institutions,
               and the sector is what tells a reader apart two registry names
               that differ by one word. Draws nothing for a row that is not a
               company. -->
          <ChipCompanyCategories :company="edgeCompany(edge)" />
          <!-- Whether the relation itself is live, and an admin's way to make
               it so. Beside the sector chip rather than in the append slot: the
               append slot is where the controls that take something away
               live. -->
          <ChipEdgeDraftStatus
            :edge-id="edge.id"
            :published="edge.visibility"
            :publishable="edgeIsPublishable(edge, subjectPublished)"
            @published="emit('published')"
          />

          <!-- Admins only. The row is a link to the other end, so this stops
               the click rather than letting it navigate away. -->
          <template v-if="edge.id && canRemove" #append>
            <v-btn
              variant="text"
              size="small"
              color="error"
              title="Usuń powiązanie"
              :icon="mdiTrashCanOutline"
              :data-testid="`edge-remove-${edge.id}`"
              @click.stop.prevent="emit('remove', edge)"
            />
          </template>
        </v-list-item>
      </v-list>
    </v-card>
  </PageSection>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiPlus, mdiTrashCanOutline } from "@mdi/js";
import { entityIcon } from "~/utils/entityIcon";
import {
  edgeCompany,
  edgeIsPublishable,
  type EdgeNode,
} from "~~/app/composables/edges";
import { nodeLinkUrl } from "~/composables/slugs";

const { edges, title, canRemove, subjectPublished } = defineProps<{
  title: string;
  edges: EdgeNode[];
  /** Whether this section offers adding a relation of its own kind. */
  canAdd?: boolean;
  /** Suffix for the add button's test hook, since a page renders several of
   * these and they would otherwise be indistinguishable. */
  addTestid?: string;
  /** Whether each row offers taking the relation off the graph outright, which
   * is an administrator's decision and nobody else's. */
  canRemove?: boolean;
  /** Whether the page these relations hang off is itself published. See the
   * same prop on `CardEmploymentHistory`. */
  subjectPublished?: boolean;
}>();

const emit = defineEmits<{
  add: [];
  remove: [edge: EdgeNode];
  /** A row went live; the caller refetches if it draws the relation twice. */
  published: [];
}>();

function getPeopleCount(edge: EdgeNode) {
  const stats = edge.richNode.stats as
    | {
        nodeGroupSize?: number;
        people?: number;
      }
    | undefined;
  return stats?.nodeGroupSize ?? stats?.people ?? 0;
}

const edgesSorted = computed(() => {
  return [...edges].sort((a, b) => {
    const countDiff = getPeopleCount(b) - getPeopleCount(a);
    if (countDiff !== 0) return countDiff;
    return (a.richNode.name || "").localeCompare(b.richNode.name || "");
  });
});
</script>
