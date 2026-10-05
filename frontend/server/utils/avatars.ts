/** A user's own profile picture: which one it is, and the places that show it.
 *
 * Which picture is the user's own is recorded in one place,
 * `profiles/{uid}.avatarImageId`, which nothing but this module sets, and only
 * in a transaction. Auth `photoURL` and `users/{uid}.photoURL` are what pages
 * draw - the first for everybody else (`identify`, `/api/users/lookup`), the
 * second for the user's own layout - but both can be pointed at any url from
 * the browser, through `updateProfile` and through a users document the rules
 * put no shape on. Neither can say whether a picture is one we store, so a
 * public surface reads the record (`ownAvatarPath`) and never the mirrors.
 *
 * Every change runs the same three steps:
 * 1. a transaction swaps the id in the record, writing the new image with it;
 * 2. the mirrors are pointed at whatever the record names by then - read back,
 *    and pointed again if another request changed it meanwhile;
 * 3. every avatar of the user's that the record does not name is deleted,
 *    but for the one step 2 just pointed the mirrors at.
 *
 * Two changes at once - a double click, two tabs, an administrator's takedown
 * crossing an upload - are put in order by the transaction, and whichever
 * lost cleans up after itself: it finds the winner in the record, points the
 * mirrors at it, and deletes its own picture with the old one. Nothing is
 * deleted before the mirrors point elsewhere, so a request that fails half way
 * leaves an unused picture behind rather than one that does not load, and the
 * next change sweeps it up.
 */
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  deleteImages,
  imagesOf,
  newImage,
  type DecodedImage,
} from "~~/server/utils/images";
import { recordUserAction } from "~~/server/utils/userActions";
import { IMAGE_ID_PATTERN, imagePath } from "~~/shared/images";
import {
  userCollections,
  type ProfileDoc,
  type UserActionDoc,
} from "~~/shared/userAdmin";

/** A profile as it is first written, by whichever of its fields comes first -
 * the picture here, a handle or a hide elsewhere - so a reader finds every
 * field there, null or not. */
const EMPTY_PROFILE: ProfileDoc = {
  handle: null,
  avatarImageId: null,
  hidden: null,
};

/** How many times the mirrors are pointed again when the record keeps moving
 * under them. Each round is a change somebody else committed in the moment
 * between two reads; three in a row is somebody scripting uploads, and they
 * get whatever the last round wrote. */
const SYNC_ROUNDS = 3;

/** The site's path to an account's own picture, or null for initials.
 *
 * The one avatar a page shown to others may use. Relative, so it works on
 * whichever host serves the page, and checked as an image id although only
 * this module sets it - the profile is read whole elsewhere, and a path built
 * from it ends up in markup. */
export function ownAvatarPath(
  profile: Partial<Pick<ProfileDoc, "avatarImageId">> | null | undefined,
): string | null {
  const id = profile?.avatarImageId;
  return typeof id === "string" && IMAGE_ID_PATTERN.test(id)
    ? imagePath(id)
    : null;
}

/** Absolute, because Auth takes nothing else. Built from the site's own
 * address, which is what makes the picture recognisably ours (`isOwnImage`). */
const ownAvatarURL = (imageId: string) =>
  `${useRuntimeConfig().public.siteUrl}${imagePath(imageId)}`;

const profileRef = (db: Firestore, uid: string) =>
  db.collection(userCollections.profiles).doc(uid);

const avatarIdOf = (profile: Partial<ProfileDoc> | undefined) =>
  typeof profile?.avatarImageId === "string" && profile.avatarImageId
    ? profile.avatarImageId
    : null;

async function currentAvatarId(
  db: Firestore,
  uid: string,
): Promise<string | null> {
  const snap = await profileRef(db, uid).get();
  return avatarIdOf(snap.data() as Partial<ProfileDoc> | undefined);
}

/** Points everything that shows a user's picture at `photoURL`, or at nothing.
 *
 * Two places hold it. The Auth profile is what everybody else sees -
 * `identify` and `/api/users/lookup` read it for the contributor tables and
 * the revision queue - and the `users` document is what the user's own layout
 * and /profil read. */
