import { z } from "zod";
import { parseNodeDoc } from "~~/server/utils/fetch";
import { getFirestore } from "firebase-admin/firestore";
import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import { getValidatedQuery } from "h3";
import {
  anchorToken,
  nameMatchesTokens,
  nameWords,
  searchTokens,
} from "~~/shared/search";

const queryValidator = z.object({
  q: z.string().optional().default(""),
  limit: z.coerce.number().optional().default(20),
});

type node = {
  id: string;
  name: string;
  type: string;
  teryt?: string;
  visibility: boolean;
};

/** How far down the anchor's hit list a multi-word query reads.
 *
 * Firestore has one `array-contains` slot per query, so several words are
 * answered by matching the rarest of them and checking the rest against the
 * names that come back - which only reaches as far as this window. It is
 * ordered by node group size, so what falls off the end is the least connected
 * of the loose matches, and 500 is well clear of the largest bucket any one
 * word has today: the whole searchable collection is under 12k documents, and
 * the commonest given name in it is carried by about 400.
 */
const MULTI_WORD_SCAN_LIMIT = 500;

// Whoever is signed in is the one who may have just created the person they
// are searching for, and the picker searches before it offers to create - so
// the miss is already in the cache by the time they look again.
export default editorFreshCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const db = getFirestore("koryta-pl");

  const tokens = searchTokens(query.q);

  const byChunk = (chunk: string, limit: number) =>
    db
      .collection("nodes")
      .where("type", "in", ["person", "place", "region"])
      // It's set by the function / computeNodes
      .where("nameChunksLower", "array-contains", chunk)
      .orderBy("stats.nodeGroupSize", "desc")
      .limit(limit)
      .get();

  // What the index answers by itself: everything the typed text is a prefix
  // of, whole name or single word. An empty query is the top of the
  // collection, "" being a chunk of every node.
  const passes = [byChunk(tokens.join(" "), query.limit)];

  // The rest of a multi-word query, which the index cannot answer because it
  // holds no chunk spanning a word the searcher skipped - a middle name, most
  // of the time. Anchor on one word, check the others here. Run alongside the
  // pass above rather than instead of it, so that whatever the index could
  // already find is still found, and found first: an exact prefix of the name
  // is a better hit than a name with something in the middle of it.
  //
  // Words as the hyphen cuts them too, so "kupczak-wiśniowska" anchors on
  // "wiśniowska" and reaches the page still titled "Kupczak Wiśniowska", which
  // carries no chunk with the hyphen in it; and "kupczak wiśniowska" reaches
  // the page titled with the hyphen, whose whole name is no chunk of that.
  const words = nameWords(query.q);
  if (words.length > 1) {
    passes.push(byChunk(anchorToken(words), MULTI_WORD_SCAN_LIMIT));
  }

  const snapshots = await Promise.all(passes);

  const results: node[] = [];
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      const node = parseNodeDoc<node>(doc);
      if (seen.has(node.id)) continue;
      // A page that has been removed, or folded into another as a duplicate,
      // is not a search hit. It keeps its `nameChunksLower` - nothing clears
      // them, and the trigger keeps them in step with the name it still has -
      // so without this a merged duplicate goes on being offered under the name
      // it had, and the reader gets a redirect to a page they were not looking
      // for. Not `pageIsPublic`: an unpublished page is a legitimate hit here,
      // because whoever is signed in may have just created it.
      if (doc.data().deleted === true) continue;
      if (!nameMatchesTokens(node.name, tokens)) continue;
      seen.add(node.id);
      results.push(node);
    }
  }

  return results.slice(0, query.limit).map((node) => {
    // The query that opens the table on this hit, for the node kinds whose
    // page *is* the table. A region is one. A place stopped being one when
    // companies got their pages back: `generateEntityUrl` sends a search hit
    // straight to /instytucja/..., which is where who works there and who they
    // replaced actually live - the table filtered to one company only ever
    // listed its people.
    const query: Record<string, string> = {};
    if (node.teryt) query.teryt = node.teryt;

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      ...(Object.keys(query).length > 0 ? { query } : {}),
    };
  });
});
