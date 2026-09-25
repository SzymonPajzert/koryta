/** Findings from the contracts register - „powiązania": a person in power, the
 * company tied to them, and the public institution that paid that company.
 *
 * Why a curated collection (`contractLinks`) rather than more nodes and edges:
 * the graph cannot say any of it yet. A candidacy is an `election` edge to a
 * *region*, while a contract's buyer resolves only to a *place* by NIP, so a
 * seat in "rada powiatu testowskiego" and "Starostwo Powiatowe w Testowie"
 * never meet. A shareholding is not ingested at all (KRS roles collapse to
 * Zarząd / Rada Nadzorcza / Prokurent), a wicestarosta is not an
 * `ElectionPosition`, and a relative who co-owns the supplier has no edge
 * type. Each finding is instead
 * one document per supplier NIP, written by the pipeline from the reviewed
 * research (`data/pipelines/src/analysis/payloads/contract_link.py`) and joined
 * to the `contracts` collection by document id.
 *
 * The document holds names, which `firestore.rules` otherwise keeps out of
 * precomputed documents. What keeps that safe is that the gate is not baked in:
 * `visibility` is read on every request, per reader, by
 * `server/utils/contractLinks.ts`, and an anonymous reader of a gated finding
 * is sent a teaser with no name, no company and no institution - the
 * `extraction/PersonFacts.vue` rule that a blurred name is still a published
 * name.
 */

/** How far a finding has been checked.
 *
 * `verified` passed the review *and* the adversarial pass that tried to refute
 * it, or a web researcher documented the tie; `plausible` has one open point;
 * `unreviewed` is the matching engine's label and nothing more. */
export const contractLinkStatuses = [
  "verified",
  "plausible",
  "unreviewed",
] as const;
export type ContractLinkStatus = (typeof contractLinkStatuses)[number];

/** How strong the story is, which is not how sure we are of it (see status).
 *
 * - A: holds an office now, controls the firm now (or a documented partner or
 *   relative does), and at least a fifth of the firm's money in the register
 *   came from the territory where they won;
 * - B: the same, elected in 2010 or later but not in office now;
 * - C: holds an office now, anything else;
 * - D: everything else - a repeat candidate who never won, a seat that ended
 *   long ago, money from somebody else's territory.
 */
export const contractLinkStrengths = ["A", "B", "C", "D"] as const;
export type ContractLinkStrength = (typeof contractLinkStrengths)[number];

/** Who may read the names. `public` is named to everybody; `gated` only to a
 * signed-in reader, and to everybody else as a teaser with no names. */
export const contractLinkVisibilities = ["public", "gated"] as const;
export type ContractLinkVisibility = (typeof contractLinkVisibilities)[number];

/** Which contracts the total adds up.
 *
 * - own_territory: paid by local government where the person stood;
 * - own_powiat: paid by local government in the firm's own powiat - the
 *   fallback the matching engine accepts when the person stood elsewhere;
 * - all: every contract of the firm, for a tie the research documented
 *   whoever paid (the owner's rule for relatives and partners).
 */
export const contractLinkBases = [
  "own_territory",
  "own_powiat",
  "own_territory_and_powiat",
  "all",
] as const;
export type ContractLinkBasis = (typeof contractLinkBases)[number];

/** The caveats a reader has to see beside a finding, as codes so the wording
 * lives in one place (`CONTRACT_LINK_FLAG_LABELS`). */
export const contractLinkFlags = [
  "unreviewed",
  "former_control",
  "control_through_tie",
  "never_elected",
  "own_powiat_fallback",
  "payer_outside_territory",
  "loan_excluded",
  "reverse_payment_excluded",
  "direction_unclear",
  "shared_contract",
  "whole_board",
  "coop_exemption",
  "ownership_open",
  "payer_disputed",
  "tie_unconfirmed",
  "identity_unconfirmed",
] as const;
export type ContractLinkFlag = (typeof contractLinkFlags)[number];

export interface ContractLinkCandidacy {
  year: number;
  /** Polish, as the pipeline wrote it: „rada gminy Przykładowo", „rada
   * powiatu testowskiego", „wójt Wzorcowo". */
  office: string;
  result: "won" | "lost" | "unknown";
}

/** A person in power behind the supplier.
 *
 * Each one has a stated reason to be on the card: a candidacy, a year won, an
 * office or a note on one. Somebody with none of these is a private person
 * however the research tagged them, and travels as a `ContractLinkTie` -
 * named to signed-in readers only. */
