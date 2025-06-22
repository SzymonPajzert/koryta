<template>
  <v-navigation-drawer
    location="right"
    permanent>
    <AddArticleDialog />
    <AddSuggestionDialog/>
    <AddEmployedDialog/>
    <AddCompanyDialog/>
    <AddBatchEmployedDialog/>
  </v-navigation-drawer>
  <v-row cols="12">
    <p> Jeśli masz pytania,
      <a href="https://discord.gg/pnyPh7zXxS" target="_blank" @click.stop>
        dołącz do serwera Discord
      </a> - mamy kanał specjalnie dla koryta.pl
    </p>
    <v-col cols="12">
      <h2 class="text-h5 font-weight-bold">
        Przejrzyj te artykuły
      </h2>
    </v-col>
    <v-col cols="12" v-if="!user">
      <v-container>
        Zaloguj się, by zobaczyć zawartość.
      </v-container>
    </v-col>
    <v-col v-for="(article, articleId) in articles" :key="articleId" cols="12" md="6">
      <v-card
        v-if="!article.enrichedStatus?.hideArticle"
        :title="getShortTitle(article)"
        :subtitle="getSubtitle(article)"
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
            @click.prevent="assignToArticle(articleId, !article.enrichedStatus?.isAssignedToCurrentUser)"
            prepend-icon="mdi-hand-back-left-outline"
          >
            <template #prepend>
              <v-icon color="success"></v-icon>
            </template>
            {{ article.enrichedStatus?.isAssignedToCurrentUser ? 'Wypisz się' : 'Zgłoś się' }}
          </v-btn>
          <v-btn
            variant="tonal"
            @click.prevent="markArticleAsDone(articleId)"
            prepend-icon="mdi-check-circle-outline"
          >
            <template #prepend>
              <v-icon color="success"></v-icon>
            </template>
            Zrobione
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-col>
    <v-col cols="12">
      <h2 class="text-h5 font-weight-bold">
        Statystyki aktywności:
      </h2>
      <UserActivityTable />
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
import { useRTDB } from '@vueuse/firebase/useRTDB'
import { computed } from 'vue';
import type { Textable } from '@/composables/suggestDB';
import { useAuthState } from '@/composables/auth'; // Assuming auth store path
import { ref as dbRef, set, remove } from 'firebase/database';
import { db } from '@/firebase'

interface ArticleStatus {
  signedUp: Record<string, number>
  markedDone: Record<string, number>
  confirmedDone: boolean
}

interface SubmittedData {
  date: number;
  title: string;
  sourceURL: string;
  comments: Record<string, Textable>
  status?: ArticleStatus

  // We precalculate some state for the articles list
  // To not worry about the DB.
  enrichedStatus?: {
    isAssignedToCurrentUser: boolean;
    hideArticle: boolean;
  }
}

function getSubtitle(data: SubmittedData): string | undefined {
  const parts = data.title.split('.', 2);
  return parts.length > 1 ? parts[1].trim() : undefined;
}

function getShortTitle(data: SubmittedData): string {
  return data.title.split('.', 1)[0].trim();
}

const { user, isAdmin } = useAuthState();

const assignToArticle = async (articleId: string, setAssigned: boolean) => {
  if (!user.value) return;
  if (setAssigned) {
    set(dbRef(db, `data/${articleId}/status/signedUp/${user.value.uid}`), Date.now())
  } else {
    remove(dbRef(db, `data/${articleId}/status/signedUp/${user.value.uid}`))
  }
}

const markArticleAsDone = async (articleId: string) => {
  if (!user.value) return;
  set(dbRef(db, `data/${articleId}/status/markedDone/${user.value.uid}`), Date.now())
  if (isAdmin.value) {
    set(dbRef(db, `data/${articleId}/status/confirmedDone`), true)
  }
}

function removeOlderEntries(entries: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(entries).filter(([uid, date]) => {
    const now = new Date();
    const diff = now.getTime() - date;
    return diff < 1000 * 3600 * 24;
  }))
}

const allArticlesUnfiltered = useRTDB<Record<string, SubmittedData>>(dbRef(db, 'data'))
const articles = computed<Record<string, SubmittedData>>(() => {
  // Don't show any articles if the user is not logged in or there's no data yet.
  if (!user.value) return {};
  if (!allArticlesUnfiltered.value) return {};
  if (!user.value?.uid) return {}

  return Object.fromEntries(
    Object.entries(allArticlesUnfiltered.value).map(([articleId, articleData]) => {
      // remove status entries older than 24hs
      articleData.status = {
        signedUp: removeOlderEntries(articleData.status?.signedUp ?? {}),
        markedDone: removeOlderEntries(articleData.status?.markedDone ?? {}),
        confirmedDone: articleData.status?.confirmedDone ?? false
      }
      const status = articleData.status;

      if (!user.value) return [articleId, articleData] as [string, SubmittedData];
      const userMarkedAsDone : boolean = !!(status.markedDone[user.value.uid])
      const twoUsersMarkedAsDone : boolean  = Object.keys(status.markedDone).length > 1
      const userAssignedToThemselves : boolean  = !!(status.signedUp[user.value.uid])
      const assignedToAnotherUser  : boolean = Object.keys(status.signedUp).filter(uid => uid !== user.value?.uid).length > 0

      return [articleId, {
        ...articleData,
        enrichedStatus: {
          isAssignedToCurrentUser: userAssignedToThemselves,
          hideArticle: status.confirmedDone || userMarkedAsDone || twoUsersMarkedAsDone || assignedToAnotherUser
        }
      } as SubmittedData] as [string, SubmittedData];
    }).filter(([_, article]) => !article.enrichedStatus?.hideArticle)
    .sort(([_1, articleA], [_2, articleB]) => {
      if (articleA.enrichedStatus?.isAssignedToCurrentUser) return -1;
      if (articleB.enrichedStatus?.isAssignedToCurrentUser) return 1;
      return articleA.date - articleB.date;
    })
  );
});
</script>
