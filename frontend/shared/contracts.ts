/** Public contracts - „umowy" - as the site stores and shows them.
 *
 * A contract is a record from a register, not a claim the site makes, and that
 * one difference is why it is a top level `contracts` collection rather than a
 * sixth node type or a ninth edge type:
 *
 * - a node type would inherit slugs, the sitemap, `nameChunksLower`,
 *   `onNodeWritten` and the stats sweep, none of which a contract wants, at
 *   ~150 000 documents;
 * - an edge write dirties its source node's stats through `edgeStatsDirty`,
 *   which is what the 6.7 M read spike of 30 August 2026 was;
 * - and neither has anywhere to put a value, a subject or a legal basis for a
 *   redaction.
 *
 * There is deliberately **no `published` field**. Everything here comes from a
 * register that has already published it, so a contract this site holds is a
 * contract this site shows. What *is* gated is the people half - who we think
 * sits on the board of the company that took the money - and that lives on
 * edges, is decided per reader by the endpoint, and never touches this
 * document. See `server/api/contracts/`.
 *
 * The first source is CRU, the Centralny Rejestr Umów. Field names follow
 * `data/pipelines/src/entities/cru.py` in meaning but not in language: the
 * pipeline keeps the register's Polish because it is mirroring the register,
 * and the site uses the same English shape as `Node` and `Edge` because it is
 * rendering one record type among several.
 */

/** Every register a contract can come from.
 *
 * A tuple so a zod validator can say `z.enum(contractSources)` rather than
 * writing the list out again - the arrangement `nodeTypes` and `edgeTypes`
 * already have, and for the same reason.
 */
export const contractSources = ["cru"] as const;
export type ContractSource = (typeof contractSources)[number];

/** What a party to a contract is.
 *
 * `jsfp` is a jednostka sektora finansów publicznych - the institution doing
 * the spending. `firma` is anything registered that is not one. `osoba` is a
 * private individual, and is the only kind that carries no identifier at all:
 * see `ContractParty.name` for what is and is not stored about them.
 */
export const contractPartyKinds = ["jsfp", "firma", "osoba"] as const;
export type ContractPartyKind = (typeof contractPartyKinds)[number];

/** Why a register withheld something, kept verbatim.
 *
 * CRU can redact a contract's subject, its value, or a party's identity, and
 * answers with the legal basis where the value would be. 766 of the 149 683
 * contracts in the six weeks first ingested withhold a value, 160 a subject and
 * 2 525 party rows an identity - rare, but frequent enough that an empty cell
 * would be read as a bug in this site rather than as a decision by a public
 * body.
 *
 * Note that a redaction and a missing value are separate questions: five
 * contracts carry the flag *and* state a figure. Ask about each independently
 * rather than inferring one from the other - `contractValueLabel` in
 * `shared/money.ts` is where that rule is written down.
 */
export interface ContractRedaction {
  /** What was withheld, as the register names it: „Wartość umowy". */
  scope?: string;
  /** The legal basis, quoted rather than interpreted. */
  basis?: string;
  comment?: string;
  /** The organ or office that decided. */
  authority?: string;
}

/** One side of a contract.
 *
 * The counterparty is stored here in full - name and identifiers - rather than
 * only as a link, because most of them have no page on this site and never
 * will: naming every counterparty in the first six weeks of the register would
 * have meant 5 274 new company pages, 3 457 of them for a single contract. A
 * reader is owed the name of the company that took the money whether or not we
 * have anything else to say about it.
 */
export interface ContractParty {
  /** Which side. `strony[0]` in the register - the one that is spending - is
   * always the buyer. */
  role: "buyer" | "supplier";
  kind?: ContractPartyKind;
  /** The registered name.
   *
   * **Absent for `kind: "osoba"`, on purpose.** The register publishes a
   * private individual's first and last name under the public-information act,
   * and 12.4% of contracts have one - a named actor paid 600 zł by a
   * university, a musician paid 1 500 zł by a town hall. Mirroring that name
   * onto a site whose whole purpose is to aggregate people across institutions,
   * and to have Google index the result, is a different act from a register
   * entry, so the ingest drops it and the UI says „osoba fizyczna". Flip
   * `STORE_INDIVIDUAL_NAMES` in `server/api/ingest/contract.post.ts` to change
   * that, and expect to have an opinion about why. */
  name?: string;
  /** Ten digits, check-digit valid. Absent for `kind: "osoba"` and for a
   * redacted party. */
  nip?: string;
  /** Nine or fourteen digits. */
  regon?: string;
  /** This party's page on the site, where it has one. Resolved once at ingest
   * from `nip`/`regon` against `Company.nipNumber`/`regonNumber`, not at read
   * time: a contract list must not cost one lookup per row. */
  nodeId?: string;
  /** What that page calls the company, denormalised at ingest.
   *
   * A name is not a gated claim - unlike who sits on the board, which is
   * resolved live on every request and never stored here - so it is safe to
   * carry, and carrying it saves roughly forty `getAll` reads per page of
   * twenty rows. A company renamed since the last ingest shows its old name
   * until `scripts/migrate/relink-contracts.ts` runs; the link still resolves,
   * because `parseEntityUrlSlug` takes the id from the last dash segment and
   * ignores the words before it. */
  nodeName?: string;
  /** The seat, as the register states it. Enough to tell two companies of the
   * same name apart without a page for either. */
  city?: string;
  redaction?: ContractRedaction;
}

