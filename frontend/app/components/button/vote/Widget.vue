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
          @click="vote(userVoteResult === 1 ? -1 : 1)"
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
import { useRouter, useRoute } from "vue-router";
import { useAuthState } from "@/composables/auth";
import type { VoteCategory } from "~~/shared/model";
import { useVotes } from "~/composables/votes";
import { ButtonVoteIcon, ClientOnly } from "#components";

const { id, category } = defineProps<{
  id: string;
  category: VoteCategory;
}>();

const configMap: Record<
  VoteCategory,
  { text: string; icon: string; color: string }
> = {
  interesting: {
    text: "Dobre znalezisko",
    icon: "mdi-lightbulb-outline",
    color: "success",
  },
  quality: {
    text: "Znaleziony problem",
    icon: "mdi-alert-circle-outline",
    color: "error",
  },
};

const config = configMap[category];

const { userCategoryVotes, castVote } = useVotes(id);

const userVoteResult = computed(() => userCategoryVotes.value[category] || 0);

const loading = ref(false);

const { user } = useAuthState();
const router = useRouter();
const route = useRoute();
async function vote(delta: number) {
  if (!user.value) {
    router.push({
      path: "/login",
      query: { redirect: route.fullPath },
    });
    return;
  }

  loading.value = true;
  try {
    await castVote(category, delta);
  } catch (e) {
    console.error("Failed to vote", e);
    alert("Wystąpił błąd podczas zapisywania głosu.");
  } finally {
    loading.value = false;
  }
}
</script>
