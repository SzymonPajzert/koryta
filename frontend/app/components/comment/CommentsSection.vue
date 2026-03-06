<template>
  <div class="comments-section">
    <div class="d-flex align-center justify-space-between mb-4">
      <h3 class="text-h6">Dyskusja ({{ comments.length }})</h3>
      <v-btn
        v-if="!showForm && user"
        variant="tonal"
        size="small"
        prepend-icon="mdi-comment-plus-outline"
        @click="showForm = true"
      >
        Dodaj komentarz
      </v-btn>
    </div>

    <div v-if="!user" class="text-caption text-grey mb-4">
      <router-link to="/login">Zaloguj się</router-link>, aby dodać komentarz.
    </div>

    <div v-if="loading" class="text-center py-4">Ładowanie...</div>

    <div v-if="showForm" class="mb-6">
      <CommentForm
        :node-id="nodeId"
        :edge-id="edgeId"
        @success="handleSuccess"
        @cancel="showForm = false"
      />
    </div>

    <div
      v-if="mainComments.length === 0 && !loading"
      class="text-center text-grey py-4"
    >
      Brak komentarzy.
    </div>

    <div v-else class="comment-list">
      <CommentItem
        v-for="comment in mainComments"
        :key="comment.id"
        :comment="comment"
        :all-comments="comments"
        @reply-success="refresh"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Comment } from "~~/shared/model";
import { useAuthState } from "@/composables/auth";
import CommentItem from "./CommentItem.vue";
import CommentForm from "./CommentForm.vue";

const props = defineProps<{
  nodeId?: string;
  edgeId?: string;
  leadMode?: boolean;
}>();

const { authFetch, user } = useAuthState();
const showForm = ref(false);

const query = computed(() => {
  if (props.leadMode) return { onlyLeads: "true" };
  if (props.nodeId) return { nodeId: props.nodeId };
  if (props.edgeId) return { edgeId: props.edgeId };
  return {};
});

const {
  data,
  pending: loading,
  refresh,
} = await authFetch<Comment[]>("/api/comments/list", {
  query,
});

const comments = computed(() => data.value || []);
const mainComments = computed(() => {
  if (!Array.isArray(comments.value)) return [];
  return comments.value.filter((c) => !c.parentId);
});

function handleSuccess() {
  showForm.value = false;
  refresh();
}
</script>
