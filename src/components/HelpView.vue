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
    <!-- TODO split into two subcomponents -->
    <v-col v-for="(article, articleId) in articles" :key="articleId" cols="12" md="6">
      <v-card
        v-if="!article.enrichedStatus?.hideArticle"
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
          <v-spacer></v-spacer>
          <!-- TODO The color is currently ignored -->
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
      <v-table>
        <thead>
          <tr>
            <th class="text-left">
              Użytkownik
            </th>
            <th class="text-left">
              Dodane artykuły
            </th>
            <th class="text-left">
              Dodane osoby
            </th>
            <th class="text-left">
              Zasugerowane poprawy strony
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in userActivityStats"
            :key="item.id"
          >
            <td>{{ item.name }}</td>
            <td>{{ item.dataCount }}</td>
            <td>{{ item.employedCount }}</td>
            <td>{{ item.improvementCount }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
import { useReadDB } from '@/composables/staticDB';
const { watchPath } = useReadDB();
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

interface UserSuggestionTypes {
  data?: Record<string, any>;
  employed?: Record<string, any>;
  improvement?: Record<string, any>;
}

interface UserProfileData {
  suggestions?: UserSuggestionTypes;
  displayName?: string; // Assuming displayName might exist for users
}

interface UserActivityStat {
  id: string; // UID
  name: string; // displayName or UID
  dataCount: number;
  employedCount: number;
  improvementCount: number;
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

const allArticlesUnfiltered = watchPath<Record<string, SubmittedData>>('data')
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

const allUsersData = useRTDB(dbRef(db, 'user'));
const userActivityStats = computed<UserActivityStat[]>(() => {
  if (!allUsersData.value) {
    return [];
  }

  const stats: UserActivityStat[] = [];
  for (const uid in allUsersData.value) {
    const userData = allUsersData.value[uid];
    const suggestions = userData.suggestions || {};

    const dataCount = Object.keys(suggestions.data || {}).length;
    const employedCount = Object.keys(suggestions.employed || {}).length;
    const improvementCount = Object.keys(suggestions.improvement || {}).length;

    // Use displayName if available, otherwise fallback to UID
    const userName = userData.displayName || uid;

    stats.push({
      id: uid,
      name: userName,
      dataCount,
      employedCount,
      improvementCount,
    });
  }
  return stats.sort((a, b) => (b.dataCount + b.employedCount + b.improvementCount) - (a.dataCount + a.employedCount + a.improvementCount));
});
</script>
