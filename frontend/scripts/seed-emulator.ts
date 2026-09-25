import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import waitOn from "wait-on";
import { readFileSync } from "fs";
import { createRequire, registerHooks } from "node:module";
import { resolve } from "path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateChunksLower } from "../shared/search";
import { computeEdgeStats } from "../shared/stats";
import { bodyIsPaidPost } from "../shared/companyBodies";
import { contractDocumentId } from "../shared/contracts";
import type {
  Contract,
  ContractCompanyStats,
  ContractCoverage,
} from "../shared/contracts";
import type { Edge } from "../shared/model";
import { pageIsPublic } from "../shared/model";

import nodes from "./nodes.json";
import edges from "./edges.json";
import revisions from "./revisions.json";
import extractions from "./extractions.json";
import contractPayloads from "./contracts.json";
import contractLinkPayloads from "./contract_links.json";
import contractLinkContractPayloads from "./contract_link_contracts.json";

/** Let this script `import()` a module from `server/`, which the Nuxt build
 * resolves `~~/` for and `tsx` does not.
 *
 * The contracts seeded below go through the same `toContractDoc` the ingest
 * endpoint uses, deliberately: a second mapper written for the fixtures is a
 * second set of rules about what reaches Firestore, and the one rule that has
 * to hold everywhere is that a private individual's name does not. But
 * `server/utils/contracts.ts` imports `~~/shared/model`, and `npx tsx` knows
 * nothing about that alias - `scripts/migrate/backfill-article-dates.ts` hit
 * the same wall and copied a constant across rather than importing it.
 *
 * A resolve hook is the cheap way out: it rewrites `~~/x` and `~/x` to a path
 * under `frontend/` and hands the rest back to the loader. It has to be
 * installed before that module is loaded, and a static import is resolved
 * before any of this file's own statements run - hence the `createRequire` in
 * `seedContracts` rather than an import up here.
 */
