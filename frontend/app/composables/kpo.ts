import { ref as dbRef } from "firebase/database";
import { useRTDB } from "@vueuse/firebase";
import { useAuthState } from "@/composables/auth";
import type { KPOSubmission } from "~~/shared/model";

export function useKPO() {
  const db = useDatabase();
  const { user } = useAuthState();

  const submissionsRecord = useRTDB<Record<string, KPOSubmission>>(
    dbRef(db, "/external/kpo"),
  );
  const submissionsAdmin = useRTDB<Record<string, KPOSubmission["admin"]>>(
    dbRef(db, "/admin/kpo"),
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

  const submissions = computed<KPOSubmission[]>(() => {
    if (!submissionsRecord.value) return [];
    const admins = submissionsAdmin.value ?? {};
    const values = shuffle(Object.values(submissionsRecord.value));
    return values.map(v => {
      v.admin = admins[v.id];
      return v;
    });
  });

  const submissionsLength = computed(() => {
    if (!submissions.value) return 0;
    return submissions.value.length;
  });

  return { submissions, scores, submissionsLength };
}
