<template>
  <client-only>
    <div
      class="d-inline-flex align-center bg-surface border rounded-pill overflow-hidden shadow-sm transition-all"
      style="border-color: rgba(var(--v-theme-on-surface), 0.12) !important"
      :class="{ 'elevation-2': isHoveringContainer }"
      @mouseenter="isHoveringContainer = true"
      @mouseleave="isHoveringContainer = false"
    >
      <v-btn
        icon="mdi-arrow-up-bold"
        size="x-small"
        variant="text"
        :color="userVoteResult > 0 ? config.color : 'medium-emphasis'"
        class="rounded-0"
        :disabled="loading"
        :title="'Głosuj na plus'"
        @click="handleVote(1)"
      />
      <div
        class="text-caption font-weight-bold px-1 text-center"
        style="min-width: 28px"
        :class="{
          ['text-' + config.color]: userVoteResult > 0,
          ['text-' + config.downColor]: userVoteResult < 0,
        }"
      >
        {{ userVoteResult > 0 ? "+" : "" }}{{ userVoteResult }}
      </div>
      <v-btn
        icon="mdi-arrow-down-bold"
        size="x-small"
        variant="text"
        :color="userVoteResult < 0 ? config.downColor : 'medium-emphasis'"
        class="rounded-0"
        :disabled="loading"
        :title="'Głosuj na minus'"
        @click="handleVote(-1)"
      />
    </div>
  </client-only>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { VoteCategory } from "~~/shared/model";
import { useVotes } from "~/composables/votes";

const { id, category } = defineProps<{
  id: string;
  category: VoteCategory;
}>();

const { userCategoryVotes, castVote, config, loading } = useVotes(id, category);

const userVoteResult = computed(() => userCategoryVotes.value[category] || 0);

const emit = defineEmits(["voted"]);

const handleVote = async (value: number) => {
  await castVote(value);
  emit("voted");
};

const isHoveringContainer = ref(false);
</script>
