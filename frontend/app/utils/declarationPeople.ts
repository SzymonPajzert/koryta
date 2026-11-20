import { role } from "~~/shared/colors";
import type { DeclarationPeople } from "~~/shared/declarations";
import type { DailyColumnsBand } from "~/components/stats/DailyColumns.vue";

/** The snapshot's people published a day, as `StatsDailyColumns` takes them:
 * every day from the first publication to the last, a day without one at
 * nought, so the columns stand on a continuous axis. */
export function publishedDays(people: DeclarationPeople): {
  dates: string[];
  bands: DailyColumnsBand[];
} {
  const rows = people.publishedByDay;
  if (rows.length === 0) return { dates: [], bands: [] };
  const counts = new Map(rows.map((row) => [row.day, row.count]));
  const dates: string[] = [];
  const day = new Date(`${rows[0]!.day}T00:00:00Z`);
  const last = new Date(`${rows.at(-1)!.day}T00:00:00Z`);
  while (day <= last) {
    dates.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return {
    dates,
    bands: [
      {
        key: "published",
        label: "Opublikowane",
        color: role.tally,
        values: dates.map((date) => counts.get(date) ?? 0),
      },
    ],
  };
}