/** One amendment, from the register's `zmiany_umowy`. */
export interface ContractAmendment {
  /** „Wygaśniecie umowy", „Aneks", as the register words it. */
  kind?: string;
  /** ISO `YYYY-MM-DD`, or absent where the register's own date did not parse. */
  date?: string;
  comment?: string;
}

/** One public contract. */
export interface Contract {
  id?: string;
  source: ContractSource;
  /** The register's own identifier, which is what makes a re-ingest land on the
   * document it already wrote rather than a second copy of it. */
  sourceId: string;

  /** The contract number the institution gave it, e.g. „WKS.526.60.2026".
   * Absent where the register records that there is none. */
  number?: string;
  /** What was bought. Median 48 characters, 90th percentile 155 - two lines on
   * a phone - but the register allows up to 1 500. */
  subject?: string;
  subjectRedaction?: ContractRedaction;
  /** In złoty. Absent where withheld or never stated; 0 is a real value that
   * 251 contracts in the first window carry. */
  value?: number;
  valueRedaction?: ContractRedaction;
  /** The register's own prose about the value, where it gave any. */
  valueNote?: string;

  /** When it was signed. ISO `YYYY-MM-DD`. */
  signedAt?: string;
  /** When it ends. Absent on three quarters of contracts. */
  endsAt?: string;
  openEnded?: boolean;
  /** The register's `status_umowy`, as a boolean because it has exactly two
   * values. */
  active?: boolean;
  /** When the register published it, which is not when it was signed. */
  publishedAt?: string;
  amendments?: ContractAmendment[];

  buyer: ContractParty;
  /** Everyone on the other side. One on 99.2% of contracts, up to seven. */
  suppliers: ContractParty[];

  /** Every node id this contract touches, either end.
   *
   * Denormalised so that „every contract this company is on" is one
   * `array-contains` rather than two queries and a merge. **Must be written as
   * a real array**: `sanitizeFirestoreData` turns a nested array into a
   * numbered-key map, against which `array-contains` silently matches nothing
   * rather than failing - see `asArray` in `shared/model.ts`. The ingest writes
   * this field directly for that reason.
   */
  nodeIds: string[];
  /** Whether any end resolved to a page here. Firestore cannot ask whether an
   * array is non-empty, and „the contracts we can say something about" is the
   * default view of the whole feature. */
  linked: boolean;
  /** Whether the buyer *and* at least one supplier resolved. 154 contracts in
   * the first window do, and they are the ones where this site can show both
   * boards. */
  bothLinked: boolean;

  /** Every distinct NIP and nine-digit REGON on the contract, as the register
   * gave them.
   *
   * The join *key*, kept beside the join *result*. `nodeIds` is decided once,
   * at ingest, against the companies that existed then - so publishing a
   * company tomorrow would leave every contract it is on still saying
   * `linked: false`, with nothing at read time able to notice. This field is
   * what makes that recoverable: `relink-contracts.ts` asks
   * `nips array-contains <nip>` and repairs the handful of documents that
   * changed, instead of rewriting all of them. */
  nips: string[];
  /** The buyer's node id, where it resolved.
   *
   * A scalar beside the `nodeIds` array so „what this institution spent" is an
   * equality filter rather than an `array-contains` plus a post-filter -
   * Firestore allows only one `array-contains` per query, and the per-company
   * views need the other one for nothing else. */
  buyerNodeId?: string;
  /** Every supplier's node id, for the mirror-image question: what this
   * company was paid. */
  supplierNodeIds: string[];
  /** Whether any party is a private individual.
   *
   * Read for exactly one purpose: suppressing the „Zobacz w rejestrze" link.
   * Their name is not stored here, but the contract's subject, institution,
   * date and amount are, and a deep link into the register turns that
   * anonymised row back into a one-click lookup of the name. 18 505 contracts
   * in the first window (12.4%) carry one. */
  hasIndividual: boolean;
  /** The register indexes this contract but would not serve its details.
   *
   * 42 rows in the first window: `strony` is empty, there is no buyer NIP, and
   * `detale_blad` says why. Kept and rendered as one honest line rather than
   * dropped, because dropping them is a silent edit of the register. */
  detailsUnavailable?: boolean;

