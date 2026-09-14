import { FieldPath } from "firebase-admin/firestore";
import type { Firestore, Query } from "firebase-admin/firestore";
import { z } from "zod";
import { asArray, pageIsPublic } from "~~/shared/model";
import type { Company, Edge, Person } from "~~/shared/model";
import { displayRole } from "~~/shared/companyBodies";
import { fetchEdgeEndpointNodes } from "~~/server/utils/edgeNodes";
import type {
  Contract,
  ContractAmendment,
  ContractCompanyStats,
  ContractParty,
  ContractPartyKind,
  ContractPartyPeople,
  ContractPerson,
  ContractRedaction,
  ContractRow,
  ContractCoverage,
} from "~~/shared/contracts";

/** Reading and writing contracts, and deciding per reader who may be named
 * beside one.
 *
 * The two halves of this file answer two different questions and are gated
 * differently on purpose:
 *
 * - a contract is a register record and is public, always, to everybody;
 * - who we think sits on the board of the company that took the money is this
 *   site's own work, and a name only reaches a logged out reader once both the
 *   person's page and the relation itself have been published.
 *
 * The second rule is enforced here, server side, in `attachPeople`, and never
 * by not rendering something the response already contained.
 * `extraction/PersonFacts.vue` says why at length: a blurred sentence is still
 * in the html of an indexed page. It is decided from `event.context.hasUser`,
 * which `readerAwareCachedEventHandler` sets from a verified token - never
 * from `?latest=true`, which is a query parameter any caller may type and
 * which is verified today to return 13 unpublished people by name from
 * /api/graph/local.
 *
 * Everything here takes its `db` as an argument and imports nothing from
 * nitro, so `scripts/seed-emulator.ts` maps its fixtures through the same
 * `toContractDoc` production uses, and `tests/server/contracts.test.ts` can
 * drive the gate against a hand-built stub with no emulator.
 */

/** Whether a private individual's name from the register is stored at all.
 *
 * CRU publishes the first and last name of every private individual who
 * contracted with an institution - 18 505 contracts in the first window, 12.4%
 * of them, a named actor paid 600 zł by a university among them - and it does
 * so under the public-information act. Mirroring those names onto a site whose
 * whole purpose is to aggregate people across institutions, and to have Google
 * index the result, is a different act, and one nobody has decided to take.
 *
 * So the bytes never reach Firestore. Not hidden at render time, not filtered
 * by an endpoint: `toContractDoc` drops `imie`/`nazwisko` on the way in, which
 * means flipping this constant is a deliberate re-ingest of the register and
 * not a one-line change to a template somebody writes next year. That is the
 * only form of this decision that survives an endpoint nobody has written yet.
 *
 * Annotated `boolean` rather than left to narrow to the literal `false`, so
 * that the branches reading it stay live code and flipping it is the one-word
 * change it is meant to be.
 */
export const STORE_INDIVIDUAL_NAMES: boolean = false;

/** Firestore takes at most 30 values in an `in` filter. */
const IN_CHUNK = 30;

/** How many people one party may name before the rest become a „+n więcej".
 *
 * A cap, not a gate. The overflow goes to `morePeople` and never to
 * `hiddenPeople`: the copy for the two is different on purpose („+4 więcej"
 * against „po zalogowaniu"), and a truncation that reads like a login gate is
 * a lie about coverage.
 */
export const MAX_PEOPLE_PER_PARTY = 6;

/** How many companies one `attachPeople` call will resolve people for.
 *
 * A backstop rather than a working limit: every caller bounds its own input
 * already - one contract has at most three ends, the company section asks
 * about five rows' counterparties, and the widest caller is
 * /api/contracts/people in „obie" mode, which is 100 contracts with two
 * resolved ends each. The signed-in path is uncached by construction
 * (`readerAwareCachedEventHandler` sends a resolved reader straight to the
 * handler), so this is the one place where a reader with a scroll wheel could
 * turn into thousands of reads.
 */
const MAX_COMPANIES = 200;

// ---------------------------------------------------------------------------
// The CRU payload, and the mapping into a contract document
// ---------------------------------------------------------------------------

