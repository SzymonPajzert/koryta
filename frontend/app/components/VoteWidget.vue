<template>
  <div class="vote-widget d-flex align-center">
    <span v-if="user" data-cy="user-logged-in" class="d-none"></span>
    <div class="mr-4">
      <div class="text-caption text-medium-emphasis mb-1">Ciekawe?</div>
      <v-btn-group density="compact" rounded="pill" variant="outlined" divided>
        <v-btn
          :color="userVoteInteresting > 0 ? 'primary' : undefined"
          :variant="userVoteInteresting > 0 ? 'flat' : 'outlined'"
          size="small"
          prepend-icon="mdi-thumb-up"
          @click="vote('interesting', 1)"
        >
          Tak
        </v-btn>
        <v-btn
          :color="userVoteInteresting > 0 ? 'primary' : userVoteInteresting < 0 ? 'error' : undefined"
          :disabled="true"
          variant="flat"
          size="small"
        >
          {{ userVoteInteresting }}
        </v-btn>
        <v-btn
          :color="userVoteInteresting < 0 ? 'error' : undefined"
          :variant="userVoteInteresting < 0 ? 'flat' : 'outlined'"
          size="small"
          prepend-icon="mdi-thumb-down"
          @click="vote('interesting', -1)"
        >
          Nie
        </v-btn>
      </v-btn-group>
    </div>

    <div>
      <div class="text-caption text-medium-emphasis mb-1">Jakość</div>
      <v-btn-group density="compact" rounded="pill" variant="outlined" divided>
        <v-btn
          :color="userVoteQuality > 0 ? 'success' : undefined"
          :variant="userVoteQuality > 0 ? 'flat' : 'outlined'"
          size="small"
          prepend-icon="mdi-check-circle"
          @click="vote('quality', 1)"
        >
          Gotowe
        </v-btn>
        <v-btn
          :color="userVoteQuality > 0 ? 'success' : userVoteQuality < 0 ? 'warning' : undefined"
          :disabled="true"
          variant="flat"
          size="small"
        >
          {{ userVoteQuality }}
        </v-btn>
        <v-btn
          :color="userVoteQuality < 0 ? 'warning' : undefined"
          :variant="userVoteQuality < 0 ? 'flat' : 'outlined'"
          size="small"
          prepend-icon="mdi-alert-circle"
          @click="vote('quality', -1)"
        >
          Popraw
        </v-btn>
      </v-btn-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthState } from "@/composables/auth";
import type { Node, Edge, VoteCategory, Votes } from "~~/shared/model";

const props = defineProps<{
  entity: Node | Edge;
  type: "node" | "edge";
  id?: string;
}>();

const { authFetch, user } = useAuthState();

// Create local reactive state for votes to ensure UI updates
const localVotes = ref<Votes>({} as Votes);

// Watch for prop changes to update local state (e.g. initial load)
watch(
  () => props.entity.votes,
  (newVotes) => {
    if (newVotes) {
      localVotes.value = JSON.parse(JSON.stringify(newVotes));
    } else {
      localVotes.value = {
        interesting: { total: 0 },
        quality: { total: 0 },
      } as Votes;
    }
  },
  { immediate: true, deep: true },
);

const getUserVote = (category: VoteCategory) => {
  if (!user.value) return 0;
  return localVotes.value[category]?.[user.value.uid] || 0;
};

const getTotal = (category: VoteCategory) => {
  return localVotes.value[category]?.total || 0;
};

const userVoteInteresting = computed(() => getUserVote("interesting"));
const userVoteQuality = computed(() => getUserVote("quality"));

const interestingTotal = computed(() => getTotal("interesting"));
const qualityTotal = computed(() => getTotal("quality"));

const loading = reactive({
  interesting: false,
  quality: false,
});

const router = useRouter();
const route = useRoute();

async function vote(category: VoteCategory, delta: number) {
  if (!user.value) {
    router.push({
      path: "/login",
      query: { redirect: route.fullPath },
    });
    return;
  }

  // True optimistic update
  if (!localVotes.value[category]) localVotes.value[category] = { total: 0 };
  
  const originalTotal = localVotes.value[category].total;
  const originalUserVote = localVotes.value[category][user.value.uid] || 0;

  localVotes.value[category].total += delta;
  localVotes.value[category][user.value.uid] = originalUserVote + delta;

  loading[category] = true;
  try {
    await authFetch("/api/votes/vote", {
      method: "POST",
      body: {
        id: props.id || props.entity.id || (props.entity as any)._id,
        type: props.type,
        category,
        vote: delta,
      },
    });
  } catch (e) {
    console.error("Failed to vote", e);
    // Revert optimistic update
    localVotes.value[category].total = originalTotal;
    localVotes.value[category][user.value.uid] = originalUserVote;
    alert("Wystąpił błąd podczas głosowania.");
  } finally {
    loading[category] = false;
  }
}
</script>

<style scoped>
.vote-widget {
  gap: 16px;
}
</style>
