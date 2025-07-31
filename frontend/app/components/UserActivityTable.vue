<template>
  <v-table>
    <thead>
      <tr>
        <th class="text-left">Użytkownik</th>
        <th class="text-left">Dodane artykuły</th>
        <th class="text-left">Dodane osoby</th>
        <th class="text-left">Zasugerowane poprawy strony</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="item in userActivityStats" :key="item.id">
        <td>{{ item.name }}</td>
        <td>{{ item.dataCount }}</td>
        <td>{{ item.employedCount }}</td>
        <td>{{ item.improvementCount }}</td>
      </tr>
    </tbody>
  </v-table>
</template>

<script lang="ts" setup>
import { useRTDB } from "@vueuse/firebase/useRTDB";
import { computed, type WatchHandle } from "vue";
import { useAuthState } from "@/composables/auth"; // Assuming auth store path
import { ref as dbRef } from "firebase/database";
import { db } from "@/firebase";
const { user, isAdmin } = useAuthState();

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

const allUsersData = computed<Record<string, UserProfileData> | undefined>(
  () => {
    if (!user.value) return;
    if (isAdmin.value) {
      return useRTDB<Record<string, UserProfileData>>(dbRef(db, "user")).value;
    }

    const uid = user.value.uid;
    const userData = useRTDB<UserProfileData>(dbRef(db, `user/${uid}`));
    return computed(() => {
      if (!userData.value) return;
      const result: Record<string, UserProfileData> = {};
      result[uid] = userData.value;
      return result;
    }).value;
  },
);

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
    const userName =
      userData.displayName ||
      (uid == user.value?.uid ? user.value?.displayName || uid : uid);

    stats.push({
      id: uid,
      name: userName,
      dataCount,
      employedCount,
      improvementCount,
    });
  }
  return stats.sort(
    (a, b) =>
      b.dataCount +
      b.employedCount +
      b.improvementCount -
      (a.dataCount + a.employedCount + a.improvementCount),
  );
});
</script>
