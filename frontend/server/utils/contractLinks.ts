import type {
  Firestore,
  Query,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { z } from "zod";
import {
  CONTRACT_LINK_COLLECTION,
  CONTRACT_LINK_UNCONFIRMED_HOOK,
  CONTRACT_LINK_SUMMARY_DOC,
  contractLinkAmountRange,
  contractLinkBases,
  contractLinkDealsRange,
  contractLinkFlags,
  contractLinkStatuses,
  contractLinkStrengths,
  contractLinkVisibilities,
  officeHook,
  type ContractLink,
  type ContractLinkItem,
  type ContractLinkPerson,
  type ContractLinkRow,
  type ContractLinkStrength,
  type ContractLinkSummary,
  type ContractLinkTeaser,
} from "~~/shared/contractLinks";
import { contractDocumentId } from "~~/shared/contracts";
import { asArray } from "~~/shared/model";

/** The findings' server half: what an ingest may write, what a reader may be
 * sent, and how the list is queried. See `shared/contractLinks.ts` for why the
 * findings are a collection of their own. */

/** Where the contracts behind the findings are kept: the same documents under
 * the same ids as `contracts`, in a collection only
 * /api/contracts/powiazania/<id> reads, and only past its gate.
 *
 * Not in `contracts`, which /api/contracts lists to everybody. The rest of the
 * register reaches that collection only where it touches a company this site
 * describes, so a finding's contracts there would be the only unlinked rows in
 * it - the firms behind the gated findings by name and NIP, with sums that the
 * teasers' bands and money order then tie each teaser to. */
export const CONTRACT_LINK_CONTRACT_COLLECTION = "contractLinkContracts";

/** What a teaser calls a finding whose person the research could not be sure
 * is the one in office: the doubt, and not the office. The shared constant,
 * because Teaser.vue compares against it. */
export const UNCONFIRMED_IDENTITY_HOOK = CONTRACT_LINK_UNCONFIRMED_HOOK;

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const placeSchema = {
  gmina: z.string().max(120).optional(),
  powiat: z.string().max(120).optional(),
  wojewodztwo: z.string().max(40).optional(),
};

const candidacySchema = z.object({
  year: z.number().int().min(1990).max(2100),
  office: z.string().min(1).max(160),
  result: z.enum(["won", "lost", "unknown"]),
});

const personSchema = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(["politician", "official"]),
  roles: z.array(z.string().max(80)).max(12).default([]),
  sharePct: z.number().min(0).max(100).optional(),
  controlNow: z.boolean(),
  controlSince: isoDay,
  controlUntil: isoDay,
  office: z.string().max(300).optional(),
  officeNote: z.string().max(300).optional(),
  candidacies: z.array(candidacySchema).max(40).default([]),
  wonYears: z.array(z.number().int()).max(20).default([]),
  inOfficeNow: z.boolean(),
  committees: z.array(z.string().max(80)).max(12).default([]),
});

/** Nulls out, recursively, before anything is validated.
 *
 * The pipeline's stream comes out of a DataFrame, where a key one finding has
 * and another lacks is a column, and the lacking row carries it as null. The
 * uploader strips those, but a null must not fail a batch for whoever posts
 * next - the reason `cruContractSchema` is `nullish` throughout. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== null).map(withoutNulls);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== null)
        .map(([key, entry]) => [key, withoutNulls(entry)]),
    );
  }
  return value;
}

/** One finding as the pipeline posts it (`ContractLinkPayloads`).
 *
 * Everything derivable is derived here rather than trusted: the document id
 * from the NIP, `place` from the biggest payer, `hook` from the people, and
 * the contract document ids from the register's ids - so two writers cannot
 * disagree about what a finding joins to. */
