import { z } from "zod";
import { getAuth } from "firebase-admin/auth";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { adminFirestore } from "~~/server/utils/firebase";
import { collectActivityEvents } from "~~/server/utils/activityEvents";
import {
  aggregateActivity,
  type ActivityAggregate,
} from "~~/server/utils/activityStats";
import type { ActivityCounts, ActivityKind } from "~~/shared/activity";

const queryValidator = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/** How many contributors the leaderboard resolves names for. Well past the
 * number of people who have ever been active in a week, and it keeps the
 * response — and the auth lookups behind it — bounded either way. */
const LEADERBOARD_SIZE = 25;

/** `getUsers` takes at most 100 identifiers per call. */
const AUTH_LOOKUP_CHUNK = 100;

export type ActivityContributor = {
  /** Stable key for a table row or chart series. The uid for an admin, an
   * opaque ordinal for everyone else. */
  key: string;
  /** Null unless the caller is an admin - a uid identifies a person. */
  uid: string | null;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  counts: ActivityCounts;
  total: number;
  lastActiveAt: string;
};

export type ActivityStats = {
  window: { since: string; until: string; days: number };
  /** True when the caller may see who did what. Admins only. */
  identified: boolean;
  totals: ActivityCounts;
  total: number;
  /** One entry per day of the window, oldest first, gaps filled with zeros. */
  daily: { date: string; counts: ActivityCounts; total: number }[];
  /** Distinct people who did anything in the window. Always returned - a head
   * count says how alive the project is without naming anyone. */
  contributorCount: number;
  /** Ranked contributors. Empty for non-admins. */
  contributors: ActivityContributor[];
  /** Kinds whose scan hit its cap, so their counts are a lower bound. */
  truncated: ActivityKind[];
};

/** What people did to the data, by day and by interaction kind.
 *
 * The aggregate is public: the totals and the shape of the week are the point
 * of a stats page, and a head count of contributors names nobody. Who did what
 * is not - a uid is an identifier, and the display names behind them come from
 * the same admin-only lookup `/api/users/lookup` guards. So the expensive part
 * is computed once, cached, and shared; identities are layered on afterwards,
 * per caller.
 */
export default defineEventHandler(async (event): Promise<ActivityStats> => {
  const { days } = await getValidatedQuery(event, (q) =>
    queryValidator.parse(q),
  );

  // An anonymous caller has no token at all, which `getUser` reports as a 401.
  // That is not an error here - it just means an unidentified aggregate.
  const caller = await getUser(event).catch(() => null);
  const isAdmin = caller?.admin === true;

  const windowed = await cachedWindow(days);

  const contributors = isAdmin
    ? await identify(windowed.aggregate.contributors.slice(0, LEADERBOARD_SIZE))
    : [];

  if (isAdmin) {
    // The cached body is shared; this one is not.
    setResponseHeader(event, "Cache-Control", "private, no-store");
  }

  return {
    window: windowed.window,
    identified: isAdmin,
    totals: windowed.aggregate.totals,
    total: windowed.aggregate.total,
    daily: windowed.aggregate.daily,
    contributorCount: windowed.aggregate.contributors.length,
    contributors,
    truncated: windowed.truncated,
  };
});

type WindowedActivity = {
  window: { since: string; until: string; days: number };
  aggregate: ActivityAggregate;
  truncated: ActivityKind[];
};

/** The whole read-and-roll-up, memoized per window length.
 *
 * Four collection scans per page view is the cost worth avoiding; five minutes
 * of staleness on a chart of days is not worth noticing. The cached value keeps
 * uids in it, because the admin path needs them - they are stripped on the way
 * out for everyone else, never cached-in-public.
 */
const cachedWindow = defineCachedFunction(
  async (days: number): Promise<WindowedActivity> => {
    const until = new Date();
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    since.setUTCHours(0, 0, 0, 0);

    const window = {
      since: since.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
      days,
    };

    const db = adminFirestore();
    const { events, truncated } = await collectActivityEvents(
      db,
      since.toISOString(),
    );

    return {
      window,
      aggregate: aggregateActivity(events, window),
      truncated: [...new Set(truncated)],
    };
  },
  {
    name: "stats-activity",
    maxAge: 300,
    swr: true,
    getKey: (days: number) => String(days),
  },
);

/** Attach display data to the ranked uids, so a chart can say "Anna" instead of
 * a 28-character opaque string. Uids that no longer resolve keep their place in
 * the ranking - the work happened even if the account is gone. */
async function identify(
  ranked: ActivityAggregate["contributors"],
): Promise<ActivityContributor[]> {
  const found = new Map<
    string,
    {
      displayName: string | null;
      email: string | null;
      photoURL: string | null;
    }
  >();

  for (let i = 0; i < ranked.length; i += AUTH_LOOKUP_CHUNK) {
    const chunk = ranked.slice(i, i + AUTH_LOOKUP_CHUNK);
    const result = await getAuth().getUsers(chunk.map((c) => ({ uid: c.uid })));
    for (const user of result.users) {
      found.set(user.uid, {
        displayName: user.displayName ?? null,
        email: user.email ?? null,
        photoURL: user.photoURL ?? null,
      });
    }
  }

  return ranked.map((contributor) => ({
    key: contributor.uid,
    uid: contributor.uid,
    displayName: found.get(contributor.uid)?.displayName ?? null,
    email: found.get(contributor.uid)?.email ?? null,
    photoURL: found.get(contributor.uid)?.photoURL ?? null,
    counts: contributor.counts,
    total: contributor.total,
    lastActiveAt: contributor.lastActiveAt,
  }));
}