export interface ContractLinkPerson {
  name: string;
  /** `politician` was matched to PKW candidacies; `official` was found by the
   * web research (an appointed official, or a candidate the research placed). */
  kind: "politician" | "official";
  /** At the supplier: „prezes zarządu", „udziałowiec", „wspólnik"… */
  roles: string[];
  sharePct?: number;
  controlNow: boolean;
  controlSince?: string;
  controlUntil?: string;
  /** For an `official`, the office as the research established it. */
  office?: string;
  /** Anything the research added to the office: „wicestarosta testowski od
   * 2024 r.". */
  officeNote?: string;
  candidacies: ContractLinkCandidacy[];
  wonYears: number[];
  inOfficeNow: boolean;
  /** Party tags, or „komitet lokalny". */
  committees: string[];
}

/** A researched relative, partner or co-worker at the supplier. Signed-in
 * readers only: these are private people, named for their tie to the firm. */
export interface ContractLinkTie {
  name: string;
  /** The documented role that ties them: „wspólniczka", „członek zarządu". */
  tie: string;
  /** Only where a source names the relation. Never inferred from a surname. */
  family?: string;
  /** False when the research left the tie at „maybe". */
  confirmed: boolean;
}

export interface ContractLinkPlace {
  wojewodztwo?: string;
  powiat?: string;
  gmina?: string;
}

export interface ContractLinkBuyer extends ContractLinkPlace {
  name: string;
  value: number;
  contracts: number;
  /** Inside the territory where the person stood. */
  ownArea: boolean;
}

export interface ContractLinkTopContract {
  /** The `contracts` document id. */
  id: string;
  /** The register's own id, for its deep link. */
  sourceId: string;
  subject?: string;
  /** This firm's share of it. */
  value: number;
  /** The whole contract, when shared with other suppliers. */
  valueTotal?: number;
  signedAt?: string;
  suppliers: number;
  buyer: ContractLinkPlace & { name: string };
}

/** One finding, as stored at `contractLinks/cru_<nip>`. */
export interface ContractLink {
  nip: string;
  krs: string[];
  company: string;
  companySeat?: string;
  status: ContractLinkStatus;
  strength: ContractLinkStrength;
  visibility: ContractLinkVisibility;
  /** The site's order: strength, then money (`rank_for_site` in the
   * pipeline). Unique across the collection - it is the list's cursor. */
  rank: number;
  inOfficeNow: boolean;
  controlNow: boolean;
  people: ContractLinkPerson[];
  ties: ContractLinkTie[];
  /** Polish, one or two sentences, where the research wrote one. */
  why?: string;
  /** PLN, the contracts behind the finding (see `basis`). */
  total: number;
  /** PLN from the territory where the person stood. */
  ownAreaTotal: number;
  /** PLN, everything the firm has in the register window. */
  firmTotal: number;
  firmContracts: number;
  deals: number;
  basis: ContractLinkBasis;
  dateFrom?: string;
  dateTo?: string;
  /** The biggest payers, at most twelve - see `buyerCount` for all of them. */
  buyers: ContractLinkBuyer[];
  /** How many distinct institutions paid towards `total`, which may be more
   * than `buyers` lists. */
  buyerCount: number;
  /** Where the biggest payer (`buyers[0]`) sits - the place a reader filters
   * by. */
  place: ContractLinkPlace;
  topContract?: ContractLinkTopContract;
  /** `contracts` document ids behind `total`. */
  contractIds: string[];
  flags: ContractLinkFlag[];
  /** The office in two or three words, for a teaser that names nobody:
   * „mandat w radzie powiatu", „wójt", „kandydatura do rady gminy"
   * (`officeHook`), or `CONTRACT_LINK_UNCONFIRMED_HOOK` for a namesake. */
  hook: string;
  updatedAt: string;
}

/** A finding the reader may read. */
export interface ContractLinkRow extends ContractLink {
  id: string;
  locked: false;
  /** For an anonymous reader of a public finding: how many researched ties
   * were left out (they are private people), so the card can say that there
   * is more after signing in. `why` is left out with them when it would name
   * them. */
  hiddenTies?: number;
}

/** A gated finding, as an anonymous reader gets it. No name, no company, no
 * institution and no gmina: an amount and a gmina are enough to find the
 * contract in the public register and read off who took it. */
export interface ContractLinkTeaser {
  /** `ukryte_<rank>` - never the document id, which carries the NIP. */
  id: string;
  locked: true;
  rank: number;
  status: ContractLinkStatus;
  strength: ContractLinkStrength;
  /** A band, never the amount: an exact total finds the contract in the
   * public contract list, and the contract names the firm
   * (`contractLinkAmountRange`). */
  totalRange: [number, number];
  /** The same for the count of contracts (`contractLinkDealsRange`). */
  dealsRange: [number, number | null];
  inOfficeNow: boolean;
  hook: string;
  place: Pick<ContractLinkPlace, "wojewodztwo">;
}

