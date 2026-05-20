import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { logEventPath } from "~~/server/utils/fetch";
import type { VoteDocument } from "~~/shared/model";

export default defineEventHandler(async (event) => {
  const db = getFirestore(getApp(), "koryta-pl");
  
  const votesSnapshot = await db.collection("votes").get();
  const votes = votesSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  })) as (VoteDocument & { id: string })[];

  logEventPath("fetchVotes", "all", { collection: "votes", size: votes.length });

  return votes;
});
