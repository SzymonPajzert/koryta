import {
  buildTimeline,
  MAX_SERIES,
  type HeldPost,
  type Timeline,
  type TimelineSeries,
} from "./homeTimeline";
import {
  canonicalParty,
  OTHER_PARTY,
  parties,
  partyColors,
  partyMergedLabels,
} from "./misc";

/** How tall a party's band has to get to be drawn on its own: 2% of the
 * tallest month, about six pixels of the chart. A thinner one cannot be seen
 * or pointed at, so it goes to „Inne partie” rather than giving the legend an
 * entry the chart does not show. */
const MIN_BAND_SHARE = 0.02;

/** The parties a person is stacked under, each taking an equal part of them.
 *
 * A stack has to add up to a headcount, so unlike the home page's lines each
 * person counts once in all: somebody with two parties is half in each
 * (decision on 2026-11-25). A named party outranks „Inne”, which says there is
 * a tie but not whose. Empty for a person with no party the site has a colour
 * for, who is left out as on the home page. */
export function partyBands(held: readonly unknown[]): string[] {
  const known = new Set(
    held
      .filter(
        (party): party is string =>
          typeof party === "string" && party in partyColors,
      )
      .map(canonicalParty),
  );
  const named = [...known].filter((party) => party !== OTHER_PARTY);
  if (named.length > 0) return named;
  return known.has(OTHER_PARTY) ? [OTHER_PARTY] : [];
}

export function partyBandLabel(key: string): string {
  if (key === OTHER_PARTY) return "Inne partie";
  return partyMergedLabels[key] ?? key;
}

function peak(series: TimelineSeries): number {
  return Math.max(0, ...series.counts);
}

function sumCounts(lines: TimelineSeries[], width: number): number[] {
  return Array.from(
    { length: width },
    (_, index) =>
      Math.round(
        lines.reduce((sum, line) => sum + (line.counts[index] ?? 0), 0) * 1000,
      ) / 1000,
  );
}

/** Where a band stands in the stack: the parties in the site's own order,
 * „Inne partie” in grey on top. */
function stackRank(key: string): number {
  if (key === OTHER_PARTY) return parties.length;
  const index = parties.indexOf(key);
  return index === -1 ? parties.length - 1 : index;
}

/** How many people held a post each month, one band per party of
 * `partyBands`, bottom of the stack first.
 *
 * Each person's parts add up to one, so the bands add up to the headcount, and
 * two of them folded together are their sum, with no recount. */
export function buildPartyStack(
  posts: HeldPost[],
  today: string,
  options: { maxBands?: number } = {},
): Timeline {
  const maxBands = options.maxBands ?? MAX_SERIES;
  const { months, series } = buildTimeline(posts, today, {
    labelOf: partyBandLabel,
    maxSeries: Number.POSITIVE_INFINITY,
    shareAmongGroups: true,
  });
  if (series.length === 0) return { months, series };

  const tallest = Math.max(...sumCounts(series, months.length));
  // Tallest first, as `buildTimeline` ranks them; one place stays for
  // „Inne partie”.
  const kept = series
    .filter((line) => line.key !== OTHER_PARTY)
    .filter((line) => peak(line) >= tallest * MIN_BAND_SHARE)
    .slice(0, maxBands - 1);
  const folded = series.filter((line) => !kept.includes(line));

  const bands = [...kept];
  if (folded.length > 0) {
    bands.push({
      key: OTHER_PARTY,
      label: partyBandLabel(OTHER_PARTY),
      counts: sumCounts(folded, months.length),
    });
  }
  bands.sort((a, b) => stackRank(a.key) - stackRank(b.key));
  return { months, series: bands };
}
