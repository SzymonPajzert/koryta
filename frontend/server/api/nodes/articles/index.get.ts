import { authCachedEventHandler } from "~~/server/utils/handlers";
import { getFirestore } from "firebase-admin/firestore";

export type SourceStat = {
  domain: string;
  articleCount: number;
  peopleCount: number;
  people: Array<string>;
  url: string | undefined;
};

export default authCachedEventHandler(async () => {
  const db = getFirestore("koryta-pl");
  const statsSnap = await db
    .collection("stats")
    .where("type", "==", "domain_articles")
    .get();

  const sourceStats: SourceStat[] = statsSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      domain: data.domain,
      articleCount: data.articleCount,
      peopleCount: data.peopleCount,
      people: data.people || [],
      url: data.url,
    };
  });

  // Sort descending by the number of people
  sourceStats.sort((a, b) => b.peopleCount - a.peopleCount);

  return sourceStats;
});
