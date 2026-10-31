import type {
  ActivityContributor,
  ActivityStats,
} from "../../../server/api/stats/activity.get";
import type { ActivityCounts } from "../../../shared/activity";
import type {
  ActivityFeed,
  FeedActor,
  FeedBatch,
  FeedTarget,
} from "../../../shared/activityFeed";
import { NOW } from "../clock";

/**
 * What the declarations' automation publishes on its own, on /aktywnosc and
 * /eksploruj/statystyki, as round bip-autopublish-r2 approved it.
 *
 * REAL
 *   PEOPLE_DAYS: production's /api/stats/activity?days=30 of 2026-10-31,
 *     counts only (vote, revision, noteSource, publication), its days moved
 *     to end on NOW
 * DERIVED
 *   AUTOMATIC_DAYS: the automation's first week at the cap of 50
 *   the feed: made up, with surnames that match nobody in the PKW or KRS
 *     lists (Przykładowy, Szablonowy, Atrapowy, Próbny, Szkicowy)
 */

const PEOPLE_DAYS: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [1, 2, 1, 1],
  [0, 0, 0, 0],
  [3, 44, 22, 6],
  [5, 43, 8, 12],
  [0, 0, 0, 0],
  [19, 62, 31, 13],
  [0, 0, 0, 0],
  [1, 23, 2, 4],
  [7, 22, 11, 2],
  [0, 0, 0, 0],
  [7, 32, 14, 5],
  [13, 23, 5, 11],
  [10, 63, 15, 65],
  [0, 3, 0, 0],
  [0, 0, 0, 0],
  [5, 21, 7, 16],
  [13, 63, 28, 12],
  [23, 37, 19, 6],
  [0, 0, 0, 0],
  [7, 16, 15, 3],
  [5, 40, 14, 22],
  [20, 79, 23, 27],
  [3, 17, 13, 8],
  [0, 14, 8, 10],
  [4, 20, 7, 11],
  [1, 25, 7, 7],
  [6, 30, 10, 4],
  [0, 3, 0, 3],
];

/** The last six days: four at the cap, then the queue running short. */
const AUTOMATIC_DAYS = [50, 50, 50, 50, 46, 21];

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (index: number) =>
  new Date(NOW.getTime() - (PEOPLE_DAYS.length - 1 - index) * DAY_MS)
    .toISOString()
    .slice(0, 10);

const countsOf = ([vote, revision, noteSource, publication]: [
  number,
  number,
  number,
  number,
]): ActivityCounts => ({ vote, revision, noteSource, publication });

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

const daily = PEOPLE_DAYS.map((day, index) => {
  const automaticIndex = index - (PEOPLE_DAYS.length - AUTOMATIC_DAYS.length);
  return {
    date: dayOf(index),
    counts: countsOf(day),
    total: sum(day),
    automatic: automaticIndex >= 0 ? AUTOMATIC_DAYS[automaticIndex]! : 0,
  };
});

const totals = countsOf(
  [0, 1, 2, 3].map((kind) => sum(PEOPLE_DAYS.map((day) => day[kind]!))) as [
    number,
    number,
    number,
    number,
  ],
);

const contributor = (
  rank: number,
  name: string,
  counts: ActivityCounts,
): ActivityContributor => ({
  key: `rank-${rank}`,
  uid: null,
  name,
  named: false,
  isSelf: false,
  email: null,
  photoURL: null,
  counts,
  total: sum(Object.values(counts)),
  lastActiveAt: new Date(NOW.getTime() - rank * 60 * 60 * 1000).toISOString(),
});

export const automaticActivity: ActivityStats = {
  window: { since: daily[0]!.date, until: daily.at(-1)!.date, days: 30 },
  identified: false,
  totals,
  total: sum(Object.values(totals)),
  daily,
  contributorCount: 3,
  contributors: [
    contributor(1, "Z•••••", totals),
    contributor(2, "j•••••", countsOf([6, 21, 11, 0])),
    contributor(3, "k•••••", countsOf([19, 8, 4, 3])),
  ],
  namedCount: 0,
  self: null,
  truncated: [],
  automatic: sum(AUTOMATIC_DAYS),
};

// ---------------------------------------------------------------------------
// The feed, as an established administrator sees it
// ---------------------------------------------------------------------------

const PEOPLE = [
  "Jan Szablonowy",
  "Ewa Atrapowa",
  "Małgorzata Przykładowa-Szablonowa",
  "Maria Szkicowa",
  "Tomasz Przykładowy",
  "Piotr Próbny",
  "Katarzyna Atrapowa",
  "Paweł Szkicowy",
  "Anna Próbna",
  "Michał Szablonowy",
];

const targets = (from: number, count: number): FeedTarget[] =>
  Array.from({ length: count }, (_, index) => {
    const name = PEOPLE[(from + index) % PEOPLE.length]!;
    const id = `p${from + index}`;
    return {
      key: id,
      type: "person",
      name,
      href: `/osoba/${id}`,
    };
  });

/** An instant `days` before NOW at a UTC hour and minute. Warsaw is UTC+2
 * on these dates, and the automation publishes nothing from 3:00 to 9:00. */
const at = (days: number, hour: number, minute: number) =>
  new Date(
    Date.UTC(
      NOW.getUTCFullYear(),
      NOW.getUTCMonth(),
      NOW.getUTCDate() - days,
      hour,
      minute,
    ),
  ).toISOString();

const AUTOMATION: FeedActor = {
  key: "automat",
  uid: null,
  name: "Automat",
  named: true,
  isSelf: false,
  photoURL: null,
  newAdmin: false,
  automated: true,
};

const ZOFIA: FeedActor = {
  key: "uid-zofia",
  uid: "uid-zofia",
  name: "Zofia Przykładowa",
  named: true,
  isSelf: false,
  photoURL: null,
  newAdmin: false,
};

const line = (
  actor: FeedActor,
  kind: FeedBatch["kind"],
  firstAt: string,
  lastAt: string,
  count: number,
  listed: FeedTarget[],
): FeedBatch => ({
  id: `${actor.key}:${kind}:${firstAt}`,
  kind,
  actorKey: actor.key,
  firstAt,
  lastAt,
  count,
  objects: { person: count },
  alongEdges: 0,
  targets: listed,
  moreTargets: count - listed.length,
});

export const automaticFeed: ActivityFeed = {
  window: {
    since: new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    until: NOW.toISOString(),
    days: 7,
  },
  identified: true,
  actors: [AUTOMATION, ZOFIA],
  batches: [
    line(
      AUTOMATION,
      "autoPublish",
      at(0, 7, 5),
      at(0, 9, 40),
      21,
      targets(0, 8),
    ),
    line(ZOFIA, "vote", at(0, 6, 30), at(0, 6, 55), 6, targets(3, 6)),
    line(
      AUTOMATION,
      "autoPublish",
      at(1, 7, 12),
      at(1, 17, 47),
      46,
      targets(5, 8),
    ),
  ],
  newAdmins: [],
  truncated: [],
};
