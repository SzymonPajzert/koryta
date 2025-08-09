<template>
  <v-card
    v-if="!article.enrichedStatus?.hideArticle"
    :title="getShortTitle(article)"
    :subtitle="dense ? undefined : getSubtitle(article)"
    class="mb-2"
    @click="
      dialogStore.open({
        type: 'data',
        edit: { value: article, key: articleID },
      })
    "
    target="_blank"
    height="100%"
  >
    <v-card-text v-if="!dense">
      <p v-for="(comment, commentKey) in article.comments" :key="commentKey">
        {{ comment.text }}
      </p>
    </v-card-text>
    <v-card-actions>
      <v-spacer></v-spacer>
      <v-btn
        variant="tonal"
        :href="article.sourceURL"
        @click.stop
        target="_blank"
        prepend-icon="mdi-open-in-new"
      >
        Zobacz
      </v-btn>
      <v-btn
        variant="tonal"
        :color="
          article.enrichedStatus?.isAssignedToCurrentUser ? 'yellow' : undefined
        "
        @click.prevent="
          assignToArticle(
            articleID,
            !article.enrichedStatus?.isAssignedToCurrentUser
          )
        "
        prepend-icon="mdi-hand-back-left-outline"
      >
        <template #prepend>
          <v-icon color="success"></v-icon>
        </template>
        {{
          article.enrichedStatus?.isAssignedToCurrentUser
            ? "Wypisz się"
            : "Zgłoś się"
        }}
      </v-btn>
      <v-btn
        variant="tonal"
        @click.prevent="markArticleAsDone(articleID)"
        prepend-icon="mdi-check-circle-outline"
      >
        <template #prepend>
          <v-icon color="success"></v-icon>
        </template>
        Zrobione
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script lang="ts" setup>
import type { Article } from "@/../shared/model";
import {
  type EnrichedStatus,
  useArticles,
} from "@/composables/entities/articles";
import { getShortTitle, getSubtitle } from "@/../shared/misc";
import { useDialogStore } from "@/stores/dialog";

const dialogStore = useDialogStore();

const { articleID, article } = defineProps<{
  articleID: string;
  article: Article & EnrichedStatus;
  dense?: boolean;
}>();
const { markArticleAsDone, assignToArticle } = useArticles();
</script>