export async function setUserPhotoURL(
  db: Firestore,
  uid: string,
  photoURL: string | null,
) {
  await Promise.all([
    getAuth().updateUser(uid, { photoURL }),
    db
      .collection("users")
      .doc(uid)
      .set({ photoURL: photoURL ?? FieldValue.delete() }, { merge: true }),
  ]);
}

const isOwnImage = (url: string) => {
  try {
    return new URL(url).pathname.startsWith("/api/images/");
  } catch {
    return false;
  }
};

/** The picture of the account the user signs in with, if it has one - what
 * they showed before they chose their own.
 *
 * Only from a provider like Google, which keeps its own photo. The `password`
 * provider has none of its own: Auth copies the account's picture into it, so
 * it holds the very avatar being taken down, and reverting to it left a user
 * pointing at a deleted image. */
export function providerPhotoOf(
  account: Pick<UserRecord, "providerData">,
): string | null {
  return (
    account.providerData.find(
      ({ providerId, photoURL }) =>
        providerId !== "password" && !!photoURL && !isOwnImage(photoURL),
    )?.photoURL ?? null
  );
}

export async function providerPhotoURL(uid: string): Promise<string | null> {
  return providerPhotoOf(await getAuth().getUser(uid));
}

/** What says whether an account shows a picture of its own. */
export type AvatarState = {
  /** `profiles/{uid}.avatarImageId`, the record. */
  avatarImageId: string | null | undefined;
  /** Any `images` of the account's with `purpose: "avatar"`, named by the
   * record or not. */
  storedAvatars: boolean;
  /** Auth's, what everybody else is shown. */
  photoURL: string | null;
  /** `providerPhotoOf` the account. */
  providerPhotoURL: string | null;
};

/** Whether the account shows anything but its sign-in provider's picture, and
 * so has one an administrator can take down.
 *
 * Three ways it can: a picture we store, which the record names; one left over
 * from an upload that failed half way, stored but named by nothing; or a url
 * the account was pointed at from the browser, which Auth takes from anybody
 * about themselves (`updateProfile`) and which the chips on the admin lists
 * and in the revision queue draw like any other. Only the server can tell the
 * last one from the provider's own picture - the row on /admin/uzytkownicy has
 * the url but not the provider's - so the route that takes a picture down and
 * the row that offers to (`AdminUserRow.avatarRemovable`) both ask this, and
 * the page never hides a takedown the route would make, nor offers one it
 * would refuse. */
export function hasRemovableAvatar(state: AvatarState): boolean {
  return (
    !!state.avatarImageId ||
    state.storedAvatars ||
    state.photoURL !== state.providerPhotoURL
  );
}

/** The uids with any avatar stored as theirs, for a list of accounts: one
 * query on `purpose` rather than `imagesOf` for every row. Ids and subjects
 * only, never the bytes.
 *
 * At most `cap` images are read. Past that an account's leftover could go
 * unseen - the record and the url still count - and the warning says so. */
export async function avatarOwners(
  db: Firestore,
  cap: number,
): Promise<Set<string>> {
  const snapshot = await db
    .collection("images")
    .where("purpose", "==", "avatar")
    .select("subject")
    .limit(cap)
    .get();
  if (snapshot.size >= cap) {
    console.warn(`avatarOwners: stopped at ${snapshot.size} avatar images`);
  }
  const owners = new Set<string>();
  for (const doc of snapshot.docs) {
    const subject = doc.get("subject") as unknown;
    if (typeof subject === "string" && subject.startsWith("users/")) {
      owners.add(subject.slice("users/".length));
    }
  }
  return owners;
}

/** Where step 2 left the mirrors: the url, and the picture of ours it names,
 * if any. */
type Shown = { photoURL: string | null; imageId: string | null };

/** Step 2: points the mirrors at the picture the record names, starting from
 * `imageId`, the one this request just committed - or at the sign-in
 * provider's when it names none. */
