<template>
  <v-row>
    <KPOResult
      v-for="submission in submissions"
      :key="submission.id"
      :submission="submission"
      :submission-admin="{ title: 'TODO' }"
    />
  </v-row>
</template>

<script setup lang="ts">
import { ref as dbRef } from "firebase/database";

definePageMeta({
  title: "Ranking KPO",
  middleware: "admin",
});

const { submissions: allSubmissions } = useKPO();
const db = useDatabase();

const userData = useDatabaseObject(dbRef(db, "user/"));

const totalScores = computed(() => {
  const results = new Map<string, number>();
  if (!userData.value) return results;
  Object.values(userData.value).forEach((value) => {
    if (!value) return;
    if (!value["kpo"]) return;
    if (!value["kpo"]["scores"]) return;
    Object.entries(value["kpo"]["scores"]).forEach(
      ([key, value]: [string, number]) => {
        if (!results.has(key)) {
          results.set(key, 0);
        }
        results.set(key, results.get(key)! + value);
      }
    );
  });

  return results;
});

const submissions = computed(() => {
  if (!allSubmissions.value) return [];
  const scores = totalScores.value;
  return allSubmissions.value
    .map((s) => ({ ...s, score: scores.get(`${s.id}`) ?? 0 }))
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (a.admin?.approved && !b.admin?.approved) return -1;
      if (!a.admin?.approved && b.admin?.approved) return 1;
      return b.score - a.score
    });
});
</script>
