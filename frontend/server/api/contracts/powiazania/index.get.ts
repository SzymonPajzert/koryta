import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { readerAwareCachedEventHandler } from "~~/server/utils/handlers";
import {
  buildContractLinkQuery,
  contractLinkItem,
  contractLinkSorts,
  contractLinkStartAfter,
  encodeContractLinkCursor,
  parseContractLinkCursor,
  readContractLinkSummary,
} from "~~/server/utils/contractLinks";
import {
  contractLinkStrengths,
  type ContractLink,
  type ContractLinkListResponse,
} from "~~/shared/contractLinks";

/** The findings list behind /eksploruj/umowy's „Powiązania".
 *
 * Reader-aware for the reason /api/contracts/people is: a signed-in reader is
 * sent every finding in full, uncached; anybody else shares one cache entry in
 * which the gated findings are teasers (`contractLinkItem`). The decision reads
 * `event.context.hasUser`, set from a verified token before the cache is
 * consulted, and never `?latest=true`.
 *
 * The cursor is a rank and only a rank, in both orders - it is in the SSR
 * payload every visitor downloads, and anything more (a document id, a total)
 * would name or find the firm behind the teaser it follows.
 */

/** A value typed or pasted into the url, in whatever case it came: blank
 * reads as absent, anything else as its canonical spelling. */
function canonical(transform: (value: string) => string) {
  return (value: unknown) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed ? transform(trimmed) : undefined;
  };
}

const queryValidator = z.object({
  /** „sila" is the site's order - the strength of the story, then money
   * (`rank`). „kwota" is money alone. */
  sort: z.enum(contractLinkSorts).default("sila"),
  status: z.enum(["wszystkie", "sprawdzone"]).default("wszystkie"),
  woj: z.preprocess(
    canonical((value) => value.toLocaleLowerCase("pl")),
    z
      .string()
      .regex(/^[a-ząćęłńóśźż-]{4,30}$/)
      .optional(),
  ),
  klasa: z.preprocess(
    canonical((value) => value.toUpperCase()),
    z.enum(contractLinkStrengths).optional(),
  ),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  cursor: z.string().max(200).optional(),
});

export default readerAwareCachedEventHandler(
  async (event): Promise<ContractLinkListResponse> => {
    const query = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );
    const db = getFirestore(getApp(), "koryta-pl");
    const hasUser = event.context.hasUser === true;

    const cursor = parseContractLinkCursor(query.cursor);
    const after =
      cursor === null
        ? null
        : await contractLinkStartAfter(db, query.sort, cursor);
    let firestoreQuery = buildContractLinkQuery(db, {
      sort: query.sort,
      verifiedOnly: query.status === "sprawdzone",
      wojewodztwo: query.woj,
      strength: query.klasa,
    });
    if (after) firestoreQuery = firestoreQuery.startAfter(...after);

    const [snapshot, summary] = await Promise.all([
      firestoreQuery.limit(query.limit + 1).get(),
      after ? Promise.resolve(null) : readContractLinkSummary(db),
    ]);
    const docs = snapshot.docs.slice(0, query.limit);
    const last = docs.at(-1);

    return {
      items: docs.map((doc) =>
        contractLinkItem(doc.id, doc.data() as ContractLink, hasUser),
      ),
      nextCursor:
        snapshot.docs.length > query.limit && last
          ? encodeContractLinkCursor(last.data() as ContractLink)
          : null,
      summary,
    };
  },
  { name: "contract-links", maxAge: 60 },
);