const contractLinkPayloadObject = z.object({
  nip: z.string().regex(/^\d{10}$/),
  krs: z
    .array(z.string().regex(/^\d{10}$/))
    .max(10)
    .default([]),
  company: z.string().min(1).max(300),
  companySeat: z.string().max(200).optional(),
  status: z.enum(contractLinkStatuses),
  strength: z.enum(contractLinkStrengths),
  visibility: z.enum(contractLinkVisibilities),
  rank: z.number().int().min(1),
  inOfficeNow: z.boolean(),
  controlNow: z.boolean(),
  people: z.array(personSchema).min(1).max(12),
  ties: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        tie: z.string().max(200),
        family: z.string().max(200).optional(),
        confirmed: z.boolean(),
      }),
    )
    .max(20)
    .default([]),
  why: z.string().max(600).optional(),
  total: z.number().min(0),
  ownAreaTotal: z.number().min(0),
  firmTotal: z.number().min(0),
  firmContracts: z.number().int().min(0),
  deals: z.number().int().min(0),
  basis: z.enum(contractLinkBases),
  dateFrom: isoDay,
  dateTo: isoDay,
  buyers: z
    .array(
      z.object({
        name: z.string().max(300),
        value: z.number().min(0),
        contracts: z.number().int().min(0),
        ownArea: z.boolean(),
        ...placeSchema,
      }),
    )
    .max(40)
    .default([]),
  /** Every distinct payer, where `buyers` stops at the biggest few. Absent
   * from a pipeline that predates it, when `buyers` is taken to be all. */
  buyerCount: z.number().int().min(0).optional(),
  topContract: z
    .object({
      sourceId: z.string().min(1).max(80),
      subject: z.string().max(600).optional(),
      value: z.number().min(0),
      valueTotal: z.number().min(0).optional(),
      signedAt: isoDay,
      suppliers: z.number().int().min(1).default(1),
      buyer: z.object({ name: z.string().max(300), ...placeSchema }),
    })
    .optional(),
  /** The register's `id_umowy`s behind `total`. */
  contractSourceIds: z.array(z.string().min(1).max(80)).max(2000).default([]),
  flags: z.array(z.enum(contractLinkFlags)).max(contractLinkFlags.length),
});

export const contractLinkPayloadSchema = z.preprocess(
  withoutNulls,
  contractLinkPayloadObject,
);

export type ContractLinkPayload = z.infer<typeof contractLinkPayloadSchema>;

/** A name as two sources may spell it: „Tomasz  Testowy" and „tomasz testowy"
 * are the same person on one finding. */
function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("pl");
}

/** Whether the finding says why this person is on it: a candidacy, a mandate,
 * or an office or note the research wrote down. Somebody with none of these
 * is a co-owner or a relative - a tie, whatever `kind` says - and is named to
 * nobody who is not signed in (`contractLinkItem`). Tolerant of arrays a
 * restore has turned into maps. */
export function hasPublicRole(person: ContractLinkPerson): boolean {
  return (
    asArray(person.candidacies).length > 0 ||
    asArray(person.wonYears).length > 0 ||
    !!person.office ||
    !!person.officeNote
  );
}

/** The office in two or three words (`hook`), for a teaser that names nobody:
 * the first person's with a public role, or the doubt itself where the
 * research could not be sure it is the same person - an office held by
 * somebody who may be someone else is not claimed at all. */
export function contractLinkHook(
  doc: Pick<ContractLink, "people" | "flags">,
): string {
  if (asArray(doc.flags).includes("identity_unconfirmed")) {
    return UNCONFIRMED_IDENTITY_HOOK;
  }
  const person = asArray(doc.people).find(hasPublicRole);
  return officeHook(
    person && {
      ...person,
      candidacies: asArray(person.candidacies),
      wonYears: asArray(person.wonYears),
    },
  );
}