  /** `value ?? -1`, and **always written**.
   *
   * Firestore does not sort a document that lacks the ordered field - it
   * excludes it - so ordering on `value` itself would silently drop the 764
   * contracts whose value is withheld or was never stated from every
   * money-sorted view, and nothing would fail. Order on this; print `value`.
   *
   * `-1` rather than `0` because 0 zł is a real value that 251 contracts in
   * the first window carry, and they belong above the ones with no figure at
   * all rather than mixed in among them. */
  valueSort: number;
  /** `signedAt ?? publishedAt ?? "1970-01-01"`, and always written, for the
   * same reason `valueSort` is: a row with no signing date must not vanish
   * from the newest-first list. */
  signedSort: string;
}

/** What one company's contracts add up to, precomputed.
 *
 * One document per touched company - 825 of them after the first window - so
 * that the „Umowy publiczne" section on a company page costs **one read** on
 * the 4 103 companies that have none, rather than a query that finds nothing.
 * /instytucja/ pages draw 42% of the site's search impressions, so a section
 * that is empty for five companies in six has to be cheap when it is empty.
 *
 * Safe to denormalise precisely because it holds no person data. The people
 * half is never precomputed anywhere: publishing or unpublishing somebody has
 * to take effect at once, and nothing in this repo can purge the CDN copy of a
 * response a name was baked into.
 */
export interface ContractCompanyStats {
  nodeId: string;
  buyerCount: number;
  buyerValue: number;
  supplierCount: number;
  supplierValue: number;
  totalCount: number;
  totalValue: number;
  /** The median across both roles.
   *
   * Printed beside the sum, never instead of it and never without it. The
   * distribution is not one a sum describes: median 1 436 zł, 90th percentile
   * 38 490 zł, maximum 1 105 491 462 zł, so a company's total is usually one
   * contract and a long tail of stationery. */
  medianValue: number;
  lastSignedAt?: string;
  /** ISO instant. Printed as „stan na ..." so a stale aggregate says so. */
  computedAt: string;
}

/** How much of the register we hold, and how much of it we can say anything
 * about. One document, `stats/umowy`.
 *
 * Every count and both dates on every contracts surface are read from here.
 * No Polish copy anywhere states a figure or a date as a literal: the window
 * grows the moment the pipeline runs again, and a hardcoded „od 1 lipca do
 * 10 sierpnia 2026" would quietly become a false claim about coverage with
 * nothing failing.
 */
export interface ContractCoverage {
  /** How many contracts the register published in the window - including the
   * ones we did not keep. */
  total: number;
  /** How many contract documents this site actually holds. */
  stored: number;
  /** How many of them have at least one end on a company we describe. */
  linked: number;
  /** How many have both ends on one. */
  bothLinked: number;
  /** Distinct companies touched. */
  companies: number;
  /** People we may name to a logged out reader - node published and
   * employment published. The figure that says how much of what we know is
   * public. */
  namedPeople: number;
  /** How many stored contracts name a private individual we do not name. */
  withIndividual: number;
  /** Distinct contracting institutions in the register, ours or not. The
   * denominator for „znamy władze N z M instytucji". */
  registerInstitutions: number;
  /** The window, as ISO days. */
  from: string;
  to: string;
  computedAt: string;
  sources: ContractSource[];
}

/** One person we may name beside a contract.
 *
 * `ours` is the whole gate. A response to a logged out reader contains only
 * `ours: false` entries; the rest are counted, never sent. Withholding by CSS
 * is not an option - `extraction/PersonFacts.vue` blurs placeholder bars
 * rather than real sentences for exactly this reason, since a blurred name is
 * still in the html of an indexed page.
 */
export interface ContractPerson {
  id: string;
  name: string;
  role?: string;
  parties: string[];
  /** True when the person's page or the employment itself is still a draft -
   * what the UI marks „nasza opinia". */
  ours: boolean;
}

/** The people at one party to a contract, as far as this reader may see. */
export interface ContractPartyPeople {
  nodeId: string;
  people: ContractPerson[];
  /** Withheld from this reader, and always 0 for a signed-in one. Drives the
   * login prompt and nothing else. A count reveals no identity, and the site
   * already tells a logged out reader how many facts it is not showing them. */
  hiddenPeople: number;
  /** Left off by the display cap rather than by the gate. The difference
   * matters in the copy: this is „+4 więcej", never „po zalogowaniu". */
  morePeople: number;
}

/** A contract as an endpoint returns it, with the people the reader may see
 * where the surface pays for them. */
export interface ContractRow extends Contract {
  id: string;
  people?: ContractPartyPeople[];
}

/** One person on the signed-in exploration surface: who they are, where they
 * sit, and how much public money went through those institutions. */
