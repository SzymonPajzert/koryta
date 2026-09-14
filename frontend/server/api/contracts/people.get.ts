import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { readerAwareCachedEventHandler } from "~~/server/utils/handlers";
import {
  attachPeople,
  buildContractQuery,
  collectCompanyPeople,
  parseContractCursor,
  readCoverage,
  toContractRow,
} from "~~/server/utils/contracts";
import type {
  ContractCompanyStats,
  ContractPersonRow,
  ContractRow,
} from "~~/shared/contracts";

/** The rows behind /eksploruj/umowy: people, not contracts.
 *
 * Signed-in only, and enforced here rather than only by the page's `auth`
 * middleware - a middleware protects a route, not an endpoint anyone can curl.
 * A caller with no verified token gets counts and nothing else, the same shape
 * /api/extractions serves with `countOnly`. The decision reads
 * `event.context.hasUser`, which `readerAwareCachedEventHandler` sets from a
 * verified token before the cache is consulted, and never `?latest=true`.
 *
 * Uncached by construction for the reader it is written for: the wrapper sends
 * a signed-in caller straight to this handler. The logged out answer - three
 * numbers - is what fills the cache entry.
 */

/** How many institutions one page ranks over.
 *
 * Exactly one `in` chunk, so exactly one edges query, and a bounded ~500 reads
 * per click. The cost of the bound is that a person on the board of the
 * 31st-biggest spender is not on the first page, and the totals printed beside
 * the rows are register-wide while the rows are window-wide. That is a
 * correctness compromise, so the page states it above the fold („pokazujemy
 * ludzi z 30 instytucji ... nie ze wszystkich 825") rather than in a footer.
 */
const COMPANY_WINDOW = 30;

/** How many contracts the „obie strony" mode ranks over. 154 contracts in the
 * first window have both ends resolved, so this is most of them, and at two
 * ends each it is at most 200 companies - seven chunks, seven edges queries. */
const BOTH_SIDES_LIMIT = 100;

const queryValidator = z.object({
  mode: z.enum(["ludzie", "obie"]).default("ludzie"),
  /** Default „umowy" - the number of contracts - and never money. A money
   * leaderboard over an unreviewed NIP join, where 82.5% of the underlying
   * employments are still unpublished, reads as a verdict rather than as a
   * work queue; and sorting by sum would make POLREGIO's five-contract board
   * the whole first screen. */
  sort: z.enum(["umowy", "suma", "ostatnia"]).default("umowy"),
  stan: z.enum(["all", "opublikowane", "nasze"]).default("all"),
  cursor: z.string().optional(),
});

