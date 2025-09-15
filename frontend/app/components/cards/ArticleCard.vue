<template>
  <v-card
    v-if="!article.enrichedStatus?.hideArticle"
    :title="getShortTitle(article)"
    :subtitle="dense ? undefined : getSubtitle(article)"
    class="mb-2"
    target="_blank"
    height="100%"
    @click="
      dialogStore.open({
        type: 'data',
        edit: { value: article, key: articleID },
      })
    "
  >
    <v-card-text v-if="!dense">
      <p v-for="(comment, commentKey) in article.comments" :key="commentKey">
        {{ comment.text }}
      </p>
    </v-card-text>
    <v-card-actions>
      <v-spacer/>
      <v-btn
        variant="tonal"
        :href="article.sourceURL"
        target="_blank"
        prepend-icon="mdi-open-in-new"
        @click.stop
      >
        Zobacz
      </v-btn>
      <v-btn
        variant="tonal"
        :color="
          article.enrichedStatus?.isAssignedToCurrentUser ? 'yellow' : undefined
        "
        prepend-icon="mdi-hand-back-left-outline"
        @click.prevent="
          assignToArticle(
            articleID,
            !article.enrichedStatus?.isAssignedToCurrentUser
          )
        "
      >
        <template #prepend>
          <v-icon color="success"/>
        </template>
        {{
          article.enrichedStatus?.isAssignedToCurrentUser
            ? "Wypisz się"
            : "Zgłoś się"
        }}
      </v-btn>
      <v-btn
        variant="tonal"
        prepend-icon="mdi-check-circle-outline"
        @click.prevent="markArticleAsDone(articleID)"
      >
        <template #prepend>
          <v-icon color="success"/>
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
