import { asArray } from "~~/shared/model";

/** What PKW says on a candidacy beyond the list it was on: who backed it and
 * which party the candidate declared, read by the pipeline
 * (`scrapers/pkw/affiliations.py`) and stored on the edge by the ingest. */
type Statements = {
  type?: string;
  party?: string;
  supported_by?: string;
  backing_parties?: string[];
  party_member?: string;
  member_parties?: string[];
};

/** Who backed a candidacy: the site's parties PKW's statement names, or the
 * backer's own name where it names none (an association, a local committee).
 * Undefined where PKW says nothing. */
export function backingOf(
  edge: Statements,
): { parties: string[]; name?: string; said: string } | undefined {
  if (edge.type !== "election" || !edge.supported_by) return undefined;
  const parties = asArray<string>(edge.backing_parties);
  return {
    parties,
    name: parties.length ? undefined : backerName(edge.supported_by),
    said: edge.supported_by,
  };
}

/** The parties a candidate declared they belong to, less the one the row
 * already names for the list: a PO member on a PO list says nothing new.
 *
 * None where the same cell says they belong to none. PKW has written a backing
 * into that column („nie należy do partii politycznej, popierany przez Sojusz
 * Lewicy Demokratycznej”), and the party read off it is no membership. */
export function membershipOf(edge: Statements): string[] {
  if (edge.type !== "election" || saysNoParty(edge)) return [];
  return asArray<string>(edge.member_parties).filter(
    (party) => party !== edge.party,
  );
}

/** Whether PKW records the candidate as belonging to no party. Not shown on
 * the row (decision on 2026-11-17), only kept from counting as a membership. */
function saysNoParty(edge: Statements): boolean {
  return /nie należy/i.test(edge.party_member ?? "");
}

/** The backer as PKW names it, without the words around the name:
 * „popierany przez organizację: Mareckie Stowarzyszenie Gospodarcze” is
 * „Mareckie Stowarzyszenie Gospodarcze”. The older files hold the bare name. */
export function backerName(said: string): string {
  const named = said.match(/^(?:popiera\S*|pop\.)\s+przez[^:]*:\s*(.+)$/i);
  return (named?.[1] ?? said).trim();
}

/** The person's parties that their candidacies name only through a backing:
 * never as the list they stood on, nor as a party they declared. Read off the
 * rows the reader is shown. */
export function partiesOnlyBacked(edges: readonly Statements[]): Set<string> {
  const backed = new Set<string>();
  const otherwise = new Set<string>();
  for (const edge of edges) {
    if (edge.type !== "election") continue;
    for (const party of asArray<string>(edge.backing_parties))
      backed.add(party);
    if (edge.party) otherwise.add(edge.party);
    for (const party of membershipOf(edge)) otherwise.add(party);
  }
  return new Set([...backed].filter((party) => !otherwise.has(party)));
}

/** The years each backed party is recorded in, for a chip's tooltip. */
export function backingYears(
  edges: readonly (Statements & { start_date?: string })[],
  party: string,
): string[] {
  const years = new Set<string>();
  for (const edge of edges) {
    if (edge.type !== "election") continue;
    if (!asArray<string>(edge.backing_parties).includes(party)) continue;
    if (edge.start_date) years.add(edge.start_date.slice(0, 4));
  }
  return [...years].sort();
}