export default readerAwareCachedEventHandler(
  async (event) => {
    const query = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );
    const db = getFirestore(getApp(), "koryta-pl");
    const coverage = await readCoverage(db);

    if (event.context.hasUser !== true) {
      return {
        people: [] as ContractPersonRow[],
        rows: [] as ContractRow[],
        total: coverage?.namedPeople ?? 0,
        // How many institutions' boards are behind the login, not how many
        // people: a count of people we hold on them would be a figure about
        // unpublished work, and the page has no use for it.
        hiddenTotal: coverage?.companies ?? 0,
        companies: 0,
        windowSize: 0,
        windowContracts: 0,
        nextCursor: null as string | null,
        coverage,
      };
    }

    if (query.mode === "obie") {
      const snapshot = await buildContractQuery(db, {
        sort: "kwota",
        zakres: "obie",
      })
        .limit(BOTH_SIDES_LIMIT)
        .get();
      const rows = snapshot.docs.map(toContractRow);
      const parties = await attachPeople(
        db,
        rows.flatMap((row) => row.nodeIds),
        true,
      );
      const byNodeId = new Map(parties.map((entry) => [entry.nodeId, entry]));

      // Both ends' strips, and nothing about who is on both of them. The lead
      // this mode exists to find - the same person on the buyer's board and on
      // a supplier's - is derived on the page from these very strips, so the
      // note above a row can never name somebody the row does not show. A flag
      // computed here, beside a `people` list the cap may have truncated,
      // could.
      for (const row of rows) {
        const rowPeople = row.nodeIds
          .map((id) => byNodeId.get(id))
          .filter((entry): entry is (typeof parties)[number] => !!entry);
        if (rowPeople.length) row.people = rowPeople;
      }

      return {
        people: [] as ContractPersonRow[],
        rows,
        total: rows.length,
        hiddenTotal: 0,
        companies: coverage?.companies ?? 0,
        windowSize: rows.length,
        windowContracts: rows.length,
        nextCursor: null as string | null,
        coverage,
      };
    }

    // The window: the institutions with the most contracts in the period.
    // `contractStats` is 825 documents with automatic single-field indexes, so
    // this needs no composite.
    let statsQuery = db
      .collection("contractStats")
      .orderBy("totalCount", "desc")
      .orderBy(FieldPath.documentId(), "desc");
    const cursor = parseContractCursor(query.cursor, "kwota");
    if (cursor) statsQuery = statsQuery.startAfter(cursor.value, cursor.id);
    const statsSnapshot = await statsQuery.limit(COMPANY_WINDOW).get();

    const window = statsSnapshot.docs.map((doc) => ({
      ...(doc.data() as ContractCompanyStats),
      nodeId: doc.id,
    }));
    const statsByNodeId = new Map(window.map((s) => [s.nodeId, s]));

    const { parties, companyNames } = await collectCompanyPeople(
      db,
      window.map((s) => s.nodeId),
      true,
    );

    // One row per person, however many of the window's institutions they sit
    // at. The money is the institutions' spending in the period, never the
    // person's - the graph says who sits on a board, it does not say who signed
    // anything.
    const rows = new Map<string, ContractPersonRow>();
    for (const party of parties) {
      const stats = statsByNodeId.get(party.nodeId);
      for (const person of party.people) {
        const row = rows.get(person.id) ?? {
          person: { ...person, ours: false },
          companies: [],
          contractCount: 0,
          totalValue: 0,
        };
        row.companies.push({
          nodeId: party.nodeId,
          name: companyNames.get(party.nodeId) ?? party.nodeId,
          ...(person.role ? { role: person.role } : {}),
          ours: person.ours,
        });
        // Draft on any one of their seats is draft on the row: the dashed
        // border and the „szkic" chip say „something here is not published
        // yet", which is true as soon as one of them is not.
        row.person.ours = row.person.ours || person.ours;
        row.contractCount += stats?.totalCount ?? 0;
        row.totalValue += stats?.totalValue ?? 0;
        if (
          stats?.lastSignedAt &&
          (!row.lastSignedAt || stats.lastSignedAt > row.lastSignedAt)
        ) {
          row.lastSignedAt = stats.lastSignedAt;
        }
        rows.set(person.id, row);
      }
    }

    let people = Array.from(rows.values());
    if (query.stan === "opublikowane") {
      people = people.filter((row) => !row.person.ours);
    } else if (query.stan === "nasze") {
      people = people.filter((row) => row.person.ours);
    }
    people.sort((a, b) => {
      if (query.sort === "suma") return b.totalValue - a.totalValue;
      if (query.sort === "ostatnia") {
        return (b.lastSignedAt ?? "").localeCompare(a.lastSignedAt ?? "");
      }
      return b.contractCount - a.contractCount;
    });

    const lastCompany = window[window.length - 1];
    return {
      people,
      rows: [] as ContractRow[],
      total: people.length,
      hiddenTotal: 0,
      // The register-wide figure, so the page can say how much of it this
      // window is.
      companies: coverage?.companies ?? 0,
      windowSize: window.length,
      // How many contracts the institutions in this window hold between them,
      // so the „Umowy w oknie" tile states what the rows are drawn from rather
      // than a register-wide figure the window is a slice of. Summed from the
      // aggregates already read; it costs nothing.
      windowContracts: window.reduce(
        (total, stats) => total + stats.totalCount,
        0,
      ),
      nextCursor:
        window.length === COMPANY_WINDOW && lastCompany
          ? `${lastCompany.totalCount}|${lastCompany.nodeId}`
          : null,
      coverage,
    };
  },
  { name: "contract-people", maxAge: 60, swr: true },
);
