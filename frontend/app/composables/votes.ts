import {
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiHelpCircleOutline,
  mdiLightbulbOutline,
} from "@mdi/js";
import { computed, type MaybeRef } from "vue";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { useCurrentUser, useDocument, useFirebaseApp } from "vuefire";
import { useAuthState } from "./auth";
import type { VoteCategory, VoteDocument } from "~~/shared/model";

const configMap: Record<
  VoteCategory,
  { text: string; icon: string; color: string; downColor: string }
> = {
  interesting: {
    text: "Dobre znalezisko",
    icon: mdiLightbulbOutline,
    color: "success",
    downColor: "error",
  },
  quality: {
    text: "Znaleziony problem",
    icon: mdiAlertCircleOutline,
    color: "error",
    downColor: "success",
  },
  correct: {
    text: "Poprawny fakt",
    icon: mdiCheckCircleOutline,
    color: "success",
    downColor: "error",
  },
  insufficient: {
    text: "Za mało informacji",
    icon: mdiHelpCircleOutline,
    color: "warning",
    downColor: "warning",
  },
};

/** A vote targets a graph node or an extraction fact; the target picks which
 * id field is set, so the id itself never needs inspecting. */
export type VoteTarget = "node" | "extraction";

export function useVotes(
  targetId: MaybeRef<string>,
  category: VoteCategory,
  target: VoteTarget = "node",
) {
  const { user } = useAuthState();
  const firebaseApp = useFirebaseApp();
  const db = getFirestore(firebaseApp, "koryta-pl");
  const config = configMap[category];

  const idValue = computed(() => toValue(targetId));

  const voteNodeUserRef = computed(() => {
    if (!user.value) return null;
    return doc(db, "votes", `${idValue.value}_${user.value.uid}`);
  });
  const voteNodeUserDoc = useDocument(voteNodeUserRef);

  const userCategoryVotes = computed(() => {
    return voteNodeUserDoc.value?.categoryVotes || {};
  });

  const router = useRouter();
  const route = useRoute();
  const loading = ref(false);

  // Expose function to cast or toggle a vote
  const castVote = async (value: number) => {
    if (!user.value) {
      router.push({
        path: "/login",
        query: { redirect: route.fullPath },
      });
      return;
    }

    loading.value = true;
    const currentVote = userCategoryVotes.value[category] ?? 0;
    const newValue = Math.max(-5, Math.min(5, currentVote + value));

    if (newValue === currentVote) {
      loading.value = false;
      return;
    }

    setDoc(
      doc(db, "votes", `${idValue.value}_${user.value.uid}`),
      {
        [target === "extraction" ? "extractionId" : "nodeId"]: idValue.value,
        userUid: user.value.uid,
        categoryVotes: {
          [category]: newValue,
        },
        updatedAt: new Date().toISOString(),
      } as VoteDocument,
      // Use merge:true to preserve existing votes
      { merge: true },
    );
    loading.value = false;
  };

  return {
    userCategoryVotes,
    config,
    loading,
    castVote,
  };
}

/** Fire-and-forget vote write that opens no Firestore listeners.
 *
 * `useVotes` sets up live `useDocument`/`useCollection` subscriptions, which
 * are bound to the current effect scope for cleanup. Calling it from an event
 * handler (outside any component setup scope) leaks a listener on every call.
 * Use this for one-shot writes such as the review flow, where the reactive
 * state is not needed. Returns false if there is no signed-in user. */
export async function castVoteOnce(
  targetId: string,
  category: VoteCategory,
  value: number,
  target: VoteTarget = "node",
): Promise<boolean> {
  const user = useCurrentUser();
  if (!user.value) return false;

  const firebaseApp = useFirebaseApp();
  const db = getFirestore(firebaseApp, "koryta-pl");
  const clamped = Math.max(-5, Math.min(5, value));

  await setDoc(
    doc(db, "votes", `${targetId}_${user.value.uid}`),
    {
      [target === "extraction" ? "extractionId" : "nodeId"]: targetId,
      userUid: user.value.uid,
      categoryVotes: { [category]: clamped },
      updatedAt: new Date().toISOString(),
    } as VoteDocument,
    // Use merge:true to preserve existing votes in other categories.
    { merge: true },
  );
  return true;
}
