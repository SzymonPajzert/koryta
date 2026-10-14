import { z } from "zod";
import { parseNodeDoc } from "~~/server/utils/fetch";
import { getFirestore } from "firebase-admin/firestore";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { getValidatedQuery } from "h3";
import { importedOrReviewed } from "~~/server/utils/provenance";
import {
  anchorChunk,
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
  revision_id?: unknown;
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

/** How far down the hit list a reader who may not see drafts is answered from.
 *
 * Their hits are filtered and reordered after the query - no index puts
 * `published` beside `nameChunksLower`, and adding one would have to be
 * deployed before the code that needs it - and most people in the base are
 * unpublished, so the top twenty of a common name can be twenty drafts. A wider
 * window keeps the published namesakes behind them reachable, and in front of
 * them once ranked; it is paid once per query, which the cache then holds for
 * every logged out reader typing the same thing.
 */
const PUBLIC_SCAN_LIMIT = 200;

// Whoever is signed in is the one who may have just created the person they
// are searching for, and the picker searches before it offers to create - so
// the miss is already in the cache by the time they look again.
export default editorFreshCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const includeDrafts = await wantsLatest(event);
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
  const passes = [
    byChunk(
      tokens.join(" "),
      includeDrafts ? query.limit : Math.max(query.limit, PUBLIC_SCAN_LIMIT),
    ),
  ];

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
  // Which word to anchor on is still decided as typed (`anchorChunk`).
  if (nameWords(query.q).length > 1) {
    passes.push(byChunk(anchorChunk(tokens), MULTI_WORD_SCAN_LIMIT));
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
      // for.
      if (doc.data().deleted === true) continue;
      // An unpublished page is a legitimate hit for a signed in reader, who
      // may have just created it. A logged out reader is offered unpublished
      // people too, and nothing else unpublished: a person's page answers them
      // with a teaser - the name and the latest post, never a party - and a
      // way to sign in for the rest (`/api/nodes/[id]/teaser`), where a
      // company's or a region's would only be a 404. Only the people an import
      // wrote or a reviewer approved, which is decided below.
      if (!includeDrafts && !node.visibility && node.type !== "person") {
        continue;
      }
      if (!nameMatchesTokens(node.name, tokens)) continue;
      seen.add(node.id);
      results.push(node);
    }
  }

  // Published pages first for a logged out reader, each group in the order the
  // index gave it. Nine in ten people are unpublished, so the top twenty of a
  // common name would otherwise be twenty teasers with the one full page that
  // answers the question below them.
  const ranked = includeDrafts
    ? results
    : [
        ...results.filter((node) => node.visibility),
        ...results.filter((node) => !node.visibility),
      ];

  // The drafts a logged out reader is shown are those the teaser would show:
  // somebody's proposal of a person is a name on this site that nobody has
  // checked, and stays a 404 - see `importedOrReviewed`. Asked only of the
  // drafts that would be answered, at a read each; the cache then keeps the
  // answer for everybody typing the same thing.
  const window = ranked.slice(0, query.limit);
  const shownDrafts = includeDrafts
    ? undefined
    : await importedOrReviewed(
        db,
        window.filter((node) => !node.visibility),
      );
  const answered = shownDrafts
    ? window.filter((node) => node.visibility || shownDrafts.has(node.id))
    : window;

  return answered.map((node) => {
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
      // So the search box can tell a logged out reader which hits are a
      // teaser rather than a page, before they click.
      published: node.visibility,
      ...(Object.keys(query).length > 0 ? { query } : {}),
    };
  });
});
