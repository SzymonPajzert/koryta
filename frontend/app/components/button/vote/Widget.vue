<template>
  <client-only>
    <v-btn
      icon
      border="sm current"
      class="text-none pa-1 me-2"
      :color="config.color"
      rounded="lg"
      size="44"
      :variant="userVoteResult > 0 ? 'tonal' : 'outlined'"
      @click="castVote(userVoteResult === 1 ? -1 : 1)"
    >
      <button-vote-icon
        :icon="config.icon"
        :color="config.color"
        :highlight="userVoteResult > 0"
      />
      <v-tooltip activator="parent" location="top">{{ config.text }}</v-tooltip>
    </v-btn>
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
