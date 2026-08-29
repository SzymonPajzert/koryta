<template>
  <div>
    <v-row v-if="edges.length">
      <v-col v-for="edge in edges" :key="edge.id" cols="12" md="6">
        <v-card variant="outlined" :data-testid="'sourced-edge-' + edge.id">
          <v-card-item>
            <template #prepend>
              <v-icon :icon="mdiSourceBranch" />
            </template>
            <v-card-title class="text-body-1 text-wrap">
              <NuxtLink v-if="sourceUrl(edge)" :to="sourceUrl(edge)!">
                {{ edge.sourceName ?? edge.source }}
              </NuxtLink>
              <template v-else>{{ edge.sourceName ?? edge.source }}</template>
              <v-icon :icon="mdiArrowRight" size="small" class="mx-1" />
              <NuxtLink v-if="targetUrl(edge)" :to="targetUrl(edge)!">
                {{ edge.targetName ?? edge.target }}
              </NuxtLink>
              <template v-else>{{ edge.targetName ?? edge.target }}</template>
            </v-card-title>
            <v-card-subtitle class="text-wrap">
              {{ edge.name || edgeTypeLabels[edge.type] || edge.type }}
              <span v-if="edge.start_date || edge.end_date">
                · {{ edge.start_date }} – {{ edge.end_date || "obecnie" }}
              </span>
            </v-card-subtitle>
          </v-card-item>

          <v-card-text class="pt-0 d-flex align-center flex-wrap ga-2">
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
                polishCounting(
                  edge.references.length,
                  "źródło",
                  "źródła",
                  "źródeł",
                )
              }}
            </v-chip>
            <v-spacer />
            <v-btn
              v-if="canEdit"
              size="small"
              variant="text"
              color="error"
              :loading="removing === edge.id"
              :data-testid="'sourced-edge-detach-' + edge.id"
              @click="emit('detach', edge)"
            >
              Odepnij źródło
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-alert v-else type="info" variant="tonal" density="compact">
      Żadne powiązanie nie powołuje się jeszcze na ten artykuł.
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import {
  mdiArrowRight,
  mdiFileDocumentMultipleOutline,
  mdiSourceBranch,
} from "@mdi/js";
import { edgeTypeLabels } from "~~/shared/edges";
import { polishCounting } from "~/composables/polish";
import { generateEntityUrl } from "~/composables/slugs";
import type { SourcedEdge } from "~~/server/api/edges/byReference.get";

defineProps<{
  edges: SourcedEdge[];
  canEdit: boolean;
  /** Id of the edge whose detach is in flight. */
  removing?: string | null;
}>();

const emit = defineEmits<{ detach: [edge: SourcedEdge] }>();

/** Both ends link to whatever page their kind has - `generateNodeUrl` sends a
 * place to the filtered table and a person to their own page. An end whose node
 * has been removed has neither name nor type, and is rendered as plain text. */
function sourceUrl(edge: SourcedEdge) {
  return edge.sourceType && edge.sourceName
    ? generateEntityUrl(edge.sourceType, edge.source, edge.sourceName)
    : undefined;
}
function targetUrl(edge: SourcedEdge) {
  return edge.targetType && edge.targetName
    ? generateEntityUrl(edge.targetType, edge.target, edge.targetName)
    : undefined;
}
</script>