export type ContractLinkItem = ContractLinkRow | ContractLinkTeaser;

/** What the findings add up to, precomputed at ingest (`stats/powiazania`).
 * Counts and sums only - no names, so it may be cached anywhere. */
export interface ContractLinkSummary {
  links: number;
  verified: number;
  public: number;
  gated: number;
  /** Gated findings that are nonetheless `verified`. */
  gatedVerified: number;
  /** Findings with somebody in office now. */
  inOfficeNow: number;
  /** Distinct people in office now, across all findings. */
  inOfficePeople: number;
  total: number;
  totalVerified: number;
  /** PLN behind the gated findings. */
  totalGated: number;
  byStrength: Record<ContractLinkStrength, number>;
  totalByStrength: Record<ContractLinkStrength, number>;
  byWojewodztwo: Record<
    string,
    { links: number; total: number; gated: number }
  >;
  from?: string;
  to?: string;
  computedAt: string;
}

export interface ContractLinkListResponse {
  items: ContractLinkItem[];
  nextCursor: string | null;
  /** Only on the first page. */
  summary: ContractLinkSummary | null;
}

/** The band edges teasers round to: 1-2-5 steps from a thousand złoty. */
const AMOUNT_STEPS = [
  0, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000,
  1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000,
  100_000_000,
];

/** The 1-2-5 band a total falls in: 3 600 → [2 000, 5 000]. The top band is
 * open-ended in spirit; its upper edge is the last step. */
export function contractLinkAmountRange(total: number): [number, number] {
  for (let index = 1; index < AMOUNT_STEPS.length; index++) {
    if (total < AMOUNT_STEPS[index]!) {
      return [AMOUNT_STEPS[index - 1]!, AMOUNT_STEPS[index]!];
    }
  }
  return [AMOUNT_STEPS.at(-1)!, AMOUNT_STEPS.at(-1)!];
}

/** 1, 2-4, 5-9 or 10 and more contracts. */
export function contractLinkDealsRange(deals: number): [number, number | null] {
  if (deals <= 1) return [1, 1];
  if (deals < 5) return [2, 4];
  if (deals < 10) return [5, 9];
  return [10, null];
}

/** `cru_<nip>` for a finding, or `ukryte_<rank>` for the teaser that stands in
 * for a gated one - what `/api/contracts/powiazania/<id>` and `?powiazanie=`
 * take. */
export const CONTRACT_LINK_ID_PATTERN = /^(cru_\d{10}|ukryte_\d{1,5})$/;

/** Class filter values for the list (`?klasa=`). */
export type ContractLinkClassFilter = ContractLinkStrength;

export const CONTRACT_LINK_COLLECTION = "contractLinks";
export const CONTRACT_LINK_SUMMARY_DOC = "powiazania";

/** `cru_<nip>`: one finding per supplier, so a re-run lands on the document it
 * wrote before. No hyphen, for the reason `contractDocumentId` gives. */
export function contractLinkDocumentId(nip: string): string {
  return `cru_${nip.replace(/\D/g, "")}`;
}

export const CONTRACT_LINK_STATUS_LABELS: Record<ContractLinkStatus, string> = {
  verified: "Sprawdzone",
  plausible: "Do sprawdzenia",
  unreviewed: "Niesprawdzone",
};

/** The class, as a reader is told it. Present tense and „ta osoba" rather than
 * a past-tense verb: „wygrał", „kontrolował" and „jego" put a man on every
 * card, and 51 findings lead with a woman. */
export const CONTRACT_LINK_STRENGTH_LABELS: Record<
  ContractLinkStrength,
  { short: string; long: string }