// `fileURLToPath(import.meta.url)` and not `__dirname`: `tsx` loads this as
// an ES module, where neither `__dirname` nor `__filename` exists, and the
// reference throws before the first line of seeding runs.
const appRoot = resolve(fileURLToPath(import.meta.url), "../..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("~~/") || specifier.startsWith("~/")) {
      const target = resolve(appRoot, specifier.replace(/^~~?\//, ""));
      return nextResolve(pathToFileURL(target).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const projectId =
  process.env.USE_PROD_PROJECT === "true" ? "koryta-pl" : "demo-koryta-pl";

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = projectId;

const app = initializeApp({
  projectId: projectId,
});

/**
 * Seed the emulators with the test data.
 * Always populates auth (but checks that it's test directory).
 * If --empty is passed, don't seed firestore.
 */
async function seed() {
  const empty = process.argv.includes("--empty");
  console.log("empty: ", empty);
  if (!empty) {
    await seedDatabase();
  }
  await seedAuth();
  await seedRules();
}

/** Gives a fixture the `published` flag it predates.
 *
 * `pageIsPublic` used to fall back to `!!revision_id` when the field was
 * absent, and the fixtures were written against that rule - which is why none
 * of them carries it. Once the fallback was removed (every real document
 * having been backfilled), the seeded site went blank for logged out readers:
 * an absent flag now means "draft", so nothing in it was public and the graph
 * rendered empty.
 *
 * The old rule is reproduced here rather than written into the JSON so the
 * fixtures keep saying one thing about a page - `revision_id` for "somebody
 * approved this" - and a fixture that wants to be a draft can still say
 * `published: false` outright.
 */
function defaultPublished(
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (data.published === undefined) {
    data.published = !!data.revision_id;
  }
  return data;
}

/**
 * `stats.edges` for every node the seeded edges start from, computed here for
 * the same reason `nameChunksLower` is: with the function the real thing uses.
 *
 * `onEdgeWritten` no longer writes this field inline - it marks the node dirty
 * and `sweepEdgeStats` does the work - and the emulator does not run scheduled
 * functions, so nothing would ever fill it in locally. The explore table's
 * filters query `stats.edges.*.currentlyEmployed` and
 * `stats.edges.*.latestEmploymentStart` (`server/utils/nodeFilters.ts`), and
 * Firestore's orderBy drops documents that lack the field, so without this the
 * table comes up empty.
 */
function edgeStatsBySource(
  nodesById: Record<string, Record<string, unknown>>,
  allEdges: Record<string, unknown>[],
): Record<string, ReturnType<typeof computeEdgeStats>> {
  const publicPlaceIds = new Set<string>();
  const unpaidSeatPlaceIds = new Set<string>();
  for (const [id, node] of Object.entries(nodesById)) {
    if (node.type !== "place") continue;
    if (node.isPublic === true) publicPlaceIds.add(id);
    if (!bodyIsPaidPost(node.supervisoryBody as string | undefined)) {
      unpaidSeatPlaceIds.add(id);
    }
  }

  // Keyed by target across the whole fixture rather than per source node, which
  // is the same thing to `computeEdgeStats` - it only ever looks up the targets
  // of the edges it was handed.
  const transitiveTargets: Record<string, string[]> = {};
  for (const edge of allEdges) {
    const { source, target, type } = edge as unknown as Edge;
    if (type !== "owns" && type !== "seat") continue;
    if (!source || !target) continue;
    (transitiveTargets[target] ??= []).push(source);
  }

  const bySource: Record<string, ReturnType<typeof computeEdgeStats>> = {};
  for (const source of new Set(
    allEdges.map((e) => e.source as string).filter(Boolean),
  )) {
    bySource[source] = computeEdgeStats(
      allEdges.filter((e) => e.source === source) as unknown as Edge[],
      publicPlaceIds,
      transitiveTargets,
      unpaidSeatPlaceIds,
    );
  }
  return bySource;
}

/** The NIP and nine-digit REGON of the seeded companies that appear on a
 * contract fixture.
 *
 * Only three of the four seeded places are here on purpose. „Firma Pusta"
 * (`companyempty`) is left without an identifier and without a contract,
 * because „an institution with no contracts renders no section at all" is 4 103
 * of the site's 4 928 companies and the e2e suite needs a page to assert it on.
 *
 * `chain-company` already carries these two fields in nodes.json and is
 * repeated here so that one table answers „which seeded company does this NIP
 * mean" - the values are identical, and a mismatch would be a silent
 * unresolved join rather than an error.
 */
const COMPANY_IDENTIFIERS: Record<
  string,
  { nipNumber: string; regonNumber: string }
> = {
  "2": { nipNumber: "7740001454", regonNumber: "610188201" },
  sukspolka: { nipNumber: "1132316427", regonNumber: "000301701" },
  "chain-company": { nipNumber: "5260250274", regonNumber: "123456785" },
};

/** The middle value, or the mean of the middle two. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[at]!
    : (sorted[at - 1]! + sorted[at]!) / 2;
}

/** The seven CRU fixtures, plus the two aggregates every contracts surface
 * reads its numbers out of.
 *
 * The fixtures are register payloads, not Firestore documents: they go through
 * `toContractDoc` and `resolveNodeIds` exactly as `/api/ingest/contracts` runs
 * them, so the emulator cannot end up holding a shape production would never
 * write - most importantly it cannot end up holding the `imie`/`nazwisko` that
 * fixture 5 carries and the mapper drops.
 *
 * The aggregates are computed from the resolved documents rather than written
 * into a fixture by hand. Every count and both dates on `/umowy`, on the
 * company section and in the source note come from `stats/umowy`, and a
 * hand-kept number there would let the seeded site assert a coverage figure the
 * seeded rows contradict - which is the one failure mode this feature has no
 * server-side check for.
 */
async function seedContracts(
  db: FirebaseFirestore.Firestore,
  seededEdges: Record<string, unknown>[],
) {
  // Loaded here rather than at the top of the file, because the resolve hook
  // above has to be installed before `~~/shared/model` is looked up on this
  // module's behalf - and a static import is resolved before any of this
  // file's own code runs. `createRequire` rather than `await import()`, which
  // eslint bans outright.
  const { toContractDoc, resolveNodeIds } = createRequire(import.meta.url)(
    "../server/utils/contracts",
  ) as typeof import("../server/utils/contracts");
  const payloads = contractPayloads as unknown as Parameters<
    typeof toContractDoc
  >[0][];

  const contracts = payloads.map((payload) => toContractDoc(payload));
  // Fills the join in place and hands back a summary; the documents to write
  // are the ones passed in.
  const summary = await resolveNodeIds(db, contracts);

  const batch = db.batch();
  for (const contract of contracts) {
    const id = contractDocumentId(contract.source, contract.sourceId);
    batch.set(db.collection("contracts").doc(id), contract);
  }

  // One document per company any fixture resolved to, with the same fields the
  // pipeline's podsumowanie run writes.
  const touched = new Set<string>(contracts.flatMap((c) => c.nodeIds));
  const computedAt = new Date().toISOString();
  for (const nodeId of touched) {
    const asBuyer = contracts.filter((c) => c.buyerNodeId === nodeId);
    const asSupplier = contracts.filter((c) =>
      c.supplierNodeIds.includes(nodeId),
    );
    const sum = (rows: Omit<Contract, "id">[]) =>
      rows.reduce((total, row) => total + (row.value ?? 0), 0);
    const stats: ContractCompanyStats = {
      nodeId,
      buyerCount: asBuyer.length,
      buyerValue: sum(asBuyer),
      supplierCount: asSupplier.length,
      supplierValue: sum(asSupplier),
      totalCount: asBuyer.length + asSupplier.length,
      totalValue: sum(asBuyer) + sum(asSupplier),
      medianValue: median(
        [...asBuyer, ...asSupplier]
          .map((row) => row.value)
          .filter((value): value is number => typeof value === "number"),
      ),
      computedAt,
    };
    const lastSignedAt = [...asBuyer, ...asSupplier]
      .map((row) => row.signedAt)
      .filter((date): date is string => !!date)
      .sort()
      .at(-1);
    if (lastSignedAt) stats.lastSignedAt = lastSignedAt;
    batch.set(db.collection("contractStats").doc(nodeId), stats);
  }

  // Who a logged out reader may be told about: the person's page published and
  // the employment published, which is the same pair the endpoint checks per
  // request. 900 of the 5 146 employments on the 825 touched companies pass it
  // in production, and the seed reproduces the split rather than the ratio.
  const publishedPeople = new Set(
    Object.entries(nodes)
      .filter(
        ([, node]) =>
          (node as { type?: string }).type === "person" &&
          pageIsPublic(defaultPublished({ ...node })),
      )
      .map(([id]) => id),
  );
  const namedPeople = new Set(
    seededEdges
      .filter((edge) => {
        const { source, target, type, published } = edge as unknown as Edge;
        return (
          type === "employed" &&
          published === true &&
          touched.has(target) &&
          publishedPeople.has(source)
        );
      })
      .map((edge) => (edge as unknown as Edge).source),
  );

  const days = contracts
    .map((contract) => contract.signedAt ?? contract.publishedAt)
    .filter((day): day is string => !!day)
    .sort();
  const coverage: ContractCoverage = {
    // The emulator holds every contract it was handed, so „in the register"
    // and „stored here" are the same number locally. In production they are
    // not, which is why they are two fields.
    total: contracts.length,
    stored: contracts.length,
    // From the join's own summary rather than recounted here: the ingest route
    // reports these two the same way, so a seeded environment and a production
    // one cannot disagree about what „linked" counts.
    linked: summary.linked,
    bothLinked: summary.bothLinked,
    companies: touched.size,
    namedPeople: namedPeople.size,
    withIndividual: contracts.filter((contract) => contract.hasIndividual)
      .length,
    registerInstitutions: new Set(
      contracts
        .map((contract) => contract.buyer.nip)
        .filter((nip): nip is string => !!nip),
    ).size,
    from: days[0] ?? "",
    to: days.at(-1) ?? "",
    computedAt,
    sources: ["cru"],
  };
  batch.set(db.collection("stats").doc("umowy"), coverage);

  await batch.commit();
}

/** The findings behind /eksploruj/umowy's „Powiązania", through the same
 * `toContractLinkDoc` the ingest uses - so the seed cannot store a shape the
 * pipeline could not - and the summary through the same function the ingest's
 * final call runs. Two public fixtures and three gated ones, so a logged out
 * page shows both the named cards and the teasers.
 *
 * Their contracts (`contract_link_contracts.json`) go where
 * /api/ingest/contracts/powiazania/umowy puts them, `contractLinkContracts`,
 * through the same `toContractDoc` and `resolveNodeIds` - and not into
 * `contracts` with the seven above, where the public list would show them. */
async function seedContractLinks(db: FirebaseFirestore.Firestore) {
  const {
    CONTRACT_LINK_CONTRACT_COLLECTION,
    contractLinkPayloadSchema,
    toContractLinkDoc,
    computeContractLinkSummary,
  } = createRequire(import.meta.url)(
    "../server/utils/contractLinks",
  ) as typeof import("../server/utils/contractLinks");
  const { toContractDoc, resolveNodeIds } = createRequire(import.meta.url)(
    "../server/utils/contracts",
  ) as typeof import("../server/utils/contracts");
  const { contractLinkDocumentId } = createRequire(import.meta.url)(
    "../shared/contractLinks",
  ) as typeof import("../shared/contractLinks");

  const now = new Date().toISOString();
  const docs = contractLinkPayloads.map((payload) =>
    toContractLinkDoc(contractLinkPayloadSchema.parse(payload), now),
  );
  const contracts = (
    contractLinkContractPayloads as unknown as Parameters<
      typeof toContractDoc
    >[0][]
  ).map((payload) => toContractDoc(payload));
  await resolveNodeIds(db, contracts);

  const batch = db.batch();
  for (const doc of docs) {
    batch.set(
      db.collection("contractLinks").doc(contractLinkDocumentId(doc.nip)),
      doc,
    );
  }
  for (const contract of contracts) {
    batch.set(
      db
        .collection(CONTRACT_LINK_CONTRACT_COLLECTION)
        .doc(contractDocumentId(contract.source, contract.sourceId)),
      contract,
    );
  }
  batch.set(
    db.collection("stats").doc("powiazania"),
    computeContractLinkSummary(docs, now),
  );
  await batch.commit();
  console.log(
    docs.length,
    "contract links,",
    contracts.length,
    "contracts behind them",
  );
}

async function seedDatabase() {
  await waitOn({
    resources: ["tcp:127.0.0.1:8080"],
    timeout: undefined,
  });
  const db = getFirestore(app, "koryta-pl");

  console.log("Seeding database...");

  // Clear existing collections
  const collections = [
    "nodes",
    "edges",
    "revisions",
    "extractions",
    "feedback",
    // Verdicts on the QA changelog. Cleared with the rest so /qa opens on an
    // unchecked list, which is what its spec - and anybody looking at a fresh
    // local stack - expects to see.
    "qaChecks",
    // Cleared because the seed now writes some, and the admin specs write more
    // at run time under stamped ids. Left alone, re-seeding a live emulator
    // would leave every note any earlier run had made sitting on the page
    // under the fixtures below.
    "notes",
    // Contracts are keyed on the register's own id, so re-seeding overwrites
    // rather than duplicates - but the aggregates below are computed from
    // whatever is in the collection, and a fixture dropped from
    // `contracts.json` would otherwise keep being counted forever.
    "contracts",
    "contractStats",
    // Keyed on the NIP, so re-seeding overwrites; cleared so a fixture dropped
    // from `contract_links.json` stops being listed.
    "contractLinks",
    // And the contracts behind them, for the same reason.
    "contractLinkContracts",
  ];
  for (const col of collections) {
    const docs = await db.collection(col).listDocuments();
    if (docs.length > 0) {
      const deleteBatch = db.batch();
      docs.forEach((doc) => deleteBatch.delete(doc));
      await deleteBatch.commit();
      console.log(`Cleared ${col}`);
    }
  }

  const batch = db.batch();

  const seededEdges = edges.map((edge) =>
    defaultPublished({ ...edge } as Record<string, unknown>),
  );
  const edgeStatsBySourceId = edgeStatsBySource(
    nodes as unknown as Record<string, Record<string, unknown>>,
    seededEdges,
  );

  // Facts per person, from the same fixture the extractions are seeded from.
  // Computed here rather than written into nodes.json for the same reason the
  // edge stats are: production keeps this counter through
  // /api/ingest/extraction and /api/stats/computeNodes, and a fixture carrying
  // it by hand would drift from the facts beside it - which for a sort means a
  // table ordered by a number nothing on the page agrees with.
  const factsByNodeId: Record<string, number> = {};
  for (const fact of Object.values(extractions)) {
    const personNodeId = (fact as { personNodeId?: string }).personNodeId;
    if (personNodeId) {
      factsByNodeId[personNodeId] = (factsByNodeId[personNodeId] ?? 0) + 1;
    }
  }

  for (const [id, node] of Object.entries(nodes)) {
    const nodeData = { ...node } as Record<string, unknown>;
    // The join key the contracts feature runs on, attached here rather than in
    // nodes.json for the same reason the search index and the edge stats are:
    // it is derived data that has to agree with something else in the seed -
    // the party identifiers in contracts.json - and a pair of numbers kept by
    // hand in two files drifts. Production gets these from
    // scripts/migrate/backfill-company-nip.ts, which is where the real ones
    // come from.
    const identifiers = COMPANY_IDENTIFIERS[id];
    if (identifiers) Object.assign(nodeData, identifiers);
    if (!nodeData.stats) nodeData.stats = {};
    const stats = nodeData.stats as Record<string, unknown>;
    // Only default to approved=true if not explicitly set in seed data
    if (stats.isApproved === undefined) {
      stats.isApproved = true;
    }
    // The search index is computed here rather than written into the fixture,
    // with the function the trigger in functions/src/nodes.ts uses. The fixture
    // used to carry it by hand and had drifted to a different scheme entirely,
    // which is why every spec that searched for a full name found nobody.
    if (typeof nodeData.name === "string") {
      nodeData.nameChunksLower = generateChunksLower(nodeData.name);
    }
    // JSON has no timestamp, and the collection stores one - the same
    // conversion the extractions below need. Without a date at all an article
    // is invisible to /zrodla, which sorts on this field: Firestore's orderBy
    // drops any document that does not carry it, so the table came up empty in
    // the emulator however many articles had been seeded.
    if (typeof nodeData.publishedDate === "string") {
      nodeData.publishedDate = new Date(nodeData.publishedDate);
    }
    const seededEdgeStats = edgeStatsBySourceId[id];
    if (seededEdgeStats) {
      stats.edges = seededEdgeStats;
    }
    // On every person, zero included: `orderBy stats.factsCount` drops a
    // document that lacks the field, so a seeded person without it would
    // vanish from the table under that sort rather than sorting last.
    if (nodeData.type === "person") {
      stats.factsCount = factsByNodeId[id] ?? 0;
    }
    defaultPublished(nodeData);
    const ref = db.collection("nodes").doc(id);
    batch.set(ref, nodeData);
  }

  for (const edgeData of seededEdges) {
    const ref = db.collection("edges").doc();
    batch.set(ref, edgeData);
  }

  for (const [id, rev] of Object.entries(revisions)) {
    const ref = db.collection("revisions").doc(id);
    batch.set(ref, rev);
  }

  // Notes on Jan Kowalski (1), one of each kind, so the notes section has
  // something in it to look at.
  //
  // Written by somebody else - `seed-notes-author`, an id no seeded account
  // holds - which is what puts them in `otherSources` rather than in the
  // reader's own note. A signed in reader therefore sees the whole section at
  // once: other people's entries, the prompt inviting theirs, and the three
  // buttons that add one. Owned by the reader it would be their note in edit
  // mode instead, and the prompt would be gone.
  //
  // Only this person. Orlen (2) is deliberately left without any, because the
  // empty section is a state worth a picture of its own and that is the page
  // that takes it.
  const seededNotes = {
    "1_seed-notes-author": {
      nodeId: "1",
      userUid: "seed-notes-author",
      createdAt: "2026-05-04T09:15:00.000Z",
      sources: [
        {
          kind: "source",
          url: "https://example.org/kowalski-rada-nadzorcza",
          note: "Wzmianka o powołaniu do rady nadzorczej - notatka prasowa z maja.",
        },
        {
          kind: "change_request",
          note: "Data końca zatrudnienia w Orlenie wygląda na przesuniętą o rok.",
        },
        {
          kind: "missing",
          note: "Brakuje kadencji w radzie miasta sprzed 2019 roku.",
        },
      ],
    },
  };
  for (const [id, note] of Object.entries(seededNotes)) {
    const ref = db.collection("notes").doc(id);
    batch.set(ref, note);
  }

  for (const [id, fact] of Object.entries(extractions)) {
    const ref = db.collection("extractions").doc(id);
    // The fixture carries an ISO string because JSON has no timestamp; the
    // collection stores a Timestamp, which is what /api/extractions orders by.
    batch.set(ref, { ...fact, createdAt: new Date(fact.createdAt) });
  }

  await batch.commit();

  // After the nodes are in, never before: `resolveNodeIds` joins a contract to
  // a company by querying `nodes` on `nipNumber`, so a contract written
  // alongside the nodes in one batch would resolve to nothing and the whole
  // feature would be seeded unlinked.
  await seedContracts(db, seededEdges);
  await seedContractLinks(db);

  console.log("Database seeded successfully!");

  console.log((await db.collection("nodes").get()).docs.length, "nodes");
  console.log((await db.collection("edges").get()).docs.length, "edges");
  console.log(
    (await db.collection("revisions").get()).docs.length,
    "revisions",
  );
  console.log(
    (await db.collection("extractions").get()).docs.length,
    "extractions",
  );
  console.log(
    (await db.collection("contracts").get()).docs.length,
    "contracts",
  );
  console.log(
    (await db.collection("contractStats").get()).docs.length,
    "companies with contract stats",
  );
}

async function seedAuth() {
  await waitOn({
    resources: ["tcp:127.0.0.1:9099"],
    timeout: undefined,
  });
  const auth = getAuth(app);

  if (auth.app.options.projectId !== projectId) {
    throw "this is not a test environment";
  }

  try {
    for (const user of [
      {
        uid: "test-admin",
        email: "admin@koryta.pl",
        password: "password123",
        displayName: "Admin User",
      },
      {
        uid: "test-user",
        email: "user@koryta.pl",
        password: "password123",
        displayName: "Normal User",
      },
    ]) {
      await auth.createUser(user);
      if (user.uid === "test-admin") {
        // datascience: allows uploading extractions via /api/ingest/extraction
        await auth.setCustomUserClaims(user.uid, {
          admin: true,
          datascience: true,
        });
        console.log(`Set admin + datascience claim for ${user.email}`);
      }
      console.log(`User created: ${user.email} / ${user.password}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (
      error.code === "auth/email-already-exists" ||
      error.code === "auth/uid-already-exists"
    ) {
      console.log("User already exists", error);
    } else {
      throw error;
    }
  }
}

async function seedRules() {
  const rulesPath = resolve(process.cwd(), "../firestore.rules");
  const rulesContent = readFileSync(rulesPath, "utf8");

  const rulesUrl = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}:securityRules`;

  const response = await fetch(rulesUrl, {
    method: "PUT",
    body: JSON.stringify({
      rules: {
        files: [
          {
            name: "security.rules",
            content: rulesContent,
          },
        ],
      },
    }),
  });

  if (response.ok) {
    console.log("Firestore rules updated.");
  } else {
    console.error("Failed to update firestore rules", await response.text());
  }
}

seed().catch((err) => {
  console.error("Error seeding database:", err);
  process.exit(1);
});
