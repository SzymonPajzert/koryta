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
import { computed, reactive, ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthState } from "@/composables/auth";
import type { Node, Edge, VoteCategory } from "~~/shared/model";
import { getFirestore, collection, doc } from "firebase/firestore";
import { useDocument, useFirebaseApp } from "vuefire";

const props = defineProps<{
  entity: Node | Edge;
  type: "node" | "edge";
  id?: string;
}>();

const { idToken, user } = useAuthState();

const firebaseApp = useFirebaseApp();
const db = getFirestore(firebaseApp, "koryta-pl");

const shouldSubscribe = ref(false);

const docSource = computed(() => {
  if (!shouldSubscribe.value) return null;
  return doc(
    collection(db, props.type + "s"),
    props.id || props.entity.id || (props.entity as any)._id,
  );
});

const entityDocument = useDocument(docSource);

const displayedVotes = computed(() => {
  if (entityDocument.value) {
    return (
      entityDocument.value.votes || {
        interesting: { total: 0 },
        quality: { total: 0 },
      }
    );
  }
  return (
    props.entity.votes || { interesting: { total: 0 }, quality: { total: 0 } }
  );
});

const getUserVote = (category: VoteCategory) => {
  if (!user.value) return 0;
  return displayedVotes.value[category]?.[user.value.uid] || 0;
};

const userVoteInteresting = computed(() => getUserVote("interesting"));
const userVoteQuality = computed(() => getUserVote("quality"));

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

  shouldSubscribe.value = true;
  loading[category] = true;
  try {
    await $fetch("/api/votes/vote", {
      method: "POST",
      body: {
        id: props.id || props.entity.id || (props.entity as any)._id,
        type: props.type,
        category,
        vote: delta,
      },
      headers: {
        Authorization: `Bearer ${idToken.value}`,
      },
    });
  } catch (e) {
    console.error("Failed to vote", e);
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
