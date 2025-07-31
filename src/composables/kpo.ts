import { db } from "@/firebase";
import { ref as dbRef } from "firebase/database";
import { useRTDB } from "@vueuse/firebase";
import { useAuthState } from "@/composables/auth";

export type Submission = {
  id: string;
  content: string;
  title: string;
};

export function useKPO() {
  const { user } = useAuthState();

  const submissionsRecord = useRTDB<Record<string, Submission>>(
    dbRef(db, "/external/kpo"),
  );
  const scores = computed(() => {
    if (!user.value?.uid) return {};

    const scores = useRTDB<Record<string, number>>(
      dbRef(db, `/user/${user.value?.uid}/kpo/scores`),
    );
    return scores.value ?? {};
  });

  function shuffle<T>(array: T[]) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  const submissions = computed<Submission[]>(() => {
    if (!submissionsRecord.value) return [];
    const values = Object.values(submissionsRecord.value);
    return shuffle(values);
  });

  const submissionsLength = computed(() => {
    if (!submissions.value) return 0;
    return submissions.value.length;
  });

  return { submissions, scores, submissionsLength };
}
