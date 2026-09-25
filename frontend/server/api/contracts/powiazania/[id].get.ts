import {
  getFirestore,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { readerAwareCachedEventHandler } from "~~/server/utils/handlers";
import {
  CONTRACT_LINK_CONTRACT_COLLECTION,
  contractLinkItem,
  findContractLinkByRank,
} from "~~/server/utils/contractLinks";
import { toContractRow } from "~~/server/utils/contracts";
import {
  CONTRACT_LINK_COLLECTION,
  CONTRACT_LINK_ID_PATTERN,
  type ContractLink,
  type ContractLinkItem,
} from "~~/shared/contractLinks";
import type { ContractRow } from "~~/shared/contracts";
import { asArray } from "~~/shared/model";

/** One finding and the contracts behind it - what a permalink
 * (`?powiazanie=<id>`) and an expanded card read.
 *
 * Two ways in. `cru_<nip>` is the document id, which a signed-in reader and
 * any reader of a public finding already has. `ukryte_<rank>` is the id a
 * teaser carries: a signed-in reader who registered from a teaser comes back
 * with it and is sent the finding in full, anybody else the teaser again.
 *
 * An anonymous `cru_<nip>` for a gated finding is answered exactly as a NIP
 * with no finding is. Anything else - a teaser, a 403 - would say which NIPs
 * are behind the gate, which is the name the gate is there to withhold.
 *
 * The contracts are read by document id (`getAll`) from
 * `contractLinkContracts`, the closed collection the pipeline writes a
 * finding's contracts to (`CONTRACT_LINK_CONTRACT_COLLECTION` says why they
 * are not in the public one), and only once the gate has let the reader
 * through: a teaser comes without them, because they carry the company's and
 * the institution's names. An id missing there is looked for in `contracts`,
 * which holds the ones that touch a company this site describes - public
 * anyway, and all a finding had before the closed collection existed.
 */

/** How many contracts the expanded card is sent: the biggest, by value. */
const MAX_CONTRACTS = 60;

/** How many are read to find them. A finding joins at most the firm's
 * contracts in one register window, and the largest joins 143, so this reads
 * them all and sorts before cutting - cutting the research's order first
 * would drop the biggest, the finding's own top contract among them. A bound
 * for the read cost all the same. */
const MAX_CONTRACT_READS = 200;

export default readerAwareCachedEventHandler(
  async (
    event,
  ): Promise<{ link: ContractLinkItem; contracts: ContractRow[] }> => {
    const id = getRouterParam(event, "id");
    if (!id || !CONTRACT_LINK_ID_PATTERN.test(id)) {
      throw createError({ statusCode: 400, message: "Nieprawidłowy adres." });
    }
    const db = getFirestore(getApp(), "koryta-pl");
    const hasUser = event.context.hasUser === true;

    const byRank = id.startsWith("ukryte_");
    const snapshot = byRank
      ? await findContractLinkByRank(db, Number(id.slice("ukryte_".length)))
      : await db.collection(CONTRACT_LINK_COLLECTION).doc(id).get();
    const doc = snapshot?.exists ? (snapshot.data() as ContractLink) : null;
    // One throw for both, so that not even a development stack trace tells a
    // gated finding from a missing one.
    if (
      !snapshot ||
      !doc ||
      (!byRank && !hasUser && doc.visibility !== "public")
    ) {
      throw createError({
        statusCode: 404,
        message: "Nie ma takiego powiązania.",
      });
    }

    const link = contractLinkItem(snapshot.id, doc, hasUser);
    if (link.locked) return { link, contracts: [] };

    // Tolerant of an array a restore has turned into a map (`asArray`).
    const ids = asArray<string>(doc.contractIds).slice(0, MAX_CONTRACT_READS);
    const closed = await readContracts(
      db,
      CONTRACT_LINK_CONTRACT_COLLECTION,
      ids,
    );
    const found = new Set(closed.map((contract) => contract.id));
    const contracts = [
      ...closed,
      ...(await readContracts(
        db,
        "contracts",
        ids.filter((contractId) => !found.has(contractId)),
      )),
    ]
      .map(toContractRow)
      .sort((a, b) => b.valueSort - a.valueSort)
      .slice(0, MAX_CONTRACTS);
    return { link, contracts };
  },
  { name: "contract-link", maxAge: 60 },
);

/** The documents at `ids` in `collection` that exist. */
async function readContracts(
  db: Firestore,
  collection: string,
  ids: string[],
): Promise<DocumentSnapshot[]> {
  if (!ids.length) return [];
  const refs = ids.map((contractId) =>
    db.collection(collection).doc(contractId),
  );
  return (await db.getAll(...refs)).filter((contract) => contract.exists);
}