/** The stored document for one posted finding. */
export function toContractLinkDoc(
  payload: ContractLinkPayload,
  now: string,
): ContractLink {
  const { contractSourceIds, topContract, buyerCount, ...rest } = payload;
  // The biggest payer, not the payer of the biggest contract: one large order
  // from a far-off institution would otherwise file a councillor under a
  // województwo that pays the firm a fraction of what their own one does.
  const place = payload.buyers[0] ?? topContract?.buyer;
  // The research sometimes lists the person again among the people tied to
  // the firm, under their role there - a card would then call them related to
  // themselves.
  const people = new Set(payload.people.map((person) => nameKey(person.name)));
  const doc: ContractLink = {
    ...rest,
    ties: payload.ties.filter((tie) => !people.has(nameKey(tie.name))),
    buyerCount: Math.max(buyerCount ?? 0, payload.buyers.length),
    place: {
      ...(place?.wojewodztwo ? { wojewodztwo: place.wojewodztwo } : {}),
      ...(place?.powiat ? { powiat: place.powiat } : {}),
      ...(place?.gmina ? { gmina: place.gmina } : {}),
    },
    contractIds: [
      ...new Set(contractSourceIds.map((id) => contractDocumentId("cru", id))),
    ],
    hook: contractLinkHook(payload),
    updatedAt: now,
  };
  if (topContract) {
    doc.topContract = {
      ...topContract,
      id: contractDocumentId("cru", topContract.sourceId),
    };
  }
  return stripUndefined(doc);
}

/** Firestore refuses `undefined` values; zod leaves them on optional keys. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefined(entry)]),
    ) as T;
  }
  return value;
}

/** `ukryte_<rank>`: how a gated finding is addressed where its document id
 * may not be shown. */
export function contractLinkTeaserId(rank: number): string {
  return `ukryte_${rank}`;
}

/** What this reader may be sent about one finding - the whole gate.
 *
 * A signed-in reader gets everything. An anonymous reader gets a `public`
 * finding without its researched ties (private people, named only for their
 * tie to the firm), without anybody among its people it gives no public role
 * (`hasPublicRole`), who is a tie in all but name, and without `why` when
 * either left somebody out, because the research's sentence names them. A
 * `gated` one comes as a teaser - and so does a public one with nobody left to
 * name.
 *
 * `hook` is worked out here rather than read off the document, so that one
 * stored before its rule last changed says what the rule says now. */
export function contractLinkItem(
  id: string,
  doc: ContractLink,
  hasUser: boolean,
): ContractLinkItem {
  const hook = contractLinkHook(doc);
  if (hasUser) return { ...doc, id, locked: false, hook };
  if (doc.visibility === "public") {
    // Tolerant of an array a restore has turned into a map (`asArray`).
    const people = asArray(doc.people);
    const named = people.filter(hasPublicRole);
    if (named.length) {
      const hiddenTies =
        asArray(doc.ties).length + people.length - named.length;
      const row: ContractLinkRow = {
        ...doc,
        id,
        locked: false,
        hook,
        people: named,
        ties: [],
        hiddenTies,
      };
      if (hiddenTies) delete row.why;
      return row;
    }
  }
  return contractLinkTeaser(doc, hook);
}

/** A finding as an anonymous reader may see it behind the gate: rank, class,
 * the office in two words, the województwo, and the amount and the number of
 * contracts as bands. Nothing that names anybody, no gmina and no exact
 * amount: either is enough to find the contract in the public register and
 * read off who took it. */
function contractLinkTeaser(
  doc: ContractLink,
  hook: string,
): ContractLinkTeaser {
  return {
    // Not the document id: that is `cru_<nip>`, and a NIP names the firm as
    // surely as its name does.
    id: contractLinkTeaserId(doc.rank),
    locked: true,
    rank: doc.rank,
    status: doc.status,
    strength: doc.strength,
    totalRange: contractLinkAmountRange(doc.total),
    dealsRange: contractLinkDealsRange(doc.deals),
    // Somebody on the finding in office today, which is what the card's badge
    // says - not `doc.inOfficeNow`, which counts a relative in office too and
    // would set the badge beside a hook about somebody who is not. And not at
    // all where the identity is in doubt: a teaser carries no flags to qualify
    // the badge with.
    inOfficeNow:
      !asArray(doc.flags).includes("identity_unconfirmed") &&
      asArray(doc.people).some((person) => person.inOfficeNow),
    hook,
    place: doc.place.wojewodztwo ? { wojewodztwo: doc.place.wojewodztwo } : {},
  };
}

