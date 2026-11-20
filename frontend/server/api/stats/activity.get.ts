import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getOptionalUser } from "~~/server/utils/auth";
import {
  identify,
  readPublicProfiles,
  type ContributorIdentity,
} from "~~/server/utils/contributors";
import { mergeRollups, mergeTruncated } from "~~/server/utils/activityRollup";
import { loadActivityRollups } from "~~/server/utils/activityWindow";
import type {
  ActivityAggregate,
  ContributorAggregate,
} from "~~/server/utils/activityStats";
import {
  activityRanges,
  defaultActivityRange,
  rankingKinds,
  rankingNames,
  type ActivityCounts,
  type ActivityKind,
  type ActivityRange,
  type RankingName,
} from "~~/shared/activity";
import { maskedContributorName } from "~~/shared/profile";

const queryValidator = z.object({
  // One of the three the page offers, not a range. See `activityRanges`: every
  // distinct value is its own memo entry and its own catch-up build, so an open
  // range is an amplifier a signed-out caller can pull on.
  days: z.coerce
    .number()
    .int()
    .refine(
      (value): value is ActivityRange =>
        (activityRanges as readonly number[]).includes(value),
      { message: `days must be one of ${activityRanges.join(", ")}` },
    )
    .default(defaultActivityRange),
});

/** How many contributors each ranking resolves names for. Well past the
 * number of people who have ever been active in a week, and it keeps the
 * response - and the auth lookups behind it - bounded either way. */
const LEADERBOARD_SIZE = 25;

export type ActivityContributor = {
  /** Stable key for a table row or chart series. The uid for an admin, the rank
   * for everybody else — who never receive a uid. */
  key: string;
  /** Null unless the caller is an admin. A uid identifies a person, and it does
   * so whether or not that person agreed to be named, so it is withheld even
   * from the rows that carry a real name. */
  uid: string | null;
  /** What to print for this row. Never empty: a contributor who has not made
   * their profile public is masked, not blanked. */
  name: string;
  /** Whether `name` is this person's own name rather than a mask. */
  named: boolean;
  /** The caller's own row, which is always named — to them. */
  isSelf: boolean;
  /** The caller's own row only: whether everybody else is shown this name
   * too, which `named` cannot say, since your own name is shown to you
   * whatever the setting. */
  publicName?: boolean;
  /** Admin only. */
  email: string | null;
  /** Only for a row that is named; an avatar identifies a person as surely as
   * the name over it. */
  photoURL: string | null;
  counts: ActivityCounts;
  /** Their count of the ranking's kinds (`rankingKinds`). */
  total: number;
  lastActiveAt: string;
};

/** One ranking: the people with any of its kinds in the window, best first. */
export type ActivityRanking = {
  /** How many people that is. */
  count: number;
  /** The top of them, named as far as the caller is allowed to see. */
  rows: ActivityContributor[];
  /** Where the caller stands, even when that is outside `rows`. Null for a
   * visitor who is signed out or did none of these kinds in the window. */
  self: { rank: number; total: number } | null;
};

export type ActivityStats = {
  window: { since: string; until: string; days: number };
  /** True when the caller sees every name, uid and address. Admins only. */
  identified: boolean;
  totals: ActivityCounts;
  total: number;
  /** One entry per day of the window, oldest first, gaps filled with zeros.
   * `automatic` is the day's people the declarations' automation published
   * on its own, which `counts` and `total` leave out. */
  daily: {
    date: string;
    counts: ActivityCounts;
    total: number;
    automatic: number;
  }[];
  /** People the declarations' automation published on its own in the
   * window. Not anybody's work, so in no total above and no contributor's
   * row, but shown as the automation's. */
  automatic: number;
  /** Distinct people who did anything in the window. */
  contributorCount: number;
  /** Who changed the data, and who read crops on /oswiadczenia, ranked
   * apart: in one ranking the readers filled the top 25 (decision on
   * 2026-11-19). */
  rankings: Record<RankingName, ActivityRanking>;
  /** Kinds whose scan hit its cap, so their counts are a lower bound. */
  truncated: ActivityKind[];
};

/** What people did to the data, by day and by interaction kind.
 *
 * The aggregate is public, and so is the ranking — the point of the page is
 * that volunteers can see the work adding up, and a leaderboard nobody but an
 * administrator may look at does not do that. What is not public is *who*: a
 * display name is somebody's real name, and it is shown to a stranger only if
 * that person turned `publicProfile` on from /profil. Everybody else appears
 * masked, and their uid, address and avatar never leave this handler. See
 * `shared/profile.ts`.
 *
 * The counting is done once per day and stored (`activityRollup.ts`); this
 * assembles a window out of those days plus a live read of the days too recent
 * to have settled, and layers identities on afterwards, per caller.
 */
