import type { TimelineGrouping } from "~~/server/api/stats/homeTimeline.get";

/** The vocabulary the timeline's two controls share.
 *
 * It lives here rather than in either component because the controls and the
 * chart are in different columns of `HomeExplorer` - the picker sits in the
 * side panel on the right, the chart fills the panel on the left - so neither
 * can own the list the other renders from.
 */

export const timelineRanges = [
  { value: "5", label: "5 lat", years: 5 },
  { value: "10", label: "10 lat", years: 10 },
  { value: "all", label: "Wszystko", years: null },
] as const;

export type TimelineRange = (typeof timelineRanges)[number]["value"];

/** How many years a range covers; null for the whole series. */
export function timelineRangeYears(range: TimelineRange): number | null {
  return timelineRanges.find((option) => option.value === range)?.years ?? null;
}

/** What each grouping is called, and the one line saying what it splits by.
 *
 * The hint matters more here than on most pickers: „Województwo” and „Branża”
 * both sound like filters, and what they do is decide what one line *is* - so
 * the wording says „jedna linia na …”. */
export const timelineGroupingOptions: {
  value: TimelineGrouping;
  label: string;
  hint: string;
}[] = [
  {
    value: "party",
    label: "Partie",
    hint: "Jedna linia na partię - osoby z tą przynależnością.",
  },
  {
    value: "region",
    label: "Województwa",
    hint: "Jedna linia na województwo - osoby na stanowiskach w tamtejszych instytucjach.",
  },
  {
    value: "category",
    label: "Branże",
    hint: "Jedna linia na branżę - osoby na stanowiskach w instytucjach tego sektora.",
  },
];
