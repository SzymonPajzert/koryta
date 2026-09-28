import { getAuth } from "firebase-admin/auth";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

/** Points everything that shows a user's picture at `photoURL`, or at nothing.
 *
 * Two places hold it. The Auth profile is what everybody else sees -
 * `identify` and `/api/users/lookup` read it for the contributor tables, the
 * activity feed and the revision queue - and the `users` document is what the
 * user's own layout and /profil read. */
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
export async function providerPhotoURL(uid: string): Promise<string | null> {
  const account = await getAuth().getUser(uid);
  return (
    account.providerData.find(
      ({ providerId, photoURL }) =>
        providerId !== "password" && !!photoURL && !isOwnImage(photoURL),
    )?.photoURL ?? null
  );
}