export interface ContractPersonRow {
  person: ContractPerson;
  companies: {
    nodeId: string;
    name: string;
    role?: string;
    ours: boolean;
  }[];
  contractCount: number;
  totalValue: number;
  lastSignedAt?: string;
}

/** The document id for a contract, derived from the register and its id.
 *
 * Derived rather than auto-allocated so that re-ingesting the register is a
 * no-op instead of a second copy of everything - the same reasoning as
 * `edgeDocumentId`. The hyphens come out of CRU's UUID because ids on this site
 * are parsed as the last dash-separated segment of a url slug
 * (`parseEntityUrlSlug`), and a contract that later earns a page of its own
 * should not need a migration to get one.
 */
export function contractDocumentId(
  source: ContractSource,
  sourceId: string,
): string {
  return `${source}_${sourceId.replace(/-/g, "")}`;
}

/** Where to read this contract in the register it came from.
 *
 * The route is `umowa/:id`, read off the register's own Angular router rather
 * than guessed: every path on rejestrumow.gov.pl answers 200 with the same
 * application shell, so a URL that resolves and one that does not are
 * indistinguishable over HTTP.
 */
/** Partial on purpose, twice over: it makes the lookup below legitimately
 * optional - which is what a document carrying a `source` this build has never
 * heard of needs, rather than a throw on a page - and it is the shape a second
 * register gets added to. */
const CONTRACT_SOURCE_URLS: Partial<
  Record<ContractSource, (id: string) => string>
> = {
  cru: (id) => `https://rejestrumow.gov.pl/umowa/${id}`,
};

export function contractSourceUrl(contract: {
  source: ContractSource;
  sourceId: string;
}): string | undefined {
  // A table rather than a branch: with one source a `=== "cru"` test is a
  // comparison the compiler already knows the answer to, which this repo lints
  // as an error, and the table is where a second register would be added
  // anyway. The optional call is what answers `undefined` for a stored `source`
  // this build does not know, instead of throwing on somebody's page.
  return CONTRACT_SOURCE_URLS[contract.source]?.(contract.sourceId);
}

/** What the register is called on screen. */
export const contractSourceNames: Record<ContractSource, string> = {
  cru: "Centralny Rejestr Umów",
};

/** A contract as it comes back off a Firestore read, where every field is
 * whatever was written rather than whatever the interface promises.
 *
 * `Contract` describes what the ingest writes; this describes what a reader
 * gets, and the two are not the same thing. A document written before a field
 * existed simply lacks it, and the helpers below run over documents nobody has
 * re-ingested. Without this the guards in them are dead code to the compiler -
 * `no-unnecessary-condition` says so - and removing the guards instead is how a
 * company page throws on the one contract that predates a migration.
 */
export type StoredContract = Omit<Contract, "buyer" | "suppliers"> & {
  buyer?: ContractParty;
  suppliers?: ContractParty[];
};

/** Everyone on the contract, buyer first, which is the order the register
 * states them in and the order a sentence about the contract reads in. */
export function contractParties(contract: StoredContract): ContractParty[] {
  return [contract.buyer, ...(contract.suppliers ?? [])].filter(
    (party): party is ContractParty => !!party,
  );
}

/** The other side of the contract from `nodeId`.
 *
 * On a company's own page every row is about somebody else, and which side that
 * is depends on which side this company is on. Returns the buyer when the node
 * is a supplier, the first supplier when it is the buyer, and the first
 * supplier when the node is on neither - which is the case on the public list,
 * where „who paid whom" is read left to right anyway.
 */
export function contractCounterparty(
  contract: StoredContract,
  nodeId?: string,
): ContractParty | undefined {
  if (nodeId && contract.buyer?.nodeId === nodeId) {
    return contract.suppliers?.[0];
  }
  if (nodeId && contract.suppliers?.some((p) => p.nodeId === nodeId)) {
    return contract.buyer;
  }
  return contract.suppliers?.[0];
}

/** „osoba fizyczna" where the register named a private individual we do not
 * name, the party's name otherwise, and „strona utajniona" where the register
 * itself withheld it.
 *
 * One function because three components print this and a fourth would get it
 * wrong - `relationPeriodLabel` was extracted for exactly this reason after two
 * copies of it printed „undefined - obecnie" on 117 published people.
 */
export function contractPartyLabel(party: ContractParty | undefined): string {
  if (!party) return "—";
  if (party.name) return party.name;
  if (party.kind === "osoba") return "osoba fizyczna";
  if (party.redaction) return "strona utajniona";
  return "—";
}

/** The three Polish forms of „umowa", for `polishCounting`. Exported so that
 * every caption counting contracts declines them the same way. */
export const contractForms: [string, string, string] = [
  "umowa",
  "umowy",
  "umów",
];
