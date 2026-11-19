import type {
  ActivityContributor,
  ActivityStats,
} from "../../../server/api/stats/activity.get";
import { emptyActivityCounts } from "../../../shared/activity";
import { NOW } from "../clock";
import { automaticActivity } from "./activityAutomatic";

/**
 * Scans read on /oswiadczenia beside the changes on /eksploruj/statystyki, as
 * round oswiadczenia-statystyki-r4 approved it: the scans ranked on a tab of
 * their own that opens first, and drawn in a band of their own under the
 * changes.
 *
 * REAL
 *   READING_DAYS: the scans a day in production's 30 days to 2026-11-19
 *     (the 11-19 export), its days moved to end on NOW
 *   READERS: the top ten readers' counts in those days, and how many days
 *     before the window's end each last did anything; 46 people read
 * DERIVED
 *   the changes: activityAutomatic's, the days of 2026-10-31, so the two
 *     kinds of work here come from different months
 */

const READING_DAYS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1326, 1053, 1301, 1608, 1216, 198, 21, 205, 113,
  152, 0, 342, 84, 260, 33, 4, 0, 105, 184, 0,
];

const READERS: [total: number, daysAgo: number][] = [
  [1336, 1],
  [712, 10],
  [589, 17],
  [550, 15],
  [494, 1],
  [480, 8],
  [446, 16],
  [355, 14],
  [307, 1],
  [301, 5],
];

const READER_COUNT = 46;

const DAY_MS = 24 * 60 * 60 * 1000;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

const reader = (
  [total, daysAgo]: [number, number],
  index: number,
): ActivityContributor => ({
  key: `rank-${index + 1}`,
  uid: null,
  name: `Uczestnik #${index + 1}`,
  named: false,
  isSelf: false,
  email: null,
  photoURL: null,
  counts: { ...emptyActivityCounts(), reading: total },
  total,
  lastActiveAt: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(),
});

const readings = sum(READING_DAYS);

export const readingActivity: ActivityStats = {
  ...automaticActivity,
  totals: { ...automaticActivity.totals, reading: readings },
  total: automaticActivity.total + readings,
  daily: automaticActivity.daily.map((day, index) => ({
    ...day,
    counts: { ...day.counts, reading: READING_DAYS[index]! },
    total: day.total + READING_DAYS[index]!,
  })),
  contributorCount: automaticActivity.contributorCount + READER_COUNT,
  rankings: {
    ...automaticActivity.rankings,
    readings: {
      count: READER_COUNT,
      rows: READERS.map(reader),
      self: null,
    },
  },
};