> = {
  A: {
    short: "Urzęduje dziś, płaci samorząd z terenu mandatu",
    long: "Sprawuje dziś urząd. Firmą kieruje albo ma w niej udziały ta osoba, ktoś z jej rodziny lub ze wspólników, a co najmniej piąta część pieniędzy firmy z rejestru pochodzi z terenu, na którym ta osoba zdobyła mandat.",
  },
  B: {
    short: "Mandat w przeszłości, płaci samorząd z tego terenu",
    long: "Mandat zdobyty w 2010 r. lub później, dziś bez urzędu. Firmą nadal kieruje albo ma w niej udziały ta osoba, ktoś z jej rodziny lub ze wspólników, a co najmniej piąta część pieniędzy firmy z rejestru pochodzi z terenu tego mandatu.",
  },
  C: {
    short: "Urzęduje dziś, powiązanie słabsze niż w A",
    long: "Sprawuje dziś urząd, ale reszta warunków klasy A nie jest spełniona: kontrola nad firmą należy do przeszłości, płaci ktoś spoza terenu mandatu albo stamtąd pochodzi mniej niż piąta część pieniędzy firmy.",
  },
  D: {
    short: "Słabsze powiązanie",
    long: "Kandydatura bez mandatu, mandat sprzed 2010 r., kontrola nad firmą dawno temu albo pieniądze spoza terenu, gdzie ta osoba kandydowała.",
  },
};

/** Worded to fit a woman as well as a man - nouns, gerunds, „ta osoba" - for
 * the reason the strength labels give.
 *
 * Each says no more than the rule that sets the flag, since the card prints
 * it beside a named person: `never_elected` is „no won result", not a count
 * of lost ones (a result PKW left unknown is neither); `payer_outside_territory`
 * is the firm's money under a fifth, which can hold while every payer this
 * finding counts is local; `tie_unconfirmed` is research left at „maybe",
 * which is not always about family. */
export const CONTRACT_LINK_FLAG_LABELS: Record<ContractLinkFlag, string> = {
  unreviewed: "Wynik automatyczny, jeszcze nie sprawdzony",
  former_control: "Kontrola nad firmą tylko w przeszłości",
  control_through_tie: "Dziś firmę kontrolują powiązane osoby",
  never_elected: "Żadnego mandatu w wynikach PKW",
  own_powiat_fallback:
    "Płaci samorząd z powiatu firmy, nie z terenu kandydowania",
  payer_outside_territory:
    "Z terenu kandydowania pochodzi mniej niż piąta część pieniędzy firmy",
  loan_excluded: "Nie liczymy kredytu, którego bank udzielił samorządowi",
  reverse_payment_excluded:
    "Nie liczymy umów, w których to firma płaciła samorządowi",
  direction_unclear: "Nie w każdej umowie wiadomo, kto komu płaci",
  shared_contract: "Największą umowę firma dzieli z innymi wykonawcami",
  whole_board: "Kilka osób z zarządu pasuje do kandydatów",
  coop_exemption: "Spółdzielnia: jej członków nie ma w KRS",
  ownership_open: "Możliwe, że udziały w firmie ma samorząd lub państwo",
  payer_disputed: "Płatnik może podlegać innemu szczeblowi samorządu",
  tie_unconfirmed: "Powiązanie z firmą wymaga potwierdzenia",
  identity_unconfirmed: "Nie mamy pewności, że to ta sama osoba",
};

/** Whether a flag is a reason to doubt the finding, as opposed to a note on
 * how the total was counted. Drives which ones a card shows by default. */
export const CONTRACT_LINK_FLAG_WARNS: Record<ContractLinkFlag, boolean> = {
  unreviewed: true,
  former_control: false,
  control_through_tie: false,
  never_elected: false,
  own_powiat_fallback: false,
  payer_outside_territory: false,
  loan_excluded: false,
  reverse_payment_excluded: false,
  direction_unclear: true,
  shared_contract: false,
  whole_board: true,
  coop_exemption: true,
  ownership_open: true,
  payer_disputed: true,
  tie_unconfirmed: true,
  identity_unconfirmed: true,
};

/** The candidacies grouped by office, won ones first and newest first:
 * [{office: „rada powiatu testowskiego", won: [2014, 2024], lost: [], unknown:
 * [2018]}].
 *
 * `unknown` is kept apart from `lost`: PKW's „n/a" is not a lost election -
 * 203 candidacies carry it, some between two wins - and a card that printed it
 * as „bez mandatu" would state something false about a named person. */
export function candidacyOffices(candidacies: ContractLinkCandidacy[]): {
  office: string;
  won: number[];
  lost: number[];
  unknown: number[];
}[] {
  const byOffice = new Map<
    string,
    Record<ContractLinkCandidacy["result"], number[]>
  >();
  for (const candidacy of candidacies) {
    const entry = byOffice.get(candidacy.office) ?? {
      won: [],
      lost: [],
      unknown: [],
    };
    entry[candidacy.result].push(candidacy.year);
    byOffice.set(candidacy.office, entry);
  }
  const years = (list: number[]) => [...new Set(list)].sort((a, b) => a - b);
  return Array.from(byOffice, ([office, entry]) => ({
    office,
    won: years(entry.won),
    lost: years(entry.lost),
    unknown: years(entry.unknown),
  })).sort(
    (a, b) =>
      Number(b.won.length > 0) - Number(a.won.length > 0) ||
      Math.max(0, ...b.won, ...b.lost, ...b.unknown) -
        Math.max(0, ...a.won, ...a.lost, ...a.unknown),
  );
}