async function pointMirrorsAtRecord(
  db: Firestore,
  uid: string,
  imageId: string | null,
): Promise<Shown> {
  let expected = imageId;
  for (let round = 1; ; round++) {
    const photoURL = expected
      ? ownAvatarURL(expected)
      : await providerPhotoURL(uid);
    await setUserPhotoURL(db, uid, photoURL);

    const now = await currentAvatarId(db, uid);
    if (now === expected || round >= SYNC_ROUNDS) {
      if (now !== expected) {
        console.warn(
          `avatars: the picture of ${uid} changed ${SYNC_ROUNDS} times while ` +
            `it was being shown; left at ${photoURL ?? "none"}`,
        );
      }
      return { photoURL, imageId: expected };
    }
    expected = now;
  }
}

/** Step 3: deletes the user's avatars the record does not name, `replaced`
 * among them - except the one this request left the mirrors on.
 *
 * The listing is read before the record, never after. An upload that commits
 * in between then is not in the listing, so it cannot be taken for a stray;
 * one that committed before the listing is named by the record read after it.
 * Either way the picture a user just chose survives the sweep of a request
 * that lost to it.
 *
 * The picture the mirrors were just pointed at is spared even when the record
 * has moved on since: the account shows it until the request that moved the
 * record points the mirrors at its own, and that request's sweep, which comes
 * after, deletes it then. */
async function sweepAvatars(
  db: Firestore,
  uid: string,
  replaced: string | null,
  shown: Shown,
): Promise<string[]> {
  const listed = await imagesOf(db, `users/${uid}`, "avatar");
  const current = await currentAvatarId(db, uid);
  const stale = [...new Set([...(replaced ? [replaced] : []), ...listed])]
    .filter((id) => id !== current && id !== shown.imageId)
    .sort();
  await deleteImages(db, stale);
  return stale;
}

/** Steps 2 and 3, once the record has committed. A failure here leaves the
 * record right and the mirrors behind it - the next change of the picture
 * brings them in line - so it is logged with what the record says before it
 * reaches the caller as an error. */
async function followRecord(
  db: Firestore,
  uid: string,
  committed: string | null,
  replaced: string | null,
) {
  try {
    const shown = await pointMirrorsAtRecord(db, uid, committed);
    const removed = await sweepAvatars(db, uid, replaced, shown);
    return { photoURL: shown.photoURL, removed };
  } catch (error) {
    console.error(
      `avatars: the record of ${uid} names ${committed ?? "no picture"}, ` +
        `but the account and the images were not brought in line with it`,
      error,
    );
    throw error;
  }
}

/** Makes `image` the user's own picture, in place of whatever was.
 *
 * Returns the url the mirrors were left on - this picture's, unless another
 * upload committed after this one - and what the picture records about the
 * image. */
export async function setUserAvatar(
  db: Firestore,
  uid: string,
  image: DecodedImage,
) {
  const created = newImage(db, image, {
    purpose: "avatar",
    subject: `users/${uid}`,
    uploadedBy: uid,
  });
  const ref = profileRef(db, uid);
  const replaced = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = avatarIdOf(snap.data() as Partial<ProfileDoc>);
    tx.set(created.ref, created.doc);
    tx.set(
      ref,
      snap.exists
        ? { avatarImageId: created.ref.id }
        : { ...EMPTY_PROFILE, avatarImageId: created.ref.id },
      { merge: true },
    );
    return previous;
  });

  const { photoURL } = await followRecord(db, uid, created.ref.id, replaced);
  return { photoURL, image: created.imageRef };
}

/** Takes the user's own picture down, back to the one of the account they
 * sign in with, or to none - for the user themself and for moderation alike.
 *
 * `action`, when given, is the `userActions` line that says who took it down
 * and why, written in the same transaction as the record: there is no
 * takedown without its line, and no line for one that did not commit. The
 * mirrors follow afterwards, as for any change (see the top of this file).
 *
 * Returns the url the mirrors were left on and the images deleted. */
export async function removeUserAvatar(
  db: Firestore,
  uid: string,
  action?: Omit<UserActionDoc, "at">,
) {
  const ref = profileRef(db, uid);
  const replaced = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = avatarIdOf(snap.data() as Partial<ProfileDoc>);
    // An account with no profile has no record to clear, and is not given
    // one for it.
    if (snap.exists) tx.set(ref, { avatarImageId: null }, { merge: true });
    if (action) recordUserAction(db, action, tx);
    return previous;
  });

  return await followRecord(db, uid, null, replaced);
}
