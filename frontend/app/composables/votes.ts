import { computed, type MaybeRef } from "vue";
import {
  getFirestore,
  doc,
  setDoc,
  where,
  collection,
  query,
} from "firebase/firestore";
import { useDocument, useFirebaseApp } from "vuefire";
import { useAuthState } from "./auth";

type AggregatedVotes = Record<string, number>;

type VoteDocument = {
  nodeId: string;
  userUid: string;
  categoryVotes: Record<string, number>;
};

export function useVotes(nodeID: MaybeRef<string>) {
  const { user } = useAuthState();
  const firebaseApp = useFirebaseApp();
  const db = getFirestore(firebaseApp, "koryta-pl");

  const nodeRef = toValue(nodeID);

  const voteNodeUserRef = computed(() => {
    if (!user.value) return null;
    return doc(db, "votes", `${nodeRef}_${user.value.uid}`);
  });
  const voteNodeUserDoc = useDocument(voteNodeUserRef);

  const userCategoryVotes = computed(() => {
    return voteNodeUserDoc.value?.categoryVotes || {};
  });

  const votesNodeRef = computed(() => {
    return query(collection(db, "votes"), where("nodeId", "==", nodeRef));
  });

  const votesNodeCollection = useCollection(votesNodeRef, {
    wait: true,
  });
  const nodeCategoryVotes = computed(() => {
    return votesNodeCollection.value.reduce((acc: AggregatedVotes, doc) => {
      const data = doc.data() as VoteDocument;
      const categoryVotes = data.categoryVotes;
      Object.entries(categoryVotes).forEach(([category, value]) => {
        acc[category] = (acc[category] || 0) + value;
      });
      return acc;
    }, {} as AggregatedVotes);
  });

  // Expose function to cast or toggle a vote
  const castVote = async (category: string, value: number) => {
    if (!user.value) throw new Error("User needs to log in");

    const currentVote = userCategoryVotes.value[category];
    const newValue = (currentVote ?? 0) + value;

    await setDoc(
      doc(db, "votes", `${nodeRef}_${user.value.uid}`),
      {
        nodeId: nodeRef,
        userUid: user.value.uid,
        categoryVotes: {
          [category]: newValue,
        },
      } as VoteDocument,
      // Use merge:true to preserve existing votes
      { merge: true },
    );
  };

  return {
    userCategoryVotes,
    nodeCategoryVotes,
    castVote,
  };
}
