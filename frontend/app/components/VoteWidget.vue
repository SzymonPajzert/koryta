<template>
  <client-only>
    <div class="vote-widget d-flex align-center">
      <span v-if="user" data-cy="user-logged-in" class="d-none" />
      <div class="mr-4">
        <div class="text-caption text-medium-emphasis mb-1">Ciekawe?</div>
        <v-btn-group
          density="compact"
          rounded="pill"
          variant="outlined"
          divided
        >
          <v-btn
            :color="userVoteInteresting > 0 ? 'primary' : undefined"
            :variant="userVoteInteresting > 0 ? 'flat' : 'outlined'"
            size="small"
            prepend-icon="mdi-thumb-up"
            @click="vote(interestingKey, 1)"
          >
            Tak
          </v-btn>
          <v-btn
            :color="
              userVoteInteresting > 0
                ? 'primary'
                : userVoteInteresting < 0
                  ? 'error'
                  : undefined
            "
            :disabled="true"
            variant="flat"
            size="small"
          >
            {{ totalInteresting }}
          </v-btn>
          <v-btn
            :color="userVoteInteresting < 0 ? 'error' : undefined"
            :variant="userVoteInteresting < 0 ? 'flat' : 'outlined'"
            size="small"
            prepend-icon="mdi-thumb-down"
            @click="vote(interestingKey, -1)"
          >
            Nie
          </v-btn>
        </v-btn-group>
      </div>

      <div>
        <div class="text-caption text-medium-emphasis mb-1">Jakość</div>
        <v-btn-group
          density="compact"
          rounded="pill"
          variant="outlined"
          divided
        >
          <v-btn
            :color="userVoteQuality > 0 ? 'success' : undefined"
            :variant="userVoteQuality > 0 ? 'flat' : 'outlined'"
            size="small"
            prepend-icon="mdi-check-circle"
            @click="vote(qualityKey, 1)"
          >
            Gotowe
          </v-btn>
          <v-btn
            :color="
              userVoteQuality > 0
                ? 'success'
                : userVoteQuality < 0
                  ? 'warning'
                  : undefined
            "
            :disabled="true"
            variant="flat"
            size="small"
          >
            {{ totalQuality }}
          </v-btn>
          <v-btn
            :color="userVoteQuality < 0 ? 'warning' : undefined"
            :variant="userVoteQuality < 0 ? 'flat' : 'outlined'"
            size="small"
            prepend-icon="mdi-alert-circle"
            @click="vote(qualityKey, -1)"
          >
            Popraw
          </v-btn>
        </v-btn-group>
      </div>
    </div>
  </client-only>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthState } from "@/composables/auth";
import type { Node, Edge, VoteCategory } from "~~/shared/model";
import { useVotes } from "~/composables/votes";
import { ClientOnly } from "#components";

const props = defineProps<{
  entity: Node | Edge;
  type: "node" | "edge";
  id: string;
}>();

const { user } = useAuthState();
const router = useRouter();
const route = useRoute();

const shouldSubscribe = ref(false);

const { userCategoryVotes, nodeCategoryVotes, castVote } = useVotes(props.id);

const interestingKey: VoteCategory = "interesting";
const qualityKey: VoteCategory = "quality";

const totalInteresting = computed(() => {
  console.log("nodeCategoryVotes", nodeCategoryVotes.value);
  return nodeCategoryVotes.value.interesting || 0;
});

const totalQuality = computed(() => {
  return nodeCategoryVotes.value.quality || 0;
});

const userVoteInteresting = computed(
  () => userCategoryVotes.value.interesting || 0,
);
const userVoteQuality = computed(() => userCategoryVotes.value.quality || 0);

const loading = reactive({
  interesting: false,
  quality: false,
});

async function vote(category: VoteCategory, delta: number) {
  if (!user.value) {
    router.push({
      path: "/login",
      query: { redirect: route.fullPath },
    });
    return;
  }

  shouldSubscribe.value = true;
  loading[category as keyof typeof loading] = true;
  try {
    await castVote(category, delta);
  } catch (e) {
    console.error("Failed to vote", e);
    alert("Wystąpił błąd podczas zapisywania głosu.");
  } finally {
    loading[category as keyof typeof loading] = false;
  }
}
</script>

<style scoped>
.vote-widget {
  gap: 16px;
}
</style>
