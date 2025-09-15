<template>
  <v-list-item
    v-if="!article.enrichedStatus?.hideArticle"
    :title="getShortTitle(article)"
    class="mb-2"
    @click="
      dialogStore.open({
        type: 'data',
        edit: { value: article, key: articleId },
      })
    "
  />
</template>

<script lang="ts" setup>
import type { Article } from "~~/shared/model";
import type { EnrichedStatus } from "@/composables/entities/articles";
import { getShortTitle } from "~~/shared/misc";
import { useDialogStore } from "@/stores/dialog"; // Import the new store

const dialogStore = useDialogStore();

const { articleId, article } = defineProps<{
  articleId: string;
  article: Article & EnrichedStatus;
  dense?: boolean;
}>();
</script>
