<template>
  <v-card
    v-if="!article.enrichedStatus?.hideArticle"
    :title="getShortTitle(article)"
    :subtitle="getSubtitle(article)"
    class="mb-2"

    :href="article.sourceURL"
    target="_blank"
    height="100%"
    >
    <v-card-text>
      <p v-for="(comment, commentKey) in article.comments" :key="commentKey">
        {{ comment.text }}
      </p>
    </v-card-text>
    <v-card-actions>
      <v-spacer></v-spacer>
      <v-btn
        variant="tonal"
        :color="article.enrichedStatus?.isAssignedToCurrentUser ? 'yellow' : undefined"
        @click.prevent="assignToArticle(articleID, !article.enrichedStatus?.isAssignedToCurrentUser)"
        prepend-icon="mdi-hand-back-left-outline"
      >
        <template #prepend>
          <v-icon color="success"></v-icon>
        </template>
        {{ article.enrichedStatus?.isAssignedToCurrentUser ? 'Wypisz się' : 'Zgłoś się' }}
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
import type {Article} from '@/composables/model'
import { type EnrichedStatus, useArticles } from '@/composables/entities/articles'

const { articleID, article } = defineProps<{ articleID: string, article: Article & EnrichedStatus }>()
const { markArticleAsDone, assignToArticle } = useArticles()

function getSubtitle(data: Article): string | undefined {
  const parts = data.name.split('.', 2);
  return parts.length > 1 ? parts[1].trim() : undefined;
}

function getShortTitle(data: Article): string {
  return data.name.split('.', 1)[0].trim();
}
</script>
