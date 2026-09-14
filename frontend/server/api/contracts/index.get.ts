import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import {
  buildContractQuery,
  contractRoles,
  contractScopes,
  contractSorts,
  encodeContractCursor,
  parseContractCursor,
  readCoverage,
  toContractRow,
} from "~~/server/utils/contracts";

/** The contract list behind /eksploruj/umowy and behind every „Pokaż więcej".
 *
 * A plain `defineCachedEventHandler` rather than `readerAwareCachedEventHandler`,
 * and that is the whole reason this route is cheap: it attaches **no person
 * data at all**, so there is nothing here that differs between a stranger and
 * an editor, and one cache entry serves both. A page of twenty rows costs
 * about 21 reads. Attaching people to it would mean one batched edges pass over
 * the ~40 companies a page names - roughly 350 billed reads on the
 * most-crawled surface this feature has. A reader reaches people by tapping
 * „Szczegóły umowy" (one contract, at most three companies) or by following
 * the institution link.
 *
 * 60 seconds and not the six hours `authCachedEventHandler` defaults to.
 * Cloud CDN keeps an /api response for the full `s-maxage` and nothing in this
 * repo can purge it - `useStorage("cache").clear("nitro:handlers")` reaches
 * only the local container - so the cache lifetime is the delay between a
 * contract being submitted and it being public. `nuxt.config.ts` gives /eksploruj/umowy
 * the matching `swr: 60`, so the SSR html that embeds the headline cannot
 * outlive the rows under it.
 */

const queryValidator = z.object({
  sort: z.enum(contractSorts).default("data"),
  zakres: z.enum(contractScopes).default("wszystkie"),
  /** One company's contracts, either end. Forces the ordering to „kwota" in
   * `buildContractQuery`, because that is the only composite this filter
   * has. */
  nodeId: z.string().optional(),
  rola: z.enum(contractRoles).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export default defineCachedEventHandler(
  async (event) => {
    const query = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );
    const db = getFirestore(getApp(), "koryta-pl");

    // A per-company view is always largest-first; `buildContractQuery` forces
    // it, and the cursor has to be decoded against the same ordering or page
    // two resumes at the wrong end of the collection.
    const sort = query.nodeId ? "kwota" : query.sort;

    let firestoreQuery = buildContractQuery(db, {
      sort,
      zakres: query.zakres,
      ...(query.nodeId ? { nodeId: query.nodeId } : {}),
      rola: query.rola,
    });

    const cursor = parseContractCursor(query.cursor, sort);
    if (cursor) {
      firestoreQuery = firestoreQuery.startAfter(cursor.value, cursor.id);
    }

    // One document past the page, to learn whether there is a page after this
    // one. No `.count()` and no `.offset()` anywhere on this route: a count
    // over 149 683 index entries is about 150 billed reads per uncached call,
    // and an offset bills every document it skips. Every total on screen comes
    // from `stats/umowy` instead.
    const snapshot = await firestoreQuery.limit(query.limit + 1).get();
    const docs = snapshot.docs.slice(0, query.limit);
    const rows = docs.map(toContractRow);

    // The cursor is the last row actually served, not the extra document:
    // `startAfter` resumes *after* what it is given, so encoding the extra one
    // would skip it.
    const last = rows[rows.length - 1];
    const nextCursor =
      snapshot.docs.length > query.limit && last
        ? encodeContractCursor(last, sort)
        : null;

    return {
      rows,
      nextCursor,
      // Only on the first page of an unfiltered list: it is one read, it never
      // changes between pages of the same run, and the company section reads
      // it from its own route anyway.
      coverage: query.cursor || query.nodeId ? null : await readCoverage(db),
    };
  },
  { name: "contracts-list", maxAge: 60, swr: true },
);
