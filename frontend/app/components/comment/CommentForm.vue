<template>
  <div class="comment-form">
    <v-textarea
      v-model="content"
      :label="label || 'Napisz komentarz...'"
      auto-grow
      rows="2"
      hide-details="auto"
      variant="outlined"
      density="comfortable"
      data-test="comment-input"
    />
    <div class="d-flex justify-end mt-2">
      <v-btn
        v-if="parentId"
        size="small"
        variant="text"
        class="mr-2"
        @click="$emit('cancel')"
      >
        Anuluj
      </v-btn>
      <!-- A sage fill with dark text, not sage on its own tint: sage is a fill,
           never text (Szymon, 2026-10-23, for every control drawn in it). -->
      <v-btn
        color="primary"
        size="small"
        variant="flat"
        :loading="loading"
        :disabled="!content.trim()"
        @click="submit"
      >
        Wyślij
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { authFetch } from "@/composables/auth";

const props = defineProps<{
  nodeId?: string;
  edgeId?: string;
  parentId?: string;
  label?: string;
}>();

const emit = defineEmits<{
  (e: "success" | "cancel"): void;
}>();

const content = ref("");
const loading = ref(false);

async function submit() {
  if (!content.value.trim()) return;
  loading.value = true;
  try {
    const body = {
      content: content.value,
      nodeId: props.nodeId,
      edgeId: props.edgeId,
      parentId: props.parentId,
    };

    const { error } = await authFetch("/api/comments/create", {
      method: "POST",
      body,
      key: `create-comment-${Date.now()}`,
    });

    if (error.value) {
      throw new Error(error.value.message || "Unknown error");
    }

    content.value = "";
    emit("success");
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}
</script>