/** The finding at a rank - what `ukryte_<rank>` and a list cursor point at.
 * `rank` is unique across the collection (`rank_for_site`). */
export async function findContractLinkByRank(
  db: Firestore,
  rank: number,
): Promise<QueryDocumentSnapshot | null> {
  const snapshot = await db
    .collection(CONTRACT_LINK_COLLECTION)
    .where("rank", "==", rank)
    .limit(1)
    .get();
  return snapshot.docs[0] ?? null;
}

export const contractLinkSorts = ["sila", "kwota"] as const;
export type ContractLinkSort = (typeof contractLinkSorts)[number];

/** The list: the site's order or money, narrowed by status, województwo and
 * class.
 *
 * `rank` is unique, so it settles every tie by itself, and the document id -
 * which carries the NIP - is in neither the order nor the cursor.
 *
 * Every combination is one composite index in `firestore.indexes.json`; the
 * emulator does not enforce them, so a new filter here needs its index there or
 * it works locally and fails in production. */
export function buildContractLinkQuery(
  db: Firestore,
  options: {
    sort: ContractLinkSort;
    verifiedOnly?: boolean;
    wojewodztwo?: string;
    strength?: ContractLinkStrength;
  },
): Query {
  let query: Query = db.collection(CONTRACT_LINK_COLLECTION);
  if (options.verifiedOnly) query = query.where("status", "==", "verified");
  if (options.wojewodztwo) {
    query = query.where("place.wojewodztwo", "==", options.wojewodztwo);
  }
  if (options.strength) query = query.where("strength", "==", options.strength);
  return options.sort === "kwota"
    ? query.orderBy("total", "desc").orderBy("rank", "asc")
    : query.orderBy("rank", "asc");
}

/** The cursor is the rank of the last finding on the page, and nothing else:
 * not the document id, which names the firm behind a teaser, and not the
 * total, which finds it (see `contractLinkItem`). null for anything that is
 * not a rank, which reads as the first page, as `parseContractCursor` does. */
export function parseContractLinkCursor(
  raw: string | undefined | null,
): number | null {
  if (!raw || !/^\d{1,5}$/.test(raw)) return null;
  const rank = Number(raw);
  return rank >= 1 ? rank : null;
}

export function encodeContractLinkCursor(row: { rank: number }): string {
  return String(row.rank);
}

/** The `startAfter` values for a cursor in the list's order. By money that
 * needs the total too, read here from the finding at that rank so that the
 * cursor never has to carry it. null when that finding is gone - a re-run
 * between two pages - which reads as the first page. */
export async function contractLinkStartAfter(
  db: Firestore,
  sort: ContractLinkSort,
  rank: number,
): Promise<number[] | null> {
  if (sort === "sila") return [rank];
  const at = await findContractLinkByRank(db, rank);
  return at ? [(at.data() as ContractLink).total, rank] : null;
}

/** The fields `computeContractLinkSummary` reads, for a `select()` that does
 * not pull whole findings. */
export const CONTRACT_LINK_SUMMARY_FIELDS = [
  "status",
  "strength",
  "visibility",
  "total",
  "inOfficeNow",
  "people",
  "place",
  "dateFrom",
  "dateTo",
  "flags",
] as const;

export type ContractLinkSummaryInput = Pick<
  ContractLink,
  (typeof CONTRACT_LINK_SUMMARY_FIELDS)[number]
>;

