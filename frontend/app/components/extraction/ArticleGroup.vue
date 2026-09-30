<template>
  <v-card variant="outlined" class="mb-4">
    <v-card-item class="cursor-pointer" @click="expanded = !expanded">
      <v-card-title class="article-header">
        <v-chip size="small" variant="tonal" color="primary">
          {{ domain }}
        </v-chip>
        <span class="article-path text-body-2">{{ articlePath }}</span>
      </v-card-title>
      <template #append>
        <v-chip size="small" variant="flat" color="secondary" class="me-2">
          {{ facts.length }}
        </v-chip>
        <v-icon>{{ expanded ? mdiChevronUp : mdiChevronDown }}</v-icon>
      </template>
    </v-card-item>

    <v-expand-transition>
      <!-- only mount a group's cards + vote widgets when it is opened
       so collapsed groups don't spin up Firestore listeners -->
      <div v-if="expanded">
        <v-divider />
        <v-card-text class="pa-4">
          <div v-for="fact in facts" :key="fact.id ?? fact.url" class="mb-4">
            <ExtractionCard :fact="fact" can-promote>
              <template #actions>
                <ExtractionVoteButtons v-if="fact.id" :id="fact.id" />
              </template>
            </ExtractionCard>
          </div>
        </v-card-text>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { mdiChevronDown, mdiChevronUp } from "@mdi/js";
import type { ExtractionFact } from "~~/shared/model";
import { ExtractionVoteButtons } from "#components";

const props = defineProps<{
  url: string;
  domain: string;
  facts: ExtractionFact[];
  /** Opened from the start - for a list narrowed to this one article, where
   * the reader came for its facts and a closed card is one more click to them.
   * The listeners the closed state saves are a handful for one article. */
  open?: boolean;
}>();

// Read once: the reader's own clicks decide from here on.
const expanded = ref(props.open);

// Domain is already in its chip, so the title shows just the path.
const articlePath = computed(() => {
  try {
    // Stored URLs may lack a protocol ("tvn24.pl/polska/...").
    const parsed = new URL(
      props.url.includes("://") ? props.url : `https://${props.url}`,
    );
    return parsed.pathname + parsed.search;
  } catch {
    return props.url;
  }
});
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}

.article-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  white-space: normal;
}

.article-header :deep(.v-chip) {
  flex-shrink: 0;
}

/* Clamp long paths to two lines with an ellipsis. */
.article-path {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
  line-height: 1.3;
}
</style>
