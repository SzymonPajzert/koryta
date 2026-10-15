<template>
  <div class="d-flex align-center ga-2">
    <!-- What the claim rests on. The row itself is a link to the other end,
         so this stops the click rather than letting it navigate away from the
         relation it is about. -->
    <v-btn
      v-if="edge.id && (sources > 0 || canCite)"
      variant="text"
      size="small"
      class="px-1"
      :color="sources > 0 ? undefined : 'medium-emphasis'"
      :title="
        sources > 0 ? 'Pokaż źródła powiązania' : 'Dodaj źródło powiązania'
      "
      :data-testid="`edge-sources-open-${edge.id}`"
      @click.stop.prevent="emit('sources', edge)"
    >
      <v-icon
        :icon="
          sources > 0
            ? mdiFileDocumentMultipleOutline
            : mdiFileDocumentPlusOutline
        "
        size="small"
      />
      <span v-if="sources > 0" class="ml-1 text-caption">
        {{ sources }}
      </span>
    </v-btn>
    <!-- The room the sources button takes on the rows that have one, kept on
         the rows that do not, so a column of dates beside these buttons lines
         up down the list. A small button's minimum width (Vuetify's 50px). -->
    <span
      v-else-if="reserveSources"
      class="row-actions__gap"
      aria-hidden="true"
    />
    <!-- Correcting what the row says. Between the sources and the bin because
         that is the order of how much a mistake costs - cite it, fix it,
         remove it - and because this is the control the row is most often
         clicked for: a job title read off the register is right about the
         company and wrong about the job more often than it is wrong about
         either end. Stops the click like its neighbours; the row is a link to
         the other end. -->
    <v-btn
      v-if="edge.id && canCorrect"
      variant="text"
      size="small"
      class="px-1"
      color="ink-warning"
      title="Popraw powiązanie"
      :icon="mdiPencilOutline"
      :data-testid="`edge-edit-${edge.id}`"
      @click.stop.prevent="emit('edit', edge)"
    />
    <!-- Admins only, and last in the row: this is the one control here that
         takes something away. Stops the click for the same reason the sources
         button does - the row is a link to the other end. -->
    <v-btn
      v-if="edge.id && canRemove"
      variant="text"
      size="small"
      color="error"
      class="px-1"
      title="Usuń powiązanie"
      :icon="mdiTrashCanOutline"
      :data-testid="`edge-remove-${edge.id}`"
      @click.stop.prevent="emit('remove', edge)"
    />
  </div>
</template>

<script lang="ts" setup>
import {
  mdiFileDocumentMultipleOutline,
  mdiFileDocumentPlusOutline,
  mdiPencilOutline,
  mdiTrashCanOutline,
} from "@mdi/js";

/** The buttons at the end of a row of `CardEmploymentHistory`: the relation's
 * sources, correcting it, removing it. Their own component because a person's
 * page puts them in a different place on a phone - on the row's period line,
 * where the list's other hosts keep them at the row's right edge - and one
 * copy of them is what keeps the two from drifting. The permissions are the
 * list's; see its props. */
const props = defineProps<{
  edge: EdgeNode;
  canCite?: boolean;
  canCorrect?: boolean;
  canRemove?: boolean;
  /** Hold the sources button's room on a row that has no sources to show. */
  reserveSources?: boolean;
}>();

const emit = defineEmits<{
  sources: [edge: EdgeNode];
  edit: [edge: EdgeNode];
  remove: [edge: EdgeNode];
}>();

/** How many articles the relation is cited to. An edge that predates
 * `references`, or one the graph returned without it, counts as none. */
const sources = computed(() => props.edge.references?.length ?? 0);
</script>

<style scoped>
.row-actions__gap {
  flex: none;
  width: 50px;
}
</style>
