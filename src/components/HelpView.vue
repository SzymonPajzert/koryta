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
    <v-col v-for="(article, key) in articles" :key cols="12">
      <v-card
        :title="getShortTitle(article)"
        :subtitle="getSubtitle(article)"
        :href="article.sourceURL"
        target="_blank" >
        <v-card-text>
          <p v-for="comment in article.comments">
            {{ comment.text }}
          </p>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
import { useReadDB } from '@/composables/staticDB';
import type { Textable } from '@/composables/suggestDB';
const { db, watchPath } = useReadDB()

interface SubmittedData {
  date: number;
  title: string;
  sourceURL: string;
  comments: Record<string, Textable>
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
