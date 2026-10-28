import { z } from "zod";
import { parseNodeDoc } from "~~/server/utils/fetch";
import { getFirestore } from "firebase-admin/firestore";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { getValidatedQuery } from "h3";
import {
  anchorChunk,
  krsNumberQuery,
  nameMatchesTokens,
  nameWords,
  nextAnchorChunk,
  reachesBeyondTown,
  searchTokens,
  townChunk,
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
  /** The KRS number the query was, on a hit found by it rather than by name. */
  matchedKrs?: string;
};

/** How far down the anchor's hit list a multi-word query reads.
 *
 * Firestore has one `array-contains` slot per query, so several words are
 * answered by matching the rarest of them and checking the rest against the
 * names that come back - which only reaches as far as this window. It is
 * ordered by node group size, so what falls off the end is the least connected
 * of the loose matches. Some buckets are larger: of the 22,806 searchable
 * documents of 2026-10-28, „gmina” carries 987, „przedsiębiorstwo” 788,
 * „piotr” 676, and the town of Warsaw 1,314. A pass that comes back full is
 * followed by one on the next word typed (`nextAnchorChunk`).
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
  const whole = byChunk(
    tokens.join(" "),
    includeDrafts ? query.limit : Math.max(query.limit, PUBLIC_SCAN_LIMIT),
  );

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
  //
  // And the same word as a word of a town: the town in the bracket a company
  // name ends in is held apart from its name's words (`QUALIFIER` in
  // shared/search.ts), so „sanikom lubawka”, anchored on „lubawka”, reaches
  // the company based there only this way. Only for a query of several words,
  // which is what keeps every company in Kraków out of the answer to „kraków”.
  // An anchor no town is called by, a surname mostly, costs the one read a
  // query that finds nothing does.
  const anchor =
    nameWords(query.q).length > 1 ? anchorChunk(tokens) : undefined;
  const byWord = (chunk: string) =>
    Promise.all([
      byChunk(chunk, MULTI_WORD_SCAN_LIMIT),
      byChunk(townChunk(chunk), MULTI_WORD_SCAN_LIMIT),
    ]);

  // A KRS number pasted whole is answered by the company that carries it, ahead
  // of anything the name index makes of the digits - which is nothing, as no
  // name holds one. Somebody holding the number has the company in front of
  // them, and its name may be one the index cannot reach the way they would
  // spell it. The name passes still run: they cost one read when they find
  // nothing.
  const krs = krsNumberQuery(query.q);
  const byKrs = krs
    ? db.collection("nodes").where("krsNumber", "==", krs).limit(5).get()
    : undefined;

  const [krsSnapshot, wholeSnapshot, anchored] = await Promise.all([
    byKrs,
    whole,
    anchor === undefined ? undefined : byWord(anchor),
  ]);

  // The hits in three groups, ranked in this order: what the KRS number
  // found, what the words of a name found, and what only its town found - each
  // in the order the index gave it. Town hits last, because they answer the
  // town typed: while a reader is still typing „piotr w” on the way to a
  // surname, the companies of Piotrków Trybunalski in liquidation („W
  // LIKWIDACJI”) answer it too, and would otherwise go ahead of the people.
  const byNumber: node[] = [];
  const byName: node[] = [];
  const byTown: node[] = [];
  const seen = new Set<string>();
  for (const doc of krsSnapshot?.docs ?? []) {
    const node = parseNodeDoc<node>(doc);
    if (seen.has(node.id) || doc.data().deleted === true) continue;
    if (!includeDrafts && !node.visibility) continue;
    seen.add(node.id);
    byNumber.push({ ...node, matchedKrs: krs });
  }
  const take = (snapshot: FirebaseFirestore.QuerySnapshot, town: boolean) => {
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
      // may have just created it. A logged out reader is offered every
      // unpublished person too, and nothing else unpublished. The person they
      // typed is who they came for, and the page it opens is where the site
      // asks them to sign in: with a teaser of the name and the latest post
      // where an import wrote the page or a reviewer approved it
      // (`/api/nodes/[id]/teaser`), with the sign-in card alone where somebody
      // added it by hand. Either way the box gives away the name and nothing
      // else.
      //
      // Not `importedOrReviewed`, which the teaser asks before it shows a
      // post: in front of the box it hid every page added by hand, the people
      // added because readers had searched for them among them.
      if (!includeDrafts && !node.visibility && node.type !== "person") {
        continue;
      }
      if (!nameMatchesTokens(node.name, tokens)) continue;
      // Reached through its town, a hit has to answer something besides the
      // town: „jelenia góra” is two words, and every company based there
      // answers both (`reachesBeyondTown`).
      if (town && !reachesBeyondTown(node.name, node.type, tokens)) continue;
      seen.add(node.id);
      (town ? byTown : byName).push(node);
    }
  };
  take(wholeSnapshot, false);
  if (anchored) {
    take(anchored[0], false);
    take(anchored[1], true);
  }

  // One more word where a pass on the anchor was cut off before its end
  // (`MULTI_WORD_SCAN_LIMIT`): „paged warszawa” reaches the PAGED companies
  // past the 500th of Warsaw's by „paged”. After the passes above rather than
  // beside them, so that only a query that fills one pays for it.
  const cutOff = anchored?.some(
    (snapshot) => snapshot.size >= MULTI_WORD_SCAN_LIMIT,
  );
  const next = cutOff ? nextAnchorChunk(tokens) : undefined;
  if (next !== undefined) {
    const [plain, town] = await byWord(next);
    take(plain, false);
    take(town, true);
  }

  // Published pages first for a logged out reader, within each group. Nine in
  // ten people are unpublished, so the top twenty of a common name would
  // otherwise be twenty teasers with the one full page that answers the
  // question below them.
  const publishedFirst = (hits: node[]) =>
    includeDrafts
      ? hits
      : [
          ...hits.filter((node) => node.visibility),
          ...hits.filter((node) => !node.visibility),
        ];
  const ranked = [
    ...byNumber,
    ...publishedFirst(byName),
    ...publishedFirst(byTown),
  ];

  return ranked.slice(0, query.limit).map((node) => {
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
      // So the search box keeps the hit: its own filter matches what was
      // typed against the name, and no name holds the number.
      ...(node.matchedKrs ? { krsNumber: node.matchedKrs } : {}),
    };
  });
});
