import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler } from "h3";
import { getUser } from "~~/server/utils/auth";
import { isAutomatedUid } from "~~/shared/stats";
import {
  RECENT_AUTH_TIMES,
  userCollections,
  type UserStatsDoc,
} from "~~/shared/userAdmin";

/** What one call tells the record: when, which sign-in the browser's token
 * came from, and how that sign-in was made. Nothing about the request itself -
 * the page, the address and the browser are deliberately not read, so they
 * cannot end up stored by accident. */
type Visit = {
  /** ISO 8601, the server's clock. */
  at: string;
  /** The token's `auth_time`, in seconds. Null only for a token that somehow
   * lacks it, which still counts as a day on the site. */
  authTime: number | null;
  provider: string | null;
};

/** The record after one more visit.
 *
 * A day is a UTC day, compared as text with the last one recorded, so a visit
 * on a new day adds one whatever the gap. A sign-in is an `auth_time` the
 * record has not seen. Every token refreshed from one sign-in carries that
 * sign-in's time, and the browser asks at most once a day per sign-in
 * (`signInStats.client.ts`), so a session that lasts a week is one sign-in and
 * up to seven days.
 *
 * Only the newest `RECENT_AUTH_TIMES` sign-ins are remembered. A sign-in made
 * now carries a time later than all of them, so a time older than every one
 * kept is a session that was already counted and has since been pushed out of
 * the list - a browser signed in long ago and left signed in while the account
 * signed in twenty times elsewhere. Counting it again would add one for every
 * day that browser is opened.
 */
function afterVisit(
  previous: UserStatsDoc | undefined,
  { at, authTime, provider }: Visit,
): UserStatsDoc {
  const day = at.slice(0, 10);
  const recent = previous?.recentAuthTimes ?? [];

  const signedInAgain =
    authTime !== null &&
    !recent.includes(authTime) &&
    !(recent.length >= RECENT_AUTH_TIMES && authTime < Math.min(...recent));
  const recentAuthTimes = signedInAgain
    ? [authTime, ...recent].sort((a, b) => b - a).slice(0, RECENT_AUTH_TIMES)
    : recent;

  // The provider of the newest sign-in, not of whichever browser called last:
  // a laptop signed in with a password last month says nothing about how the
  // account signs in now.
  const newest = authTime !== null && recent.every((seen) => seen <= authTime);

  return {
    firstSeenAt: previous?.firstSeenAt ?? at,
    lastSeenAt: at,
    lastActiveDay: day,
    activeDays:
      (previous?.activeDays ?? 0) + (previous?.lastActiveDay === day ? 0 : 1),
    signIns: (previous?.signIns ?? 0) + (signedInAgain ? 1 : 0),
    recentAuthTimes,
    lastProvider:
      newest || !previous ? provider : (previous.lastProvider ?? provider),
  };
}

/** Records that the caller has the site open today: `userStats/{uid}`.
 *
 * How often somebody signs in and comes back is what an administrator needs to
 * run a volunteer team and to keep editing rights on accounts that are still
 * used, and Firebase Auth keeps none of it - only the last sign-in and the
 * last token refresh. So the browser reports once a day, and this adds the day
 * and, if the token comes from a sign-in not seen before, the sign-in. What is
 * kept is in `UserStatsDoc`; the privacy policy says the same.
 *
 * The record is server-only (`firestore.rules` denies the collection) rather
 * than a field on `users/{uid}`, which its owner can write anything into.
 *
 * Answers 204 with nothing in it either way: the browser does not wait for the
 * answer and has no use for it.
 */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);

  // Autopush runs against the production database (see
  // server/plugins/noindex-autopush.ts), so a visit there would be counted in
  // the same record as the real site, by the people testing a release.
  if (process.env.K_SERVICE === "autopush") return null;
  // The pipeline signs in to write, and a migration never does; neither is a
  // person whose visits mean anything.
  if (isAutomatedUid(user.uid)) return null;

  const visit: Visit = {
    at: new Date().toISOString(),
    authTime: Number.isFinite(user.auth_time) ? user.auth_time : null,
    provider: user.firebase.sign_in_provider,
  };

  const db = getFirestore("koryta-pl");
  const ref = db.collection(userCollections.userStats).doc(user.uid);
  // A transaction, because two browsers can report at the same moment - a
  // phone and a laptop signed in separately. Each would read the same record
  // and add its own sign-in, and the second write would drop the first one's.
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const previous = snapshot.exists
      ? (snapshot.data() as UserStatsDoc)
      : undefined;
    tx.set(ref, afterVisit(previous, visit));
  });

  // h3 sends null as a 204.
  return null;
});
