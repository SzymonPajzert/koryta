<template>
  <client-only>
    <v-hover>
      <template #default="{ isHovering, props }">
        <v-btn
          v-bind="props"
          border="sm current"
          class="text-none pa-1"
          :color="config.color"
          rounded="lg"
          size="isHovering ? 'large' : '44'"
          :variant="userVoteResult > 0 ? 'tonal' : 'outlined'"
          :icon="isHovering ? undefined : config.icon"
          @click="castVote(userVoteResult === 1 ? -1 : 1)"
        >
          <template v-if="isHovering">
            {{ config.text }}
          </template>
          <button-vote-icon
            v-else
            :icon="config.icon"
            :color="config.color"
            :highlight="userVoteResult > 0"
          />
          <template #prepend>
            <button-vote-icon
              v-if="isHovering"
              v-bind="props"
              :icon="config.icon"
              :color="config.color"
              :highlight="userVoteResult > 0"
            />
          </template>
        </v-btn>
      </template>
    </v-hover>
  </client-only>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { VoteCategory } from "~~/shared/model";
import { useVotes } from "~/composables/votes";
import { ButtonVoteIcon, ClientOnly } from "#components";

const { id, category } = defineProps<{
  id: string;
  category: VoteCategory;
}>();

const { userCategoryVotes, castVote, config } = useVotes(id, category);

const userVoteResult = computed(() => userCategoryVotes.value[category] || 0);
</script>
