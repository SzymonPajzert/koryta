<template>
  <v-card variant="outlined" class="mb-4">
    <v-card-item class="cursor-pointer" @click="expanded = !expanded">
      <template #prepend>
        <v-chip size="small" variant="tonal" color="primary">
          {{ domain }}
        </v-chip>
      </template>
      <v-card-title class="text-body-1 text-truncate">
        {{ url }}
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
            <ExtractionCard :fact="fact">
              <template #actions>
                <ButtonVoteWidget
                  v-if="fact.id"
                  :id="fact.id"
                  category="correct"
                />
              </template>
            </ExtractionCard>
          </div>
        </v-card-text>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { mdiChevronDown, mdiChevronUp } from "@mdi/js";
import type { ExtractionFact } from "~~/shared/model";
import { ButtonVoteWidget } from "#components";

defineProps<{
  url: string;
  domain: string;
  facts: ExtractionFact[];
}>();

const expanded = ref(false);
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}
</style>
