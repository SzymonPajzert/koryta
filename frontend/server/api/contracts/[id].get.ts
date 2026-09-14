import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { readerAwareCachedEventHandler } from "~~/server/utils/handlers";
import { attachPeople, toContractRow } from "~~/server/utils/contracts";

/** One contract, with the people we may name beside it.
 *
 * `readerAwareCachedEventHandler` because this route does carry people, unlike
 * the list. It verifies the token *before* the cache is consulted, sends a
 * signed-in reader to the uncached handler and keeps one shared entry for
 * logged out traffic - so a draft name can never be written into the entry a
 * crawler reads next.
 *
 * The gate is `event.context.hasUser` and nothing else. Never `?latest=true`:
 * `authFetch` puts that on every request a signed-in reader makes, but it is
 * an unauthenticated query parameter - anyone may type it - and on
 * /api/graph/local it is verified live to return 13 unpublished people by
 * name today.
 *
 * Cost per expanded row: one document read, one edges query (at most three
 * node ids, so one chunk) and one `getAll` of the person nodes. That bound is
 * why the „Szczegóły umowy" tap is affordable and why the list does not pay it
 * twenty times over.
 */
export default readerAwareCachedEventHandler(
  async (event) => {
    const id = getRouterParam(event, "id");
    if (!id) {
      throw createError({ statusCode: 400, message: "Missing contract id" });
    }

    const db = getFirestore(getApp(), "koryta-pl");
    const doc = await db.collection("contracts").doc(id).get();
    if (!doc.exists) {
      throw createError({
        statusCode: 404,
        message: `Contract not found for id=${id}`,
      });
    }

    const contract = toContractRow(doc);
    contract.people = await attachPeople(
      db,
      contract.nodeIds,
      event.context.hasUser === true,
    );

    // `coverage` is the list route's job - the detail is fetched by a row that
    // is already on a page which has it - and the shape is kept so both
    // responses parse the same way.
    return { contract, coverage: null };
  },
  { name: "contract-detail", maxAge: 60, swr: true },
);
