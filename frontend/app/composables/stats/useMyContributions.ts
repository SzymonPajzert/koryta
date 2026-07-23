import { getFirestore, collection, query, where } from "firebase/firestore";
import { useCollection, useFirebaseApp } from "vuefire";
import { useAuthState, authRequest } from "../auth";
import type { ContributionStats } from "~~/server/api/stats/contributions.get";

/** Live counts of the current user's contributions.
 *
 * Votes and notes are observed directly in Firestore so the counters tick up
 * immediately after the user acts; revisions are not client-readable, so their
 * count comes from /api/stats/contributions.
 */
export function useMyContributions() {
  const { user } = useAuthState();
  const firebaseApp = useFirebaseApp();
  const db = getFirestore(firebaseApp, "koryta-pl");

  const votesQuery = computed(() =>
    user.value
      ? query(collection(db, "votes"), where("userUid", "==", user.value.uid))
      : null,
  );
  const notesQuery = computed(() =>
    user.value
      ? query(collection(db, "notes"), where("userUid", "==", user.value.uid))
      : null,
  );
  const votes = useCollection(votesQuery);
  const notes = useCollection(notesQuery);

  const { data: serverStats } = useAsyncData(
    "my-contributions",
    async () =>
      user.value
        ? await authRequest<ContributionStats>("/api/stats/contributions", {
            method: "GET",
          })
        : null,
    { watch: [user], server: false },
  );

  return {
    user,
    votesCount: computed(() => votes.value.length),
    notesCount: computed(() => notes.value.length),
    revisionsCount: computed(() => serverStats.value?.revisions ?? 0),
  };
}
