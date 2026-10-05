import { z } from "zod";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getOptionalUser } from "~~/server/utils/auth";
import type { ActivityAggregate } from "~~/server/utils/activityStats";
import {
  cachedActivityWindow,
  LEADERBOARD_SIZE,
  type WindowedActivity,
} from "~~/server/utils/activityWindow";
import {
  activityRanges,
  defaultActivityRange,
  type ActivityCounts,
  type ActivityKind,
  type ActivityRange,
} from "~~/shared/activity";
import { ownAvatarPath } from "~~/server/utils/avatars";
import { openProfilePath } from "~~/server/utils/profiles";
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
   * the name over it. And only the picture the site itself stored for the
   * account (`/api/images/<id>`), for administrators as well: Auth's
   * `photoURL` can be set to any address from the browser, and every reader of
   * the ranking would fetch it. A Google account's photo is therefore not
   * shown - the admin list of accounts has its own. */
  photoURL: string | null;
  /** `/uczestnik/<handle>`, for a row named by its owner's own consent - the
   * `publicProfile` switch - and whose profile no administrator hid. Never for
   * a row named only because an administrator or the person themself is
   * looking: a link is a page anybody can open. */
  profilePath: string | null;
  counts: ActivityCounts;
  total: number;
  lastActiveAt: string;
};

export type ActivityStats = {
  window: { since: string; until: string; days: number };
  /** True when the caller sees every name, uid and address. Admins only. */
  identified: boolean;
  totals: ActivityCounts;
  total: number;
  /** One entry per day of the window, oldest first, gaps filled with zeros. */
  daily: { date: string; counts: ActivityCounts; total: number }[];
  /** Distinct people who did anything in the window. */
  contributorCount: number;
  /** Ranked contributors, named as far as the caller is allowed to see. */
  contributors: ActivityContributor[];
  /** How many of the ranked rows carry a real name, so the page can say what
   * turning the setting on would change without counting rows itself. */
  namedCount: number;
  /** Where the caller stands, even when that is outside the ranked slice.
   * Null for a visitor who is signed out or did nothing in the window. */
  self: { rank: number; total: number; counts: ActivityCounts } | null;
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

  const windowed = await cachedActivityWindow(days);
  const ranked = windowed.aggregate.contributors;

  if (caller) {
    // The cached body is shared and says nothing about who asked for it; this
    // one names the caller's own row and their standing, so it is theirs alone.
    setResponseHeader(event, "Cache-Control", "private, no-store");
  }

  const contributors = ranked
    .slice(0, LEADERBOARD_SIZE)
    .map((contributor, index) =>
      present(contributor, index, windowed, {
        isAdmin,
        callerUid: caller?.uid ?? null,
      }),
    );

  const selfIndex = caller
    ? ranked.findIndex((contributor) => contributor.uid === caller.uid)
    : -1;

  return {
    window: windowed.window,
    identified: isAdmin,
    totals: windowed.aggregate.totals,
    total: windowed.aggregate.total,
    daily: windowed.aggregate.daily,
    contributorCount: ranked.length,
    contributors,
    namedCount: contributors.filter((row) => row.named).length,
    self:
      selfIndex >= 0
        ? {
            rank: selfIndex + 1,
            total: ranked[selfIndex]!.total,
            counts: ranked[selfIndex]!.counts,
          }
        : null,
    truncated: windowed.truncated,
  };
});

/** One ranked contributor as this caller may see them. */
function present(
  contributor: ActivityAggregate["contributors"][number],
  index: number,
  windowed: WindowedActivity,
  caller: { isAdmin: boolean; callerUid: string | null },
): ActivityContributor {
  const identity = windowed.identities[contributor.uid];
  const profile = windowed.profiles[contributor.uid];
  const isPublic = windowed.public[contributor.uid] === true;
  const isSelf = contributor.uid === caller.callerUid;
  // Your own name is not a disclosure, so it is shown to you whatever the
  // setting says - seeing where you stand is the reason the ranking is public.
  const named = caller.isAdmin || isSelf || isPublic;

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
    photoURL: named ? ownAvatarPath(profile) : null,
    profilePath: openProfilePath(profile, isPublic),
    counts: contributor.counts,
    total: contributor.total,
    lastActiveAt: contributor.lastActiveAt,
    // What a stranger's copy of this row would say, so the chip can tell you
    // whether the name you see is one everybody sees.
    ...(isSelf
      ? {
          publicName: isPublic && !!identity?.displayName,
        }
      : {}),
  };
}
