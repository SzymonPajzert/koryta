import {
  choropleth,
  choroplethLead,
  choroplethPeople,
  choroplethShare,
} from "~/utils/chartTheme";
import { polishCounting, polishCountingGenitive } from "~/composables/polish";
import { OTHER_PARTY, partyMergedLabels } from "~~/shared/misc";

/** What the home map is coloured by: the party leading each powiat, or one
 * party's share of it (decision on 2026-11-18). */
export const ALL_PARTIES = "*";

/** Below this many people with a party a powiat shows no party: one or two
 * people make a 100% that says nothing. */
export const MIN_WITH_PARTY = 3;

/** A powiat as /api/stats/regions serves it. */
export interface MapRow {
  people: number;
  parties?: Record<string, number>;
}

type Lead =
  | { kind: "empty" | "thin" | "tie" }
  | { kind: "party"; party: string; share: number };

function withParty(row: MapRow): number {
  return Object.values(row.parties ?? {}).reduce((sum, n) => sum + n, 0);
}

/** The party most of the powiat's people with a party have, and its share of
 * them. A tie, or „Inne” in front, names no party. */
export function leadOf(row: MapRow): Lead {
  if (!row.people) return { kind: "empty" };
  const total = withParty(row);
  if (total < MIN_WITH_PARTY) return { kind: "thin" };
  const [first, second] = Object.entries(row.parties ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  if (!first || first[0] === OTHER_PARTY || second?.[1] === first[1])
    return { kind: "tie" };
  return { kind: "party", party: first[0], share: first[1] / total };
}

/** Under 45%, 45-59%, 60% and up. */
export function leadStep(share: number): 0 | 1 | 2 {
  return share < 0.45 ? 0 : share < 0.6 ? 1 : 2;
}

/** 1-19%, 20-39%, 40-59%, 60% and up; a share of 0 has its own fill. */
export function shareStep(share: number): 0 | 1 | 2 | 3 {
  return share < 0.2 ? 0 : share < 0.4 ? 1 : share < 0.6 ? 2 : 3;
}

const PEOPLE_CLASSES = [1, 5, 10, 20, 50, 100];

/** 1-4, 5-9, 10-19, 20-49, 50-99, 100+. */
export function peopleStep(people: number): number {
  return PEOPLE_CLASSES.filter((floor) => people >= floor).length - 1;
}

export function leadFill(row: MapRow): string {
  const lead = leadOf(row);
  if (lead.kind !== "party") return choropleth[lead.kind];
  return choroplethLead[lead.party]?.[leadStep(lead.share)] ?? choropleth.tie;
}

/** One party's share of the powiat's people with a party, or null where
 * there is nothing to take a share of. */
export function shareOf(row: MapRow, party: string): number | null {
  const total = withParty(row);
  if (!row.people || total < MIN_WITH_PARTY) return null;
  return (row.parties?.[party] ?? 0) / total;
}

export function shareFill(row: MapRow, party: string): string {
  if (!row.people) return choropleth.empty;
  const share = shareOf(row, party);
  if (share === null) return choropleth.thin;
  if (share === 0) return choropleth.none;
  return choroplethShare[party]?.[shareStep(share)] ?? choropleth.tie;
}

/** Until the night's recount writes party counts, the map colours people. */
export function peopleFill(people: number): string {
  if (!people) return choropleth.empty;
  return choroplethPeople[peopleStep(people)]!;
}

/** The parties with somebody on the map, most people first (decision on
 * 2026-11-18), „Inne” among them by its count. Only those the map can paint. */
export function partiesByPeople(rows: MapRow[]): string[] {
  const totals: Record<string, number> = {};
  for (const row of rows)
    for (const [party, n] of Object.entries(row.parties ?? {}))
      totals[party] = (totals[party] ?? 0) + n;
  return Object.entries(totals)
    .filter(([party, n]) => n > 0 && choroplethShare[party])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pl"))
    .map(([party]) => party);
}

export function partyLabel(party: string): string {
  return partyMergedLabels[party] ?? party;
}

/** What hovering a powiat says. The first line is what it always said; the
 * e2e spec reads its count. */
export function regionTitle(name: string, row: MapRow, mode: string): string {
  const head = `${name} (${polishCounting(row.people, "osoba", "osoby", "osób")})`;
  const total = withParty(row);
  if (!total) return head;
  if (mode === ALL_PARTIES) {
    const parts = Object.entries(row.parties ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([party, n]) => `${partyLabel(party)} ${n}`);
    return `${head}\n${parts.join(", ")}`;
  }
  const n = row.parties?.[mode] ?? 0;
  return `${head}\n${partyLabel(mode)}: ${n} z ${polishCountingGenitive(total, "osoby", "osób")} z partią`;
}
