import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getRouterParam, setResponseHeader } from "h3";
import {
  profileCounts,
  readProfiles,
  readPublicProfileChoice,
} from "~~/server/utils/profiles";
import { ownAvatarPath } from "~~/server/utils/avatars";
import { isAutomatedUid } from "~~/shared/stats";
import {
  isValidHandle,
  userCollections,
  type ProfileHandleDoc,
  type PublicProfile,
} from "~~/shared/userAdmin";

/** How long the CDN and browsers may keep a profile. Short, because turning
 * the switch off or an administrator hiding the profile has to take effect
 * about as fast as the person expects it to. */
const MAX_AGE = 60;

/** What a profile is headed with when the account has no name. */
const PROFILE_NAME_FALLBACK = "Uczestnik";

/** What the person did, counted per account and memoized for five minutes.
 *
 * Held only for accounts whose profile was found open on the way in, and
 * holding nothing that is not on the page anyway - so the memo is safe to
 * share between callers, and a reload of a popular profile costs no reads. */
const cachedProfileCounts = defineCachedFunction(
  (uid: string) => profileCounts(getFirestore("koryta-pl"), uid),
  {
    name: "profile-counts",
    maxAge: 300,
    swr: true,
    getKey: (uid: string) => uid,
  },
);

/** `YYYY-MM` of the account's creation. Auth hands it out as an HTTP date. */
function joinedMonth(creationTime: string | undefined): string | null {
  const created = creationTime ? new Date(creationTime) : null;
  return created && !Number.isNaN(created.getTime())
    ? created.toISOString().slice(0, 7)
    : null;
}

/** A contributor's public profile, `/uczestnik/<handle>`.
 *
 * Open only while three things hold, each read fresh rather than from a memo,
 * since any of them can change from one minute to the next: the handle belongs
 * to the account, the owner has `publicProfile` on, and no administrator hid
 * the profile. Anything else is a 404 - the same answer as for a handle nobody
 * holds, so a profile that was switched off cannot be told apart from one that
 * never existed.
 *
 * Everything shown is something the person agreed to show by turning the
 * switch on (see `publicProfileLabel`): the name, their own uploaded picture,
 * the month they joined and how much they did. No uid, no address, and no
 * list of what they rated or proposed - see `PublicProfile`. The same for
 * everybody who asks, signed in or not, which is what lets a cache keep it.
 */
export default defineEventHandler(async (event): Promise<PublicProfile> => {
  const notFound = () => {
    // Never kept: a profile that is closed now may be open in a minute.
    setResponseHeader(event, "Cache-Control", "no-store");
    return createError({
      statusCode: 404,
      message: "Nie ma takiego profilu.",
    });
  };

  const handle = getRouterParam(event, "handle") ?? "";
  if (!isValidHandle(handle)) throw notFound();

  const db = getFirestore("koryta-pl");
  const owner = (
    await db.collection(userCollections.profileHandles).doc(handle).get()
  ).data() as Partial<ProfileHandleDoc> | undefined;
  const uid = owner?.uid;
  if (typeof uid !== "string" || !uid || isAutomatedUid(uid)) {
    throw notFound();
  }

  const [isPublic, profiles] = await Promise.all([
    readPublicProfileChoice(db, uid),
    readProfiles(db, [uid]),
  ]);
  const profile = profiles[uid];
  // The profile has to agree that this is its handle: a document left behind
  // by a change of handle must not keep the old address open.
  if (!isPublic || !profile || profile.handle !== handle || profile.hidden) {
    throw notFound();
  }

  let account: UserRecord;
  try {
    account = await getAuth().getUser(uid);
  } catch (error) {
    if ((error as { code?: unknown }).code === "auth/user-not-found") {
      throw notFound();
    }
    throw error;
  }
  if (account.disabled) throw notFound();

  const counts = await cachedProfileCounts(uid);

  setResponseHeader(event, "Cache-Control", `public, max-age=${MAX_AGE}`);
  return {
    handle,
    // From Auth, not the `users` mirror, which its owner can write anything
    // into. An administrator who resets the name resets this one.
    //
    // Without one, a neutral word rather than the handle: a handle is usually
    // cut from a name, and a heading made of it would show the very name an
    // administrator took down.
    name: account.displayName?.trim() || PROFILE_NAME_FALLBACK,
    avatar: ownAvatarPath(profile),
    joined: joinedMonth(account.metadata.creationTime),
    counts,
  };
});
