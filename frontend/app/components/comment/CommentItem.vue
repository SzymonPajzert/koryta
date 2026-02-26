<template>
  <div class="comment-item py-2">
    <div class="d-flex align-center">
      <div class="text-subtitle-2 font-weight-bold">
        {{ comment.authorName || "Anonim" }}
      </div>
      <div class="text-caption text-grey ml-2">
        {{ new Date(comment.createdAt).toLocaleString() }}
      </div>
    </div>

    <div class="comment-content text-body-2 my-1">
      {{ comment.content }}
    </div>

    <div class="d-flex align-center">
      <v-btn
        v-if="user"
        variant="text"
        size="x-small"
        density="compact"
        color="grey"
        prepend-icon="mdi-reply"
        @click="showReply = !showReply"
      >
        Odpowiedz
      </v-btn>
    </div>

    <div v-if="showReply" class="pl-4 mt-2">
      <CommentForm
        :node-id="comment.nodeId"
        :edge-id="comment.edgeId"
        :parent-id="comment.id"
        label="Odpowiedz..."
        @success="handleReplySuccess"
        @cancel="showReply = false"
      />
    </div>

    <!-- Children -->
    <div v-if="children.length" class="pl-4 border-s ml-1 mt-2">
      <CommentItem
        v-for="child in children"
        :key="child.id"
        :comment="child"
        :all-comments="allComments"
        @reply-success="$emit('reply-success')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Comment } from "~~/shared/model";
import CommentForm from "./CommentForm.vue";
// Import self for recursion
import CommentItem from "./CommentItem.vue";

const props = defineProps<{
  comment: Comment;
  allComments: Comment[];
}>();

const emit = defineEmits<{
  (e: "reply-success"): void;
}>();

const { user } = useAuthState();
const showReply = ref(false);

const children = computed(() =>
  props.allComments.filter((c) => c.parentId === props.comment.id),
);

function handleReplySuccess() {
  showReply.value = false;
  emit("reply-success");
}
</script>
