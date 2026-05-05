import { getFirestore } from "firebase-admin/firestore";
import { getUser } from "~~/server/utils/auth";
import { getEdges } from "~~/shared/graph/util";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import type { Article } from "~~/shared/model";
import type { SourceStat } from "~~/server/api/nodes/articles.get";

export default defineEventHandler(async (event) => {
  // Only authenticated or authorized actors should trigger a recalculation.
  // When setting up the Cloud Function later, ensure it passes a valid Identity Token.
  await getUser(event);

  const articles = await fetchNodes("article");
  const [edgesFromDB] = await Promise.all([fetchEdges()]);
  const edges = getEdges(edgesFromDB);

  const articleCounts: Record<string, number> = {};
  const domainMap: Record<string, string> = {}; // domain -> full url sample
  const domainPeople: Record<string, Set<string>> = {};
  const articleToDomain = new Map<string, string>();

  Object.entries(articles).forEach(([id, article]) => {
    const art = article as Article;
    if (!art.sourceURL) return;

    let url: URL;
    try {
      url = new URL(art.sourceURL);
    } catch {
      return; // Invalid URLs are skipped
    }

    const domain = url.hostname.replace("www.", "");

    articleCounts[domain] = (articleCounts[domain] || 0) + 1;
    if (!domainMap[domain]) domainMap[domain] = url.origin;
    if (!domainPeople[domain]) domainPeople[domain] = new Set();

    articleToDomain.set(id, domain);
  });

  edges.forEach((edge) => {
    if (articleToDomain.has(edge.source)) {
      const domain = articleToDomain.get(edge.source)!;
      domainPeople[domain]?.add(edge.target);
    }
    if (articleToDomain.has(edge.target)) {
      const domain = articleToDomain.get(edge.target)!;
      domainPeople[domain]?.add(edge.source);
    }
  });

  const sourceStats: SourceStat[] = Object.entries(domainPeople)
    .sort((a, b) => b[1].size - a[1].size) // Sort desc
    .map(([domain, peopleSet]) => ({
      domain,
      articleCount: articleCounts[domain] || 0,
      peopleCount: peopleSet.size || 0,
      people: Array.from(peopleSet.values()),
      url: domainMap[domain],
    }));

  const db = getFirestore("koryta-pl");

  // Firestore batches are limited to 500 writes
  const chunks = [];
  for (let i = 0; i < sourceStats.length; i += 500) {
    chunks.push(sourceStats.slice(i, i + 500));
  }

  for (const chunk of chunks) {
    const batch = db.batch();
    for (const stat of chunk) {
      // Convert domain (e.g. onet.pl) into a safe firestore ID
      const safeId = stat.domain.replace(/[^a-zA-Z0-9_-]/g, "_");
      const docRef = db.collection("stats").doc(`domain_articles_${safeId}`);
      batch.set(docRef, {
        id: stat.domain,
        type: "domain_articles",
        ...stat,
      });
    }
    await batch.commit();
  }

  return { status: "success", computedDomains: sourceStats.length };
});
