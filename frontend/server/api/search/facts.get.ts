import { z } from "zod";
import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { factNameIndex } from "~~/server/utils/factNames";
import {
  searchFactNames,
  toFactNameHit,
  type FactNameHit,
} from "~~/shared/factNames";

const queryValidator = z.object({
  q: z.string().optional().default(""),
  // Few, because they are listed under the people the search found, and the
  // people are what most searches are for.
  limit: z.coerce.number().int().positive().max(20).default(5),
});

/** Names the article facts mention that have no page of their own - the other
 * person in a relation, somebody an article names that the graph does not.
 *
 * Signed in only, and checked here on the token, not on `latest`, which any
 * caller can put on a url: the facts these names come from are shown to signed
 * in readers only (see `ExtractionPersonFacts` and `/api/extractions`), and a
 * name with the page it is mentioned on is most of what a fact says. For the
 * same reason nothing between here and the reader may keep the answer, and it
 * lives in no response cache - the index behind it is held in memory
 * (`server/utils/factNames.ts`), and a search costs no Firestore reads.
 */
export default defineEventHandler(
  async (event): Promise<{ names: FactNameHit[] }> => {
    await getUser(event);
    setResponseHeader(event, "Cache-Control", "private, no-store");

    const { q, limit } = await getValidatedQuery(event, (query) =>
      queryValidator.parse(query),
    );
    // One letter matches half the index, and says nothing yet about who is
    // being looked for.
    if (q.trim().length < 2) return { names: [] };

    const index = await factNameIndex(getFirestore(getApp(), "koryta-pl"));
    return { names: searchFactNames(index, q, limit).map(toFactNameHit) };
  },
);