const niejawnoscSchema = z.object({
  zakres: z.string().nullish(),
  podstawa: z.string().nullish(),
  komentarz: z.string().nullish(),
  organ_lub_osoba_wylaczajaca: z.string().nullish(),
});

const zmianaSchema = z.object({
  rodzaj_zmiany: z.string().nullish(),
  data_zmiany: z.string().nullish(),
  data_zmiany_raw: z.string().nullish(),
  komentarz: z.string().nullish(),
});

const stronaSchema = z.object({
  /** 0-based, in the order the register lists them. Position 0 is the
   * contracting public body on every one of the 149 683 contracts measured. */
  kolejnosc: z.coerce.number().int().default(0),
  rodzaj: z.string().nullish(),
  nazwa: z.string().nullish(),
  /** Accepted so the mapper can be seen to drop them - see
   * `STORE_INDIVIDUAL_NAMES`. Rejecting them instead would only move the
   * decision into the pipeline, where this repo cannot test it. */
  imie: z.string().nullish(),
  nazwisko: z.string().nullish(),
  nip: z.string().nullish(),
  regon: z.string().nullish(),
  regon9: z.string().nullish(),
  miejscowosc: z.string().nullish(),
  niejawnosc: niejawnoscSchema.nullish(),
});

/** One contract as `data/pipelines/src/entities/cru.py` writes it.
 *
 * Exported so the ingest route, `scripts/seed-emulator.ts` and the tests share
 * one definition of the wire shape: a fixture that no longer parses is a
 * fixture that has stopped describing the pipeline, and that has to fail here
 * rather than in the emulator.
 *
 * Unknown keys are stripped rather than rejected. The mirror carries a full
 * postal address per party and four timestamps per contract that this site has
 * no use for, and a schema that rejected them would break on the next column
 * the register adds.
 */
export const cruContractSchema = z.object({
  id_umowy: z.string().min(1),
  zrodlo: z.string().default("umowa"),
  status_umowy: z.string().nullish(),
  numer_umowy: z.string().nullish(),
  brak_numeru_umowy: z.boolean().nullish(),
  data_zawarcia_umowy: z.string().nullish(),
  data_zakonczenia_umowy: z.string().nullish(),
  umowa_na_czas_nieoznaczony: z.boolean().nullish(),
  przedmiot_umowy: z.string().nullish(),
  /** A float in the mirror, but a string survives a jsonl round trip through
   * anything that read the file without a `dtype`, and this is the one figure
   * on the whole feature. Coerced in the mapper rather than here, so that
   * something unparseable becomes "no value" - which the model has a place for
   * - instead of a 400 that fails the other 499 contracts in the batch. */
  wartosc_przedmiotu: z.union([z.number(), z.string()]).nullish(),
  opis_wartosci_przedmiotu: z.string().nullish(),
  niejawnosc_przedmiotu: niejawnoscSchema.nullish(),
  niejawnosc_wartosci_przedmiotu: niejawnoscSchema.nullish(),
  zmiany_umowy: z.array(zmianaSchema).nullish(),
  ma_osobe_fizyczna: z.boolean().nullish(),
  strony: z.array(stronaSchema).nullish(),
  data_publikacji: z.string().nullish(),
  detale_blad: z.string().nullish(),
});

export type CruContractPayload = z.infer<typeof cruContractSchema>;
type CruParty = z.infer<typeof stronaSchema>;
type CruRedaction = z.infer<typeof niejawnoscSchema>;

/** `YYYY-MM-DD`, or nothing.
 *
 * The mirror publishes ISO days for every date except an amendment's, which it
 * converts on the way in, but a value it could not parse is carried through as
 * whatever the register said. Anything that is not a plain ISO day is dropped
 * rather than stored: `signedSort` orders on these strings, and one
 * `01.08.2026` among them would sort above every real date.
 */