/** Counts and sums over every finding, for `stats/powiazania`. */
export function computeContractLinkSummary(
  docs: ContractLinkSummaryInput[],
  now: string,
): ContractLinkSummary {
  const summary: ContractLinkSummary = {
    links: docs.length,
    verified: 0,
    public: 0,
    gated: 0,
    gatedVerified: 0,
    inOfficeNow: 0,
    inOfficePeople: 0,
    total: 0,
    totalVerified: 0,
    totalGated: 0,
    byStrength: { A: 0, B: 0, C: 0, D: 0 },
    totalByStrength: { A: 0, B: 0, C: 0, D: 0 },
    byWojewodztwo: {},
    computedAt: now,
  };
  // By name: one councillor behind two firms is two findings but one person.
  const inOfficePeople = new Set<string>();
  for (const doc of docs) {
    const gated = doc.visibility !== "public";
    const verified = doc.status === "verified";
    summary.total += doc.total;
    if (verified) {
      summary.verified += 1;
      summary.totalVerified += doc.total;
    }
    if (gated) {
      summary.gated += 1;
      summary.totalGated += doc.total;
      if (verified) summary.gatedVerified += 1;
    } else {
      summary.public += 1;
    }
    // Not claimed where the research doubts it is the same person, as neither
    // the card nor the teaser claims it (`contractLinkItem`).
    if (!asArray(doc.flags).includes("identity_unconfirmed")) {
      if (doc.inOfficeNow) summary.inOfficeNow += 1;
      for (const person of asArray(doc.people)) {
        if (person.inOfficeNow) inOfficePeople.add(nameKey(person.name));
      }
    }
    summary.byStrength[doc.strength] += 1;
    summary.totalByStrength[doc.strength] += doc.total;
    const woj = doc.place.wojewodztwo;
    if (woj) {
      const entry = (summary.byWojewodztwo[woj] ??= {
        links: 0,
        total: 0,
        gated: 0,
      });
      entry.links += 1;
      entry.total += doc.total;
      if (gated) entry.gated += 1;
    }
    if (doc.dateFrom && (!summary.from || doc.dateFrom < summary.from)) {
      summary.from = doc.dateFrom;
    }
    if (doc.dateTo && (!summary.to || doc.dateTo > summary.to)) {
      summary.to = doc.dateTo;
    }
  }
  summary.inOfficePeople = inOfficePeople.size;
  return summary;
}

/** Every finding's summary fields (and `extraFields`) - the read both a
 * recount and the ingest's prune start from. */
export async function readContractLinkSummaryInputs(
  db: Firestore,
  extraFields: string[] = [],
): Promise<QueryDocumentSnapshot[]> {
  const snapshot = await db
    .collection(CONTRACT_LINK_COLLECTION)
    .select(...CONTRACT_LINK_SUMMARY_FIELDS, ...extraFields)
    .get();
  return snapshot.docs;
}

export async function writeContractLinkSummary(
  db: Firestore,
  docs: ContractLinkSummaryInput[],
  now: string,
): Promise<ContractLinkSummary> {
  const summary = computeContractLinkSummary(docs, now);
  await db.collection("stats").doc(CONTRACT_LINK_SUMMARY_DOC).set(summary);
  return summary;
}

/** Recounts every finding into `stats/powiazania`. */
export async function refreshContractLinkSummary(
  db: Firestore,
  now: string,
): Promise<ContractLinkSummary> {
  const docs = await readContractLinkSummaryInputs(db);
  return writeContractLinkSummary(
    db,
    docs.map((doc) => doc.data() as ContractLinkSummaryInput),
    now,
  );
}

/** The summary as stored - recounted once if it was written before the fields
 * the page now reads existed, rather than sending the page `undefined` until
 * the pipeline next runs. */
export async function readContractLinkSummary(
  db: Firestore,
): Promise<ContractLinkSummary | null> {
  const snapshot = await db
    .collection("stats")
    .doc(CONTRACT_LINK_SUMMARY_DOC)
    .get();
  if (!snapshot.exists) return null;
  const summary = snapshot.data() as Partial<ContractLinkSummary>;
  if (summary.totalByStrength && summary.inOfficePeople !== undefined) {
    return summary as ContractLinkSummary;
  }
  return refreshContractLinkSummary(db, new Date().toISOString());
}
