import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { resolveMergedNode } from "~~/server/utils/merge";
import { isKnownBadge, type BadgeTally } from "~~/shared/badges";

/** The two fields a badge is drawn from, and nothing else off the node.
 *
 * `badges` is `stats.badges` - counts of people, written by `computeBadgeStats`
 * (shared/stats.ts) from the `votes` collection. `moderation` is
 * `badgeModeration` - the editor's verdict per badge, written by the POST next
 * to this file. Together they are the whole input to `visibleBadges`.
 */
export type NodeBadges = {
  badges: Record<string, BadgeTally>;
  moderation: Record<string, "approved" | "hidden">;
};

/** How the badge tallies on one person stand *right now*.
 *
 * # Why this exists when `/api/nodes/[id]` already carries both fields
 *
 * Because that endpoint cannot answer „right now”. It is an
 * `authCachedEventHandler`, and `eventIsAuthenticated` in
 * server/utils/handlers.ts:5-7 is stubbed to `return false` - the real
 * implementation is commented out above it - so `shouldBypassCache` never fires
 * and a signed-in reader is served the same `swr` entry as a crawler, keyed by
 * url and held for `maxAge: 21600`, i.e. six hours. `?latest=true` does not get
 * round it either: it is a different cache key, not a bypass, so the signed-in
 * branch has a six-hour entry of its own.
 *
 * That is tolerable for a name, a `content` paragraph or a party list, which
 * change when an editor saves a revision and not otherwise. It is not tolerable
 * for the one number a reader has just changed by clicking: they vote, the
 * counter moves by the optimistic delta `BadgePersonSection` holds, they reload
 * the page, and the count is back to what it was before - for up to six hours,
 * with no way to tell the vote was recorded. The only feedback the feature
 * gives disappears exactly when it is checked.
 *
 * Fixing it in the wrapper was the other option and is deliberately not taken.
 * `eventIsAuthenticated` decides for *every* handler built on
 * `authCachedEventHandler`, including the aggregate routes that are this
 * project's documented Firestore cost centres - dropping the cache for every
 * signed-in caller of all of them is a change of a different size and a
 * different bill (see `editorFreshCachedEventHandler`'s own note: `latest=true`
 * being on by default already cost 111,000 reads in a 28-hour sample).
 *
 * # Why it is this narrow
 *
 * Two maps of at most five keys each, rather than the node. `stats.badges` is
 * written by `computeBadgeStats`, which counts catalogue ids only, and
 * `badgeModeration` is keyed by the same five - so the whole answer is 32 bytes
 * empty and 268 bytes with every badge tallied and two verdicts filed, against
 * 1,503 and 1,935 bytes for two person pages measured on the live site on
 * 2026-09-12 (`GET https://koryta.pl/api/nodes/<id>`). It also costs strictly
 * less at the database: one document read, where the signed-in branch of
 * `/api/nodes/[id]` spends a `revisions` query on top of the same read.
 *
 * Narrow in what it may leak, too, and that is the harder constraint. Badge
 * votes live in `votes/${nodeId}_${uid}` and a *tally* is the only part of them
 * that is public arithmetic; this handler never opens the `votes` collection,
 * so there is no shape of bug here that can name who voted. Everything it
 * returns is already in the payload a logged-out visitor gets from
 * `/api/nodes/[id]` - it is the same two fields, only fresher.
 *
 * # Why it still asks for a login
 *
 * Not to protect the numbers - see above - but to bound the reads. A cached
 * endpoint costs one read per six hours per url no matter how much traffic
 * arrives; this one costs a read per call, and the person pages are the most
 * crawled part of the site. `getUser` before any Firestore call means an
 * anonymous request - a crawler, a scraper, a scripted loop - is refused
 * without touching the database at all, and the bill is capped by the number of
 * signed-in readers, who are also the only people who can see the section that
 * calls it (`BadgePersonSection` renders nothing without `user`).
 *
 * Merged pages resolve like everywhere else: `resolveMergedNode` is what
 * `/api/nodes/[id]` reads through, so a duplicate's url answers with the
 * survivor's tallies instead of contradicting the chips drawn from the same
 * node in the page header. It is one read for an unmerged node, which is
 * nearly all of them.
 */
export default defineEventHandler(async (event): Promise<NodeBadges> => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak id strony." });
  }

  // Before the read, not after it: an unauthenticated call must cost nothing.
  await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const { snapshot } = await resolveMergedNode(db, id);
  if (!snapshot?.exists) {
    throw createError({
      statusCode: 404,
      message: `Nie ma strony o id: ${id}`,
    });
  }

  const stored = snapshot.data() ?? {};
  return {
    badges: readTallies(
      (stored.stats as { badges?: unknown } | undefined)?.badges,
    ),
    moderation: readModeration(stored.badgeModeration),
  };
});

/** `stats.badges` as the client may rely on it: catalogue ids, integers.
 *
 * Rebuilt key by key rather than passed through, because what is being passed
 * through is a document that `onVoteWritten` writes from client-supplied map
 * keys. `visibleBadges` is tolerant of a malformed tally by design
 * (shared/badges.ts), and this is the belt to that pair of braces: an id nobody
 * can render and a `down` that arrived as a string both stop here rather than
 * being handed to five different call sites to be defensive about separately.
 *
 * Retired badges pass, like everywhere else - they are `isKnownBadge`, their
 * tallies keep being counted so retiring stays reversible, and `visibleBadges`
 * is the one place that decides they draw no chip.
 */
function readTallies(value: unknown): Record<string, BadgeTally> {
  const source = (value ?? {}) as Record<string, unknown>;
  const tallies: Record<string, BadgeTally> = {};
  for (const [id, stored] of Object.entries(source)) {
    if (!isKnownBadge(id)) continue;
    const tally = (stored ?? {}) as { up?: unknown; down?: unknown };
    tallies[id] = {
      up: Number(tally.up) || 0,
      down: Number(tally.down) || 0,
    };
  }
  return tallies;
}

/** `badgeModeration` as the client may rely on it: catalogue ids, and the two
 * verdicts that exist.
 *
 * A cleared verdict is a *deleted* key (badges.post.ts uses
 * `FieldValue.delete()` precisely so that „nobody has ruled on this” stays
 * distinguishable from „an editor cleared a ruling”), so anything else here -
 * a `null` left by an older build, a typo - is dropped rather than forwarded:
 * absent is the value that means undecided, and the client's overlay in
 * `BadgePersonSection` reads a present key as a decision.
 */
function readModeration(value: unknown): Record<string, "approved" | "hidden"> {
  const source = (value ?? {}) as Record<string, unknown>;
  const moderation: Record<string, "approved" | "hidden"> = {};
  for (const [id, verdict] of Object.entries(source)) {
    if (!isKnownBadge(id)) continue;
    if (verdict === "approved" || verdict === "hidden") {
      moderation[id] = verdict;
    }
  }
  return moderation;
}