function isoDay(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

function toNumber(raw: number | string | null | undefined): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Digits only, and only where there are any - the register sends `""` and
 * `"-"` for "no identifier" as readily as it omits the field. */
function digits(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.replace(/\D/g, "");
  return value.length ? value : undefined;
}

function toRedaction(
  raw: CruRedaction | null | undefined,
): ContractRedaction | undefined {
  if (!raw) return undefined;
  const redaction: ContractRedaction = {
    ...(raw.zakres ? { scope: raw.zakres } : {}),
    ...(raw.podstawa ? { basis: raw.podstawa } : {}),
    ...(raw.komentarz ? { comment: raw.komentarz } : {}),
    ...(raw.organ_lub_osoba_wylaczajaca
      ? { authority: raw.organ_lub_osoba_wylaczajaca }
      : {}),
  };
  // An object with nothing in it still means "this was withheld" - the UI reads
  // the presence of the field, not its contents - so an empty one is kept.
  return redaction;
}

/** The register's `rodzaj`, as one of the three kinds the site models.
 *
 * Compared case-folded because the mirror is not consistent about it, and
 * falling through to `undefined` rather than guessing: the only decision that
 * hangs on the kind is whether a party is a private individual, and inventing
 * that from a string nobody has seen would be the expensive way to be wrong.
 */
function toPartyKind(
  raw: string | null | undefined,
): ContractPartyKind | undefined {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "jsfp") return "jsfp";
  if (value === "przedsiębiorca" || value === "przedsiebiorca") return "firma";
  if (value === "osoba fizyczna") return "osoba";
  return undefined;
}

function toParty(raw: CruParty, role: "buyer" | "supplier"): ContractParty {
  const kind = toPartyKind(raw.rodzaj);
  const nip = digits(raw.nip);
  // The nine-digit stem identifies the legal entity; the extra five digits of a
  // fourteen-digit REGON identify one of its local units, and the site's nodes
  // carry the entity. Preferred for that reason, with the register's own value
  // kept where there is no stem.
  const regon = digits(raw.regon9) ?? digits(raw.regon);
  return {
    role,
    ...(kind ? { kind } : {}),
    // `STORE_INDIVIDUAL_NAMES` is the whole of the privacy decision: for a
    // private individual the register sends `imie`/`nazwisko` and no `nazwa`,
    // and neither is copied here, so the document that reaches Firestore has
    // nowhere to put the name and no endpoint can leak one.
    ...(raw.nazwa && (kind !== "osoba" || STORE_INDIVIDUAL_NAMES)
      ? { name: raw.nazwa }
      : {}),
    ...(kind === "osoba" && STORE_INDIVIDUAL_NAMES && (raw.imie || raw.nazwisko)
      ? { name: [raw.imie, raw.nazwisko].filter(Boolean).join(" ") }
      : {}),
    ...(nip && kind !== "osoba" ? { nip } : {}),
    ...(regon && kind !== "osoba" ? { regon } : {}),
    ...(raw.miejscowosc ? { city: raw.miejscowosc } : {}),
    ...(raw.niejawnosc ? { redaction: toRedaction(raw.niejawnosc) } : {}),
  };
}

function toAmendment(
  raw: z.infer<typeof zmianaSchema>,
): ContractAmendment | undefined {
  const amendment: ContractAmendment = {
    ...(raw.rodzaj_zmiany ? { kind: raw.rodzaj_zmiany } : {}),
    ...(isoDay(raw.data_zmiany) ? { date: isoDay(raw.data_zmiany)! } : {}),
    ...(raw.komentarz ? { comment: raw.komentarz } : {}),
  };
  return Object.keys(amendment).length ? amendment : undefined;
}

/** One CRU row as this site stores it.
 *
 * Writes no `nodeId` on any party and no `nodeIds` beyond an empty array:
 * resolving the join needs the database and this function does not have one.
 * `resolveNodeIds` is the second half and the ingest route runs both.
 */
