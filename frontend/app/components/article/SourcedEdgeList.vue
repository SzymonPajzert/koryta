<template>
  <div>
    <!-- A line to a relation, its two ends as chips - the pieces the mentions
         above are drawn with. It was an outlined card each, two to a row, with
         both ends as bare links in the browser's blue, and a dozen relations
         stood several times taller than the section naming the same people. -->
    <div v-if="edges.length" class="d-flex flex-column ga-2">
      <div
        v-for="edge in edges"
        :key="edge.id"
        class="d-flex align-center flex-wrap ga-2"
        :data-testid="'sourced-edge-' + edge.id"
      >
        <v-chip
          :to="endUrl(edge.sourceType, edge.source, edge.sourceName)"
          :prepend-icon="
            edge.sourceType ? entityIcon(edge.sourceType) : undefined
          "
          size="small"
          variant="tonal"
          data-testid="article-sourced-end"
        >
          {{ edge.sourceName ?? edge.source }}
        </v-chip>
        <v-icon
          :icon="mdiArrowRight"
          size="small"
          class="text-medium-emphasis"
        />
        <v-chip
          :to="endUrl(edge.targetType, edge.target, edge.targetName)"
          :prepend-icon="
            edge.targetType ? entityIcon(edge.targetType) : undefined
          "
          size="small"
          variant="tonal"
          data-testid="article-sourced-end"
        >
          {{ edge.targetName ?? edge.target }}
        </v-chip>

        <span class="text-body-2 text-medium-emphasis">
          {{ edge.name || edgeTypeLabels[edge.type] || edge.type }}
          <template v-if="edge.start_date || edge.end_date">
            · {{ edge.start_date }} – {{ edge.end_date || "obecnie" }}
          </template>
        </span>

        <v-chip v-if="!edge.published" size="x-small" variant="tonal">
          szkic
        </v-chip>
        <!-- A claim can rest on several articles, and knowing this one is
             not the only leg it stands on changes what removing it means. -->
        <v-chip
          v-if="edge.references.length > 1"
          size="x-small"
          variant="text"
          :prepend-icon="mdiFileDocumentMultipleOutline"
        >
          {{
            polishCounting(edge.references.length, "źródło", "źródła", "źródeł")
          }}
        </v-chip>
        <!-- An icon rather than the words, which made every row a line
             longer; the words are what a screen reader and a hover get. -->
        <v-btn
          v-if="canEdit"
          icon
          size="x-small"
          variant="text"
          color="error"
          aria-label="Odepnij źródło"
          :loading="removing === edge.id"
          :data-testid="'sourced-edge-detach-' + edge.id"
          @click="emit('detach', edge)"
        >
          <v-icon :icon="mdiLinkVariantOff" />
          <v-tooltip activator="parent" location="top">
            Odepnij źródło
          </v-tooltip>
        </v-btn>
      </div>
    </div>

    <v-alert v-else type="info" variant="tonal" density="compact">
      Żadne powiązanie nie powołuje się jeszcze na ten artykuł.
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import {
  mdiArrowRight,
  mdiFileDocumentMultipleOutline,
  mdiLinkVariantOff,
} from "@mdi/js";
import { edgeTypeLabels } from "~/composables/edges";
import { polishCounting } from "~/composables/polish";
import { generateEntityUrl } from "~/composables/slugs";
import { entityIcon } from "~/utils/entityIcon";
import type { NodeType } from "~~/shared/model";
import type { SourcedEdge } from "~~/server/api/edges/byReference.get";

defineProps<{
  edges: SourcedEdge[];
  canEdit: boolean;
  /** Id of the edge whose detach is in flight. */
  removing?: string | null;
}>();

const emit = defineEmits<{ detach: [edge: SourcedEdge] }>();

/** Each end links to whatever page its kind has. An end whose node has been
 * removed has neither name nor type, and is drawn as a chip that goes nowhere
 * rather than a link to a page that is not there. */
function endUrl(type: NodeType | null, id: string, name: string | null) {
  return type && name ? generateEntityUrl(type, id, name) : undefined;
}
</script>