export default defineEventHandler(async (event): Promise<ActivityStats> => {
  const { days } = await getValidatedQuery(event, (q) =>
    queryValidator.parse(q),
  );

  // Signed out is not an error here - it just means an unidentified aggregate.
  const caller = await getOptionalUser(event);
  const isAdmin = caller?.admin === true;

  const windowed = await cachedWindow(days);

  if (caller) {
    // The cached body is shared and says nothing about who asked for it; this
    // one names the caller's own row and their standing, so it is theirs alone.
    setResponseHeader(event, "Cache-Control", "private, no-store");
  }

  const ranking = (name: RankingName): ActivityRanking => {
    const ranked = windowed.ranked[name];
    const selfIndex = caller
      ? ranked.findIndex((contributor) => contributor.uid === caller.uid)
      : -1;
    return {
      count: ranked.length,
      rows: ranked.slice(0, LEADERBOARD_SIZE).map((contributor, index) =>
        present(contributor, index, windowed, {
          isAdmin,
          callerUid: caller?.uid ?? null,
        }),
      ),
      self:
        selfIndex >= 0
          ? { rank: selfIndex + 1, total: ranked[selfIndex]!.total }
          : null,
    };
  };

  return {
    window: windowed.window,
    identified: isAdmin,
    totals: windowed.aggregate.totals,
    total: windowed.aggregate.total,
    daily: windowed.aggregate.daily,
    contributorCount: windowed.aggregate.contributors.length,
    rankings: {
      changes: ranking("changes"),
      readings: ranking("readings"),
    },
    truncated: windowed.truncated,
    automatic: windowed.aggregate.automatic,
  };
});

type WindowedActivity = {
  window: { since: string; until: string; days: number };
  aggregate: ActivityAggregate;
  /** Each ranking's people, best first, `total` their count of its kinds. */
  ranked: Record<RankingName, ContributorAggregate[]>;
  truncated: ActivityKind[];
  /** Display data for the ranked slices, from the auth service. Server side
   * only - `present` decides which fields of it any given caller may see. */
  identities: Record<string, ContributorIdentity>;
  /** Which of the ranked contributors agreed to be named in public. */
  public: Record<string, boolean>;
};

/** The people with any of `name`'s kinds, by their count of them, then uid
 * so equal counts keep a stable order. */
function rankBy(
  contributors: ContributorAggregate[],
  name: RankingName,
): ContributorAggregate[] {
  const kinds: readonly ActivityKind[] = rankingKinds[name];
  return contributors
    .map((contributor) => ({
      ...contributor,
      total: kinds.reduce((sum, kind) => sum + contributor.counts[kind], 0),
    }))
    .filter((contributor) => contributor.total > 0)
    .sort((a, b) => b.total - a.total || (a.uid < b.uid ? -1 : 1));
}

/** One ranked contributor as this caller may see them. */
function present(
  contributor: ContributorAggregate,
  index: number,
  windowed: WindowedActivity,
  caller: { isAdmin: boolean; callerUid: string | null },
): ActivityContributor {
  const identity = windowed.identities[contributor.uid];
  const isSelf = contributor.uid === caller.callerUid;
  // Your own name is not a disclosure, so it is shown to you whatever the
  // setting says - seeing where you stand is the reason the ranking is public.
  const named =
    caller.isAdmin || isSelf || windowed.public[contributor.uid] === true;

  const rank = index + 1;
  const ownName =
    identity?.displayName || (caller.isAdmin ? identity?.email : null);

  return {
    key: caller.isAdmin ? contributor.uid : `rank-${rank}`,
    uid: caller.isAdmin ? contributor.uid : null,
    name: named
      ? ownName || `Uczestnik #${rank}`
      : maskedContributorName(identity?.displayName, rank),
    named: named && !!ownName,
    isSelf,
    email: caller.isAdmin ? (identity?.email ?? null) : null,
    photoURL: named ? (identity?.photoURL ?? null) : null,
    counts: contributor.counts,
    total: contributor.total,
    lastActiveAt: contributor.lastActiveAt,
    // What a stranger's copy of this row would say, so the chip can tell you
    // whether the name you see is one everybody sees.
    ...(isSelf
      ? {
          publicName:
            windowed.public[contributor.uid] === true &&
            !!identity?.displayName,
        }
      : {}),
  };
}

/** The whole read-and-roll-up, memoized per window length.
 *
 * Five minutes of staleness on a chart of days is not worth noticing, and the
 * memo is what keeps the auth and `users` lookups off the per-request path as
 * well. What it holds is shared between callers, so it holds everything anyone
 * may see and nothing is stripped out on the way in — `present` does the
 * stripping, per caller, on the way out.
 */
const cachedWindow = defineCachedFunction(
  async (days: number): Promise<WindowedActivity> => {
    const db = getFirestore("koryta-pl");
    const { window, spanned, rollups } = await loadActivityRollups(db, days);

    const aggregate = mergeRollups(spanned, rollups);
    const ranked = Object.fromEntries(
      rankingNames.map((name) => [name, rankBy(aggregate.contributors, name)]),
    ) as Record<RankingName, ContributorAggregate[]>;
    // Everybody either ranking shows, once each.
    const shown = [
      ...new Set(
        rankingNames.flatMap((name) =>
          ranked[name].slice(0, LEADERBOARD_SIZE).map((c) => c.uid),
        ),
      ),
    ];
    const [identities, publicProfiles] = await Promise.all([
      identify(shown),
      readPublicProfiles(db, shown),
    ]);

    return {
      window,
      aggregate,
      ranked,
      truncated: mergeTruncated(rollups),
      identities,
      public: publicProfiles,
    };
  },
  {
    name: "stats-activity",
    maxAge: 300,
    swr: true,
    getKey: (days: number) => String(days),
  },
);
