import { getFirestore } from "firebase-admin/firestore";
import { getUser } from "~~/server/utils/auth";

export type ContributionStats = {
  votes: number;
  notes: number;
  revisions: number;
};

/** Counts of the requesting user's contributions: votes cast, notes written
 * and change proposals submitted. Used to show people how much they helped
 * with the data tagging effort. */
export default defineEventHandler(async (event): Promise<ContributionStats> => {
  const user = await getUser(event);
  const db = getFirestore("koryta-pl");

  const [votes, notes, revisions] = await Promise.all([
    db.collection("votes").where("userUid", "==", user.uid).count().get(),
    db.collection("notes").where("userUid", "==", user.uid).count().get(),
    db
      .collection("revisions")
      .where("update_user", "==", user.uid)
      .count()
      .get(),
  ]);

  return {
    votes: votes.data().count,
    notes: notes.data().count,
    revisions: revisions.data().count,
  };
});
