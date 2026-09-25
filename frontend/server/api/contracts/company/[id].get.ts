import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { readerAwareCachedEventHandler } from "~~/server/utils/handlers";
import {
  attachPeople,
  buildContractQuery,
  contractRoles,
  encodeContractCursor,
  parseContractCursor,
  readCoverage,
  toContractRow,
  topFiveShare,
} from "~~/server/utils/contracts";
import type { ContractCompanyStats } from "~~/shared/contracts";

/** „Umowy publiczne" on one institution's page.
 *
 * The first thing it does is read `contractStats/{id}`, and on a company with
 * no contracts that is the *whole* cost: one Firestore read, `stats: null`,
 * and a section that renders nothing at all. That case is 4 103 of the 4 928
 * companies on the site, /instytucja/ draws 42% of the site's search
 * impressions, and /api/nodes scans are already 38% of its Firestore reads -
 * so the empty case had to be one read rather than a query that finds nothing.
 *
 * `readerAwareCachedEventHandler` because the rows carry people. The gate is
 * `event.context.hasUser`, resolved from a verified token before the cache is
 * consulted, and never `?latest=true`.
 */

const queryValidator = z.object({
  rola: z.enum(contractRoles).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(5),
  cursor: z.string().optional(),
});

export default readerAwareCachedEventHandler(
  async (event) => {
    const nodeId = getRouterParam(event, "id");
    if (!nodeId) {
      throw createError({ statusCode: 400, message: "Missing company id" });
    }
    const query = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );

    const db = getFirestore(getApp(), "koryta-pl");
    const coverage = await readCoverage(db);

    const statsDoc = await db.collection("contractStats").doc(nodeId).get();
    if (!statsDoc.exists) {
      return {
        stats: null,
        rows: [],
        nextCursor: null,
        topFiveShare: null,
        hiddenPeople: 0,
        coverage,
      };
    }
    const stats = statsDoc.data() as ContractCompanyStats;

    // Always largest first: it is what a reader of a public institution's page
    // came for, and it is the ordering the „pięć największych" sentence
    // describes.
    const sort = "kwota";
    let firestoreQuery = buildContractQuery(db, {
      sort,
      nodeId,
      rola: query.rola,
    });
    const cursor = parseContractCursor(query.cursor, sort);
    if (cursor) {
      firestoreQuery = firestoreQuery.startAfter(cursor.value, cursor.id);
    }

    const snapshot = await firestoreQuery.limit(query.limit + 1).get();
    const rows = snapshot.docs.slice(0, query.limit).map(toContractRow);
    const last = rows[rows.length - 1];
    const nextCursor =
      snapshot.docs.length > query.limit && last
        ? encodeContractCursor(last, sort)
        : null;

    // The counterparties only. This company's own board is already on the page
    // above, in `CardEmploymentHistory`, and resolving it again would double
    // the edges query for nothing. At most five rows with at most a handful of
    // ends each, so one chunk, one edges query and one `getAll`.
    const counterparties = Array.from(
      new Set(rows.flatMap((row) => row.nodeIds.filter((id) => id !== nodeId))),
    );
    const people = await attachPeople(
      db,
      counterparties,
      event.context.hasUser === true,
    );
    const byNodeId = new Map(people.map((entry) => [entry.nodeId, entry]));
    for (const row of rows) {
      const rowPeople = row.nodeIds
        .filter((id) => id !== nodeId)
        .map((id) => byNodeId.get(id))
        .filter((entry): entry is (typeof people)[number] => !!entry);
      if (rowPeople.length) row.people = rowPeople;
    }

    return {
      stats,
      rows,
      nextCursor,
      // Computed from the rows about to be served rather than stored, so the
      // sentence can never assert a percentage the cards under it contradict.
      topFiveShare: topFiveShare(rows, stats),
      // Summed for the login banner, which the section renders once under the
      // rows rather than once per row.
      hiddenPeople: people.reduce((sum, entry) => sum + entry.hiddenPeople, 0),
      coverage,
    };
  },
  { name: "contract-company", maxAge: 60, swr: true },
);
