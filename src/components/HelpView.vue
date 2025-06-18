<template>
  <v-navigation-drawer
    location="right"
    permanent>
    <AddArticleDialog />
    <AddSuggestionDialog/>
    <AddEmployedDialog/>
    <AddBatchEmployedDialog/>
  </v-navigation-drawer>
  <v-row cols="12">
    <v-col cols="12">
      <h2 class="text-h5 font-weight-bold">
        Przejrzyj te artykuły
      </h2>
    </v-col>
    <v-col v-for="(article, articleId) in articles" :key="articleId" cols="12">
      <v-card
        :title="getShortTitle(article)"
        :subtitle="getSubtitle(article)"
        :href="article.sourceURL"
        target="_blank" >
        <v-card-text>
          <p v-for="(comment, commentKey) in article.comments" :key="commentKey">
            {{ comment.text }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-btn
            :color="article.isAssignedToCurrentUser ? 'yellow' : undefined"
            @click="assignToArticle(article.id)"
          >
            {{ article.isAssignedToCurrentUser ? 'Wypisz się' : 'Zgłoś się' }}
          </v-btn>
          <v-btn
            v-if="article.isAssignedToCurrentUser"
            @click="markArticleAsDone(article.id)"
          >
            Zrobione
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useReadDB } from '@/composables/staticDB';
import type { Textable } from '@/composables/suggestDB';
import { useAuthState } from '@/composables/auth'; // Assuming auth store path
import { ref as dbRefFirebase, set, remove } from 'firebase/database';

const { db: firebaseDatabaseInstance, watchPath } = useReadDB();
const { user } = useAuthState();

interface SubmittedData {
  date: number;
  title: string;
  sourceURL: string;
  comments: Record<string, Textable>
  signedUp: Record<string, any>
  markedDone: Record<string, any>
}

function getSubtitle(data: SubmittedData): string | undefined {
  const parts = data.title.split('.', 2);
  return parts.length > 1 ? parts[1].trim() : undefined;
}

function getShortTitle(data: SubmittedData): string {
  return data.title.split('.', 1)[0].trim();
}

const articles = watchPath<Record<string, SubmittedData>>('data')
</script>
