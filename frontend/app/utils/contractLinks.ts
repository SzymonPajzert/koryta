import { nominativeNoun } from "~/composables/polish";
import { longDate, monthYear } from "~~/shared/dates";
import { plnCompact } from "~~/shared/money";
import {
  CONTRACT_LINK_FLAG_LABELS,
  candidacyOffices,
  type ContractLinkPerson,
  type ContractLinkRow,
  type ContractLinkStrength,
} from "~~/shared/contractLinks";
import type { ContractRow } from "~~/shared/contracts";

/** The words a finding card is made of, in Polish, from the structured fields.
 *
 * Built here rather than stored, so the pipeline sends facts and the site owns
 * the sentence - and so every card says it the same way. Never „podpisał",
 * „odpowiada za" or „korupcja": the join is a KRS seat and a register entry,
 * and nothing in it is evidence of who signed what or why. */

/** „2014, 2018 i 2024". */
export function polishList(items: (string | number)[]): string {
  const words = items.map(String);
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} i ${words.at(-1)}`;
}

/** The office a person holds or held, as a reader should see it first:
 * „rada powiatu testowskiego — mandat: 2014, 2018 i 2024", or for somebody who
 * never won, „rada gminy Przykładowo — kandydatura bez mandatu: 1998 i 2002".
 * Nouns rather than verbs: „kandydował(a)" would guess at a gender the data
 * does not carry. A result PKW left unknown is said to be unknown, never „bez
 * mandatu" (`candidacyOffices`). */
export function personOfficeLine(person: ContractLinkPerson): string {
  if (person.office) return person.office;
  const offices = candidacyOffices(person.candidacies);
  const won = offices.filter((entry) => entry.won.length > 0);
  if (won.length) {
    return won
      .slice(0, 2)
      .map((entry) => `${entry.office} — mandat: ${polishList(entry.won)}`)
      .join("; ");
  }
  if (offices.length) {
    const first = offices[0]!;
    const parts: string[] = [];
    if (first.lost.length) {
      parts.push(`kandydatura bez mandatu: ${polishList(first.lost)}`);
    }
    if (first.unknown.length) {
      parts.push(
        `${first.lost.length ? "" : "kandydatura, "}wynik nieznany: ${polishList(first.unknown)}`,
      );
    }
    return `${first.office} — ${parts.join("; ")}`;
  }
  if (person.wonYears.length) return `mandat: ${polishList(person.wonYears)}`;
  return "";
}

/** Every office line an expanded card lists for a person: the office the
 * research wrote, one line per office stood for - „rada gminy Wzorcowo: mandat
 * 2002 i 2010; wynik nieznany 2006" - and the research's note. A secondary
 * person comes without candidacies but often with the years they won, which
 * are then the line, so nobody on a card is there with no stated reason; one
 * with none at all is a tie, not a person (`ContractLinkPerson`). */
export function personOfficeLines(person: ContractLinkPerson): string[] {
  const lines: string[] = [];
  if (person.office) lines.push(person.office);
  for (const entry of candidacyOffices(person.candidacies)) {
    const parts: string[] = [];
    if (entry.won.length) parts.push(`mandat ${polishList(entry.won)}`);
    if (entry.lost.length) parts.push(`bez mandatu ${polishList(entry.lost)}`);
    if (entry.unknown.length) {
      parts.push(`wynik nieznany ${polishList(entry.unknown)}`);
    }
    lines.push(`${entry.office}: ${parts.join("; ")}`);
  }
  if (!lines.length && person.wonYears.length) {
    lines.push(`mandat: ${polishList(person.wonYears)}`);
  }
  if (person.officeNote) lines.push(person.officeNote);
  return lines;
}

/** „21 listopada 2025 r.", or as much of it as the register gave. */
function controlDate(iso: string): string {
  const day = longDate(iso, "");
  if (day) return `${day} r.`;
  const month = /^\d{4}-\d{2}$/.test(iso) ? monthYear(`${iso}-01`) : "";
  return `${month || iso.slice(0, 4)} r.`;
}

/** „udziałowiec · 33% udziałów · do 21 listopada 2025 r."
 *
 * The whole date and not the year: that control ended ten months before the
 * first contract is often the fact that clears somebody, and „do 2025 r."
 * hides it. `withSince` adds when it began, for the expanded card. */
export function personRoleLine(
  person: ContractLinkPerson,
  withSince = false,
): string {
  const parts: string[] = [];
  if (person.roles.length) parts.push(person.roles.join(", "));
  if (person.sharePct !== undefined) parts.push(`${person.sharePct}% udziałów`);
  const since =
    withSince && person.controlSince
      ? `od ${controlDate(person.controlSince)}`
      : "";
  if (!person.controlNow) {
    const until = person.controlUntil
      ? `do ${controlDate(person.controlUntil)}`
      : "";
    parts.push([since, until].filter(Boolean).join(" ") || "w przeszłości");
  } else if (since) {
    parts.push(since);
  }
  return parts.join(" · ");
}

/** The people in the order a card shows them: whoever holds an office today
 * first, otherwise as the research listed them. A card whose letter says
 * „urzęduje dziś" and whose first name does not is read as a card about the
 * wrong person. */
export function orderedPeople(
  people: ContractLinkPerson[],
): ContractLinkPerson[] {
  return [...people].sort(
    (a, b) => Number(b.inOfficeNow) - Number(a.inOfficeNow),
  );
}

/** Share of the firm's money in the register that the finding's contracts
 * are, as a whole percent; null when the firm's total is unknown. */
export function linkShare(link: Pick<ContractLinkRow, "total" | "firmTotal">) {
  if (!link.firmTotal) return null;
  return Math.round((100 * link.total) / link.firmTotal);
}

/** How many institutions paid besides the biggest one. From `buyerCount`,
 * not from `buyers`, which lists at most twelve: a firm with 45 payers reads
 * as „i 11 innych" when counted off the list. */
export function otherBuyerCount(
  link: Pick<ContractLinkRow, "buyers" | "buyerCount">,
): number {
  // `|| 0` for a document written before `buyerCount` was.
  return Math.max(0, Math.max(link.buyerCount || 0, link.buyers.length) - 1);
}

/** The sentence under a card's names, when the research wrote none:
 * „Zamawiający: GMINA TESTOWO. Razem 1,2 mln zł — 65% tego, co firma dostała
 * w rejestrze umów w tym okresie." „Zamawiający" is the register's own word,
 * and it spares the sentence a verb whose gender depends on whether the payer
 * is a gmina, a starostwo or a urząd. */
export function linkSentence(
  link: ContractLinkRow,
  /** False where the card already lists the payers. */
  withPayer = true,
): string {
  const payer = link.buyers[0]?.name ?? link.topContract?.buyer.name;
  const share = linkShare(link);
  const more = otherBuyerCount(link);
  const others =
    more > 0
      ? ` i ${more} ${nominativeNoun(more, "inna jednostka", "inne jednostki", "innych jednostek")}`
      : "";
  const shareText =
    share === null
      ? ""
      : share >= 99
        ? " — wszystko, co firma dostała w rejestrze umów w tym okresie"
        : ` — ${share}% tego, co firma dostała w rejestrze umów w tym okresie`;
  const money = `Razem ${plnCompact(link.total)}${shareText}.`;
  return payer && withPayer
    ? `Zamawiający: ${payer}${others}. ${money}`
    : money;
}

/** The closing row of „Kto płacił", for the payers past the twelve listed -
 * „i jeszcze 33 jednostki — 1,8 mln zł (48 umów)" - so that the list adds up
 * to the total above it. Empty when the list is complete. */
export function unlistedBuyersLine(
  link: Pick<ContractLinkRow, "buyers" | "buyerCount" | "total" | "deals">,
): string {
  const count = (link.buyerCount || 0) - link.buyers.length;
  if (count <= 0) return "";
  const listed = (key: "value" | "contracts") =>
    link.buyers.reduce((sum, buyer) => sum + buyer[key], 0);
  const value = link.total - listed("value");
  const contracts = link.deals - listed("contracts");
  const noun = nominativeNoun(count, "jednostka", "jednostki", "jednostek");
  // Under a złoty is rounding between two sums of the same contracts.
  const money = value >= 1 ? ` — ${plnCompact(value)}` : "";
  const deals =
    money && contracts > 0
      ? ` (${contracts} ${nominativeNoun(contracts, "umowa", "umowy", "umów")})`
      : "";
  return `i jeszcze ${count} ${noun}${money}${deals}`;
}

/** The colour a strength class is drawn in - a signal on the card's rail,
 * never the only one (the letter and the label say the same). */
export const STRENGTH_TOKENS: Record<ContractLinkStrength, string> = {
  A: "ink-danger",
  B: "ink-warning",
  C: "ink-info",
  D: "ink-neutral",
};

/** „lip 2026 – wrz 2026", or a single month. */
export function linkPeriod(from?: string, to?: string): string {
  const format = (day: string) =>
    new Intl.DateTimeFormat("pl-PL", {
      month: "short",
      year: "numeric",
    }).format(new Date(`${day}T12:00:00Z`));
  if (!from && !to) return "";
  if (!from || !to || from.slice(0, 7) === to.slice(0, 7)) {
    return format((from ?? to)!);
  }
  return `${format(from)} – ${format(to)}`;
}

/** Why a finding is in the weaker classes, in two or three words - so a card
 * says „kandydatura bez mandatu" instead of a letter. Empty for A and B, whose
 * letter already says the one thing that matters. */
export function strengthReason(link: ContractLinkRow): string {
  if (link.strength === "A" || link.strength === "B") return "";
  const flags = new Set(link.flags);
  if (link.strength === "C") {
    if (!link.controlNow) return "kontrola w przeszłości";
    if (flags.has("own_powiat_fallback")) return "płatnik z powiatu firmy";
    return flags.has("payer_outside_territory") ? outsideReason(link) : "";
  }
  if (flags.has("never_elected")) return "kandydatura bez mandatu";
  if (flags.has("former_control")) return "kontrola w przeszłości";
  if (flags.has("own_powiat_fallback")) return "płatnik z powiatu firmy";
  if (flags.has("payer_outside_territory")) return outsideReason(link);
  const lastWin = Math.max(0, ...link.people.flatMap((p) => p.wonYears));
  if (!lastWin || lastWin >= 2010) return "słabsze powiązanie";
  // PKW's „n/a" after the last win may be a later mandate: „ostatni" would
  // deny one nobody knows about.
  const unknownLater = link.people.some((person) =>
    person.candidacies.some(
      (candidacy) => candidacy.result === "unknown" && candidacy.year > lastWin,
    ),
  );
  return `ostatni ${unknownLater ? "znany " : ""}mandat w ${lastWin} r.`;
}

/** `payer_outside_territory` is the firm's money - under a fifth of it from
 * where the person stood - so it can be set while the payers this finding
 * counts are local, or while there are none. „Płatnik z innego terenu" only
 * where the biggest one is. */
function outsideReason(link: Pick<ContractLinkRow, "buyers">): string {
  return link.buyers[0]?.ownArea === false
    ? "płatnik z innego terenu"
    : "mało pieniędzy z terenu mandatu";
}

const NBSP = "\u00a0";
const STEP_NUMBER = new Intl.NumberFormat("pl-PL", {
  maximumFractionDigits: 1,
});

/** A band edge in thousands or millions: 500 000 → [„500", „tys."]. */
function amountStep(value: number): [string, string] {
  return value >= 1_000_000
    ? [STEP_NUMBER.format(value / 1_000_000), "mln"]
    : [STEP_NUMBER.format(value / 1_000), "tys."];
}

/** A teaser's amount, which is a band and never the figure: „2–5 tys. zł",
 * „1–2 mln zł", „500 tys. – 1 mln zł" (`contractLinkAmountRange`). No-break
 * spaces, so a narrow column never leaves „zł" alone on a line. */
export function amountRangeLabel([low, high]: [number, number]): string {
  const [highNumber, highUnit] = amountStep(high);
  if (low === 0) return `poniżej ${highNumber}${NBSP}${highUnit}${NBSP}zł`;
  const [lowNumber, lowUnit] = amountStep(low);
  if (low === high) return `${lowNumber}${NBSP}${lowUnit}${NBSP}zł i więcej`;
  return lowUnit === highUnit
    ? `${lowNumber}–${highNumber}${NBSP}${highUnit}${NBSP}zł`
    : `${lowNumber}${NBSP}${lowUnit} – ${highNumber}${NBSP}${highUnit}${NBSP}zł`;
}

/** A teaser's count of contracts: „1 umowa", „2–4 umowy", „5–9 umów", „10 i
 * więcej umów" (`contractLinkDealsRange`). The noun agrees with the upper
 * figure, which is the one next to it. */
export function dealsRangeLabel([low, high]: [number, number | null]): string {
  if (high === null) return `${low} i więcej umów`;
  const noun = nominativeNoun(high, "umowa", "umowy", "umów");
  return low === high ? `${low} ${noun}` : `${low}–${high} ${noun}`;
}

/** For an anonymous reader of a public finding whose researched ties were
 * left out: that there are more people, and who can see them. The verb
 * agrees with the count, as Polish wants: „jest powiązana jedna osoba", „są
 * powiązane 2 osoby", „jest powiązanych 5 osób". */
export function hiddenTiesLine(count: number): string {
  if (count <= 0) return "";
  if (count === 1) {
    return "Z firmą jest powiązana jeszcze jedna osoba — jej nazwisko widzą zalogowani.";
  }
  const plural = nominativeNoun(count, "osoba", "osoby", "osób") === "osoby";
  return plural
    ? `Z firmą są powiązane jeszcze ${count} osoby — ich nazwiska widzą zalogowani.`
    : `Z firmą jest powiązanych jeszcze ${count} osób — ich nazwiska widzą zalogowani.`;
}

/** Who holds the firm today, for a finding whose person no longer does
 * (`control_through_tie`): „dziś w firmie: wspólniczka (żona)". The roles,
 * never the names, so the collapsed row may say it; confirmed ties only.
 * Without ties to read - an anonymous reader is sent none - the flag's own
 * words. */
export function controlNowLine(
  link: Pick<ContractLinkRow, "flags" | "ties">,
): string {
  if (!link.flags.includes("control_through_tie")) return "";
  const roles = [
    ...new Set(
      link.ties
        .filter((tie) => tie.confirmed)
        .map((tie) => (tie.family ? `${tie.tie} (${tie.family})` : tie.tie)),
    ),
  ];
  return roles.length
    ? `dziś w firmie: ${roles.join(", ")}`
    : CONTRACT_LINK_FLAG_LABELS.control_through_tie;
}

/** This firm's part of a contract it shares with other suppliers, as the
 * finding's totals count it: an equal split. Null for a contract it holds
 * alone, or one with no stated value. */
export function contractShare(
  contract: Pick<ContractRow, "value" | "suppliers">,
): { share: number; whole: number; suppliers: number } | null {
  const suppliers = contract.suppliers.length;
  if (contract.value === undefined || suppliers < 2) return null;
  return {
    share: contract.value / suppliers,
    whole: contract.value,
    suppliers,
  };
}

/** Where one finding lives: the list with it pinned and open above the rest.
 * `cru_<nip>` for a finding the reader may read, `ukryte_<rank>` for a
 * teaser (`CONTRACT_LINK_ID_PATTERN`). */
export function contractLinkPath(id: string): string {
  return `/eksploruj/umowy?powiazanie=${encodeURIComponent(id)}`;
}