/** What a teaser calls an office somebody won or holds. A council is named by
 * the seat - „radny" and „przewodniczący" are a man's words, PKW's data
 * carries nobody's gender, and the research's own „radna" would be lost to a
 * fixed form either way. The executive titles stay: Polish uses them for a
 * woman as well („pani wójt", „pani burmistrz"). */
const HELD_HOOKS: Record<string, string> = {
  "rada gminy": "mandat w radzie gminy",
  "rada powiatu": "mandat w radzie powiatu",
  sejmik: "mandat w sejmiku",
  "przewodnictwo rady gminy": "przewodnictwo rady gminy",
  wójt: "wójt",
  burmistrz: "burmistrz",
  "prezydent miasta": "prezydent miasta",
  starosta: "starosta",
  wicestarosta: "wicestarosta",
  urząd: "praca w urzędzie",
};

/** What a teaser calls somebody who stood but has no mandate on record. The
 * office's own name after „na" - „kandydatura na wójta" is how the office is
 * named whoever stands for it. */
const CANDIDACY_HOOKS: Record<string, string> = {
  "rada gminy": "kandydatura do rady gminy",
  "rada powiatu": "kandydatura do rady powiatu",
  sejmik: "kandydatura do sejmiku",
  wójt: "kandydatura na wójta",
  burmistrz: "kandydatura na burmistrza",
  "prezydent miasta": "kandydatura na prezydenta miasta",
};

/** The hook of a finding flagged `identity_unconfirmed`, in place of
 * `officeHook`'s: the office the research wrote down may be held by somebody
 * else of the same name, and a teaser that named it would claim it of this
 * person with nothing beside it to say otherwise. The server sets it, as the
 * one that reads the flags. */
export const CONTRACT_LINK_UNCONFIRMED_HOOK = "możliwa zbieżność nazwisk";

/** „mandat w radzie powiatu", „wójt", „kandydatura do rady gminy" - the office
 * without the place, which is what a teaser may say about a person it does
 * not name.
 *
 * Nouns for the seat, not for the person, so a hook fits a woman as well
 * (`HELD_HOOKS`). „Kandydatura", not „kandydat", for the same reason, and
 * because it says somebody stood without saying they lost - which for a
 * result PKW left unknown would be a guess. */
export function officeHook(person: ContractLinkPerson | undefined): string {
  if (!person) return "osoba z władz";
  const offices = candidacyOffices(person.candidacies);
  const won = offices.find((entry) => entry.won.length > 0);
  if (won) return HELD_HOOKS[officeKind(won.office)] ?? "osoba z mandatem";
  if (!offices.length) {
    // The office the research wrote for an official, or for a secondary
    // person the years they won without the candidacies behind them.
    const held = HELD_HOOKS[officeKind(person.office ?? "")];
    if (held) return held;
    return person.wonYears.length ? "osoba z mandatem" : "osoba z władz";
  }
  // Won somewhere the candidacies do not say: not the office stood for here.
  if (person.wonYears.length) return "osoba z mandatem";
  return (
    CANDIDACY_HOOKS[officeKind(offices[0]!.office)] ?? "kandydatura w wyborach"
  );
}

/** The kind of office in a PKW or research office string, as the body or the
 * post and never the person in it: „rada gminy" for „radna gminy" and „radny
 * miasta" alike. The keys of `HELD_HOOKS` and `CANDIDACY_HOOKS`. */
export function officeKind(office: string): string {
  const text = office.toLowerCase();
  if (/wicestarost/.test(text)) return "wicestarosta";
  if (/starost/.test(text)) return "starosta";
  if (/sejmik/.test(text)) return "sejmik";
  if (/rad\w* powiatu|powiat/.test(text)) return "rada powiatu";
  if (/przewodnicząc\w* rady gminy/.test(text)) {
    return "przewodnictwo rady gminy";
  }
  if (/rad\w* (gminy|miejsk|miasta)|radn/.test(text)) return "rada gminy";
  if (/prezydent/.test(text)) return "prezydent miasta";
  if (/burmistrz/.test(text)) return "burmistrz";
  if (/wójt/.test(text)) return "wójt";
  if (/pracowni|urz[ąę]d/.test(text)) return "urząd";
  return "";
}