export function toContractDoc(
  payload: CruContractPayload,
): Omit<Contract, "id"> {
  const parties = [...(payload.strony ?? [])].sort(
    (a, b) => a.kolejnosc - b.kolejnosc,
  );
  // `kolejnosc === 0` is the contracting public body on every contract in the
  // measured window; the register denormalises the same party into
  // `zamawiajacy_*` for exactly this reason.
  const [first, ...rest] = parties;
  const buyer = first
    ? toParty(first, "buyer")
    : // The 42 `wynik` rows have `strony: []`, so there is no buyer to state.
      // Kept as a role-only party rather than left absent, because `buyer` is
      // required on the model and every reader of it would otherwise need a
      // null check for 0.03% of documents.
      ({ role: "buyer" } as ContractParty);
  const suppliers = rest.map((party) => toParty(party, "supplier"));

  const value = toNumber(payload.wartosc_przedmiotu);
  const signedAt = isoDay(payload.data_zawarcia_umowy);
  const publishedAt = isoDay(payload.data_publikacji);
  const amendments = (payload.zmiany_umowy ?? [])
    .map(toAmendment)
    .filter((a): a is ContractAmendment => !!a);

  const nips = Array.from(
    new Set(
      [buyer, ...suppliers].flatMap((party) =>
        [party.nip, party.regon].filter((id): id is string => !!id),
      ),
    ),
  );

  return {
    source: "cru",
    sourceId: payload.id_umowy,
    ...(payload.numer_umowy ? { number: payload.numer_umowy } : {}),
    ...(payload.przedmiot_umowy ? { subject: payload.przedmiot_umowy } : {}),
    ...(payload.niejawnosc_przedmiotu
      ? { subjectRedaction: toRedaction(payload.niejawnosc_przedmiotu)! }
      : {}),
    ...(value === undefined ? {} : { value }),
    ...(payload.niejawnosc_wartosci_przedmiotu
      ? { valueRedaction: toRedaction(payload.niejawnosc_wartosci_przedmiotu)! }
      : {}),
    ...(payload.opis_wartosci_przedmiotu
      ? { valueNote: payload.opis_wartosci_przedmiotu }
      : {}),
    ...(signedAt ? { signedAt } : {}),
    ...(isoDay(payload.data_zakonczenia_umowy)
      ? { endsAt: isoDay(payload.data_zakonczenia_umowy)! }
      : {}),
    ...(payload.umowa_na_czas_nieoznaczony ? { openEnded: true } : {}),
    ...(payload.status_umowy
      ? { active: payload.status_umowy === "Aktywna" }
      : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(amendments.length ? { amendments } : {}),
    buyer,
    suppliers,
    nodeIds: [],
    linked: false,
    bothLinked: false,
    nips,
    supplierNodeIds: [],
    // The register's own flag, with the parties as a fallback: a row that names
    // an individual and forgot to say so still must not get the „Zobacz w
    // rejestrze" link, which is the one element that turns an anonymised row
    // back into a one-click lookup of the name.
    hasIndividual:
      payload.ma_osobe_fizyczna === true ||
      [buyer, ...suppliers].some((party) => party.kind === "osoba"),
    ...(payload.zrodlo === "wynik" ? { detailsUnavailable: true } : {}),
    // Always written, both of them. Firestore does not sort a document that
    // lacks the ordered field - it excludes it - so ordering on `value` itself
    // would silently drop the 764 contracts with no figure from every
    // money-sorted view, and ordering on `signedAt` would drop the 42 `wynik`
    // rows from the newest-first one, with nothing failing. -1 rather than 0
    // because 0 zł is a real value 251 contracts carry.
    valueSort: value ?? -1,
    signedSort: signedAt ?? publishedAt ?? "1970-01-01",
  };
}

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

type ResolvedCompany = { id: string; name: string };

export type ResolveSummary = {
  linked: number;
  bothLinked: number;
  /** Every identifier on the batch that matched no company here.
   *
   * How the pipeline learns which institutions the site still lacks, without
   * the pipeline needing a copy of the site's NIP list.
   */
  unresolvedNips: string[];
};

/** Fill in the node ids on a batch of contract documents, in place.
 *
 * Done once at ingest rather than per read: a contract list must not cost one
 * lookup per row, and the public list is the most-crawled surface this feature
 * has. The cost of freezing the join is that publishing a company tomorrow
 * leaves its existing contracts saying `linked: false` - which is what `nips`
 * and `scripts/migrate/relink-contracts.ts` are for.
 *
 * The lookup is `nodes.where('nipNumber','in',chunk)` with **no** `type`
 * equality, so the automatic single-field index serves it and this adds no
 * composite. The type is checked in JS afterwards.
 */
export async function resolveNodeIds(
  db: Firestore,
  docs: Omit<Contract, "id">[],
): Promise<ResolveSummary> {
  const nips = new Set<string>();
  const regons = new Set<string>();
  for (const doc of docs) {
    for (const party of [doc.buyer, ...doc.suppliers]) {
      if (party.nip) nips.add(party.nip);
      if (party.regon) regons.add(party.regon);
    }
  }

  const byNip = new Map<string, ResolvedCompany>();
  const byRegon = new Map<string, ResolvedCompany>();

  const lookup = async (
    field: "nipNumber" | "regonNumber",
    values: string[],
    into: Map<string, ResolvedCompany>,
  ) => {
    for (let at = 0; at < values.length; at += IN_CHUNK) {
      const snapshot = await db
        .collection("nodes")
        .where(field, "in", values.slice(at, at + IN_CHUNK))
        .select("name", "type", field)
        .get();
      for (const doc of snapshot.docs) {
        // Read as the loose shape `select()` actually returns rather than as
        // `Company`: three fields of a document, where `type` is whatever the
        // node says and not the literal the interface promises.
        const data = doc.data() as Partial<
          Pick<Company, "type" | "name" | "nipNumber" | "regonNumber">
        >;
        // A place with no name has nothing to link to, so it is not a match.
        if (data.type !== "place" || !data.name) continue;
        // Keyed by what the node stores rather than by what was asked for: the
        // query matched one of up to 30 values and the snapshot does not say
        // which.
        const key = field === "nipNumber" ? data.nipNumber : data.regonNumber;
        // First writer wins. Two companies sharing a NIP is a duplicate page,
        // not a contract with two buyers, and picking one deterministically is
        // better than a link that moves between ingests.
        if (key && !into.has(key)) {
          into.set(key, { id: doc.id, name: data.name });
        }
      }
    }
  };

  await lookup("nipNumber", Array.from(nips), byNip);
  await lookup("regonNumber", Array.from(regons), byRegon);

  const unresolved = new Set<string>();
  let linked = 0;
  let bothLinked = 0;

  for (const doc of docs) {
    const resolve = (party: ContractParty) => {
      const match =
        (party.nip ? byNip.get(party.nip) : undefined) ??
        (party.regon ? byRegon.get(party.regon) : undefined);
      if (!match) {
        for (const id of [party.nip, party.regon]) if (id) unresolved.add(id);
        delete party.nodeId;
        delete party.nodeName;
        return undefined;
      }
      party.nodeId = match.id;
      // Denormalised on purpose: a company's name is not a gated claim, unlike
      // who sits on its board, and carrying it saves roughly forty `getAll`
      // reads per page of twenty rows.
      party.nodeName = match.name;
      return match.id;
    };

    const buyerNodeId = resolve(doc.buyer);
    const supplierNodeIds = doc.suppliers
      .map(resolve)
      .filter((id): id is string => !!id);

    // Real arrays, written straight to the document. `sanitizeFirestoreData`
    // turns a nested array into a numbered-key map, against which
    // `array-contains` silently matches nothing rather than failing - which is
    // why `asArray` exists in shared/model.ts. Nothing in this path goes near
    // it.
    doc.supplierNodeIds = Array.from(new Set(supplierNodeIds));
    doc.nodeIds = Array.from(
      new Set([...(buyerNodeId ? [buyerNodeId] : []), ...doc.supplierNodeIds]),
    );
    if (buyerNodeId) doc.buyerNodeId = buyerNodeId;
    else delete doc.buyerNodeId;
    doc.linked = doc.nodeIds.length > 0;
    doc.bothLinked = !!buyerNodeId && doc.supplierNodeIds.length > 0;
    if (doc.linked) linked += 1;
    if (doc.bothLinked) bothLinked += 1;
  }

  return { linked, bothLinked, unresolvedNips: Array.from(unresolved) };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** Everyone the site has at each of `nodeIds`, as far as this reader may see.
 *
 * THE GATE, and the only place it is written.
 *
 * The query is `target in [...] and type == employed`, which the existing
 * composite `edges: target ASC, type ASC` serves - an employment runs
 * person -> place, as /api/edges/recentEmployments states - so this adds no
 * index of its own. It is one `in` filter and never two: two multiply into a
 * 30-way disjunction. It deliberately does **not** add
 * `.where('published','==',true)`: there is no `(target, type, published)`
 * composite in firestore.indexes.json, and the handler has to count the
 * unpublished rows for `hiddenPeople` anyway. Do not let anyone "optimise"
 * that filter into the query.
 *
 * Never `fetchEdgesClose`, which takes no type argument and issues both
 * `source in` and `target in` - every election, seat, owns and mentions edge
 * on the node, in both directions.
 *
 * Nothing here is denormalised onto a contract. Published-ness is read live,
 * every request, because it is the one field in this feature that changes
 * after the fact: publishing a person must show them and unpublishing one must
 * stop showing them without rewriting 149 683 contract documents, and without
 * waiting out a CDN entry nothing in this repo can purge.
 */
export async function attachPeople(
  db: Firestore,
  nodeIds: string[],
  /** Whether this reader may see what is not published yet. Pass
   * `event.context.hasUser === true`, which comes from a verified token, and
   * never a query parameter: `latest` is the caller's to type. */
  hasUser: boolean,
): Promise<ContractPartyPeople[]> {
  return (await collectCompanyPeople(db, nodeIds, hasUser)).parties;
}

/** `attachPeople`, plus the companies' own names.
 *
 * /api/contracts/people needs to print the institution a seat is at, and the
 * company node has already been read here to resolve `supervisoryBody`. Handed
 * back rather than re-fetched, so the explore view costs no reads beyond the
 * ones the gate already paid for.
 */
export async function collectCompanyPeople(
  db: Firestore,
  nodeIds: string[],
  hasUser: boolean,
): Promise<{
  parties: ContractPartyPeople[];
  companyNames: Map<string, string>;
}> {
  const wanted = Array.from(new Set(nodeIds.filter(Boolean))).slice(
    0,
    MAX_COMPANIES,
  );
  const companyNames = new Map<string, string>();
  if (wanted.length === 0) return { parties: [], companyNames };

  const edges: (Edge & { id: string })[] = [];
  for (let at = 0; at < wanted.length; at += IN_CHUNK) {
    const snapshot = await db
      .collection("edges")
      .where("target", "in", wanted.slice(at, at + IN_CHUNK))
      .where("type", "==", "employed")
      .get();
    for (const doc of snapshot.docs) {
      const edge = { id: doc.id, ...(doc.data() as Edge) };
      if (edge.deleted === true) continue;
      if (!edge.source || !edge.target) continue;
      edges.push(edge);
    }
  }

  const nodes = await fetchEdgeEndpointNodes(db, edges, [
    "name",
    "type",
    "published",
    "deleted",
    "parties",
    // So `displayRole` can say „Rada Społeczna" where that is what the organ
    // is: a hospital's rada społeczna printed as Rada Nadzorcza is the single
    // most-reported data defect on this site.
    "supervisoryBody",
  ]);

  type Candidate = {
    person: ContractPerson;
    /** Ordering only: a board member who took the seat in 2009 says more about
     * an institution than one appointed last month. */
    startDate: string;
  };
  const byCompany = new Map<
    string,
    { shown: Candidate[]; hidden: number; seen: Set<string> }
  >();
  for (const id of wanted) {
    byCompany.set(id, { shown: [], hidden: 0, seen: new Set() });
  }

  for (const edge of edges) {
    const bucket = byCompany.get(edge.target!);
    if (!bucket) continue;
    const person = nodes.get(edge.source!);
    const company = nodes.get(edge.target!);
    // Anything else is a row the ingest mislabelled, and there is nobody to
    // name.
    if (person?.type !== "person" || company?.type !== "place") continue;
    if (company.name) companyNames.set(edge.target!, company.name);

    // The whole decision, in one line. The company end is not part of it: the
    // row already links to that page, and 823 of the 825 companies the first
    // window touches are published anyway.
    const full = pageIsPublic(person) && edge.published === true;

    if (!full && !hasUser) {
      // A count, never a name. The withheld person is not serialised and then
      // hidden - there is no `people` entry for them at all.
      bucket.hidden += 1;
      continue;
    }

    // One entry per person per company. Two seats at one institution - a board
    // member who later became its chair - are one person to name, and the
    // better-sorted seat is the one already in.
    if (bucket.seen.has(edge.source!)) continue;
    bucket.seen.add(edge.source!);

    const role = displayRole(edge.name, company as Company);
    bucket.shown.push({
      person: {
        id: edge.source!,
        name: person.name,
        ...(role ? { role } : {}),
        parties: asArray<string>((person as Person).parties),
        ours: !full,
      },
      startDate: edge.start_date ?? "9999",
    });
  }

  const parties: ContractPartyPeople[] = [];
  for (const nodeId of wanted) {
    const bucket = byCompany.get(nodeId)!;
    if (!bucket.shown.length && !bucket.hidden) continue;
    // Published first, then longest-held: a draft must never push a published
    // person off the top, and the cap below cuts from the bottom.
    bucket.shown.sort((a, b) => {
      if (a.person.ours !== b.person.ours) return a.person.ours ? 1 : -1;
      return a.startDate.localeCompare(b.startDate);
    });
    parties.push({
      nodeId,
      people: bucket.shown.slice(0, MAX_PEOPLE_PER_PARTY).map((c) => c.person),
      hiddenPeople: bucket.hidden,
      morePeople: Math.max(0, bucket.shown.length - MAX_PEOPLE_PER_PARTY),
    });
  }

  return { parties, companyNames };
}

// ---------------------------------------------------------------------------
// Queries, cursors and the concentration sentence
// ---------------------------------------------------------------------------

export const contractSorts = ["data", "kwota"] as const;
export type ContractSort = (typeof contractSorts)[number];

export const contractScopes = ["wszystkie", "nasze", "obie"] as const;
export type ContractScope = (typeof contractScopes)[number];

export const contractRoles = ["all", "zamawiajacy", "wykonawca"] as const;
export type ContractRole = (typeof contractRoles)[number];

/** Which field each ordering reads.
 *
 * `valueSort`/`signedSort` and never `value`/`signedAt`: a document missing the
 * ordered field is excluded from the result, not sorted last, so ordering on
 * the printed fields would drop the 764 valueless contracts and the 42 `wynik`
 * rows from the views that most need to be complete.
 */
export const contractSortFields: Record<ContractSort, string> = {
  data: "signedSort",
  kwota: "valueSort",
};

/** The filtered, ordered query behind every contract list.
 *
 * One builder because the orderings are not free to extend: each one needs a
 * composite against `linked`, `bothLinked`, `nodeIds`, `buyerNodeId` and
 * `supplierNodeIds`, seven of which exist. /api/nodes passes a sort key
 * straight into `orderBy` with no allow-list and answers an empty table when
 * the field is not indexed, which is the failure this shape avoids.
 */
export function buildContractQuery(
  db: Firestore,
  options: {
    sort?: ContractSort;
    zakres?: ContractScope;
    nodeId?: string;
    rola?: ContractRole;
  },
): Query {
  let query: Query = db.collection("contracts");
  let sort: ContractSort = options.sort ?? "data";

  if (options.nodeId) {
    if (options.rola === "zamawiajacy") {
      // A scalar equality rather than a second array-contains - Firestore
      // allows only one per query.
      query = query.where("buyerNodeId", "==", options.nodeId);
    } else if (options.rola === "wykonawca") {
      query = query.where("supplierNodeIds", "array-contains", options.nodeId);
    } else {
      query = query.where("nodeIds", "array-contains", options.nodeId);
    }
    // Largest first is what a reader of an institution's page came for, and it
    // is the ordering the „pięć największych" sentence describes. A date
    // ordering under a role filter would cost three more composites over
    // 149 683 documents to answer a question that sentence already answers.
    sort = "kwota";
  } else if (options.zakres === "nasze") {
    query = query.where("linked", "==", true);
  } else if (options.zakres === "obie") {
    query = query.where("bothLinked", "==", true);
  }

  // The document id ordering is spelled out rather than left implicit: against
  // raw cursor values Firestore compares the count it was given to the number
  // of DECLARED orders and throws „Too many cursor values specified" on page
  // two. It also keeps a page boundary inside a group of contracts sharing a
  // value from resuming at the top of that group and looping - and a whole
  // ministry's import shares a signing date, so the groups are real.
  return query
    .orderBy(contractSortFields[sort], "desc")
    .orderBy(FieldPath.documentId(), "desc");
}

/** `"<sortValue>|<documentId>"`, the cursor shape
 * /api/edges/recentEmployments uses.
 *
 * Split on the FIRST pipe, not the last: the sort value is a number or an ISO
 * day and can never contain one, while a document id is somebody else's string
 * and may.
 *
 * Returns null on anything malformed rather than throwing. A cursor is a URL
 * parameter, so a truncated one is a 200 with the first page on it rather than
 * a 500.
 */
export function parseContractCursor(
  raw: string | undefined | null,
  sort: ContractSort,
): { value: string | number; id: string } | null {
  if (!raw) return null;
  const at = raw.indexOf("|");
  if (at <= 0) return null;
  const value = raw.slice(0, at);
  const id = raw.slice(at + 1);
  if (!id) return null;
  if (sort === "kwota") {
    const asNumber = Number(value);
    // `valueSort` is a number in the document, and Firestore compares types
    // before values: a string cursor against a numeric field resumes at the
    // wrong end of the collection rather than failing.
    if (!Number.isFinite(asNumber)) return null;
    return { value: asNumber, id };
  }
  return { value, id };
}

export function encodeContractCursor(
  row: { id: string; valueSort?: number; signedSort?: string },
  sort: ContractSort,
): string {
  const value =
    sort === "kwota" ? (row.valueSort ?? -1) : (row.signedSort ?? "1970-01-01");
  return `${value}|${row.id}`;
}

/** How much of a company's spending the five rows about to be printed are.
 *
 * Computed from those rows and the stored total, per request, rather than
 * precomputed: a stored percentage can assert something the rows under it
 * contradict after a partial ingest, and this one cannot.
 *
 * Null below ten contracts - "the top five are 100% of five contracts" is not a
 * finding - and null below half, where the sentence would be saying that
 * spending is spread out, which is not what it is worded to say. Measured: for
 * the 1 688 buyers with 20 or more contracts the median top-five share is
 * 81.3%.
 */
export function topFiveShare(
  rows: { value?: number }[],
  stats: Pick<ContractCompanyStats, "totalCount" | "totalValue"> | null,
): number | null {
  if (!stats || stats.totalCount < 10 || !(stats.totalValue > 0)) return null;
  const top = rows
    .slice(0, 5)
    .reduce(
      (sum, row) =>
        sum + (typeof row.value === "number" && row.value > 0 ? row.value : 0),
      0,
    );
  const share = top / stats.totalValue;
  if (!Number.isFinite(share) || share < 0.5) return null;
  // Capped: a per-company aggregate written by an earlier run than the rows can
  // put the five above the total, and „106% tej kwoty" is a bug a reader gets
  // to see.
  return Math.min(share, 1);
}

/** The one coverage document, `stats/umowy`.
 *
 * Read by three of the four routes and never computed on the fly. Null where
 * the pipeline has not run yet - a fresh environment and every emulator that
 * has not been seeded - which the pages render as „nie wczytaliśmy jeszcze
 * żadnych umów" rather than as a zero.
 */
export async function readCoverage(
  db: Firestore,
): Promise<ContractCoverage | null> {
  const doc = await db.collection("stats").doc("umowy").get();
  return doc.exists ? (doc.data() as ContractCoverage) : null;
}

/** A contract document as the endpoints return it. */
export function toContractRow(
  doc:
    | FirebaseFirestore.QueryDocumentSnapshot
    | FirebaseFirestore.DocumentSnapshot,
): ContractRow {
  const data = doc.data() as Contract;
  return {
    ...data,
    id: doc.id,
    // Tolerant reads on the two arrays a caller iterates. Nothing in this
    // feature writes them through `sanitizeFirestoreData`, but a restore from
    // an export that predates that rule would, and `array-contains` failing
    // silently is exactly how that stays unnoticed.
    nodeIds: asArray<string>(data.nodeIds),
    supplierNodeIds: asArray<string>(data.supplierNodeIds),
    nips: asArray<string>(data.nips),
    suppliers: asArray<ContractParty>(data.suppliers),
  };
}
