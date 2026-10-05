import { getAuth, type UserRecord } from "firebase-admin/auth";
import {
  FieldValue,
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody } from "h3";
import { requireEstablishedAdmin } from "~~/server/utils/auth";
import {
  hasRemovableAvatar,
  providerPhotoOf,
  removeUserAvatar,
} from "~~/server/utils/avatars";
import { imagesOf } from "~~/server/utils/images";
import { replaceHandleWithNeutral } from "~~/server/utils/profiles";
import { recordUserAction } from "~~/server/utils/userActions";
import { buildRowFor, readAccount } from "~~/server/utils/userDirectory";
import { roleFromClaims } from "~~/shared/roles";
import {
  moderateBodySchema,
  userCollections,
  type AdminUserRow,
  type ProfileDoc,
} from "~~/shared/userAdmin";

const nothingToDo = (message: string) =>
  createError({ statusCode: 409, message });

async function findAccount(uid: string): Promise<UserRecord> {
  try {
    return await getAuth().getUser(uid);
  } catch (error) {
    if ((error as { code?: unknown }).code === "auth/user-not-found") {
      throw createError({ statusCode: 404, message: "Nie ma takiego konta." });
    }
    throw error;
  }
}

/** Back to the sign-in provider's picture, or none.
 *
 * Something to do whenever the account shows anything but that
 * (`hasRemovableAvatar`, which the row on /admin/uzytkownicy offers the button
 * by too): a picture we store, one left over from an upload that failed half
 * way, or a url the account was pointed at from the browser. */
async function takeDownAvatar(
  db: Firestore,
  account: UserRecord,
  profile: Partial<ProfileDoc> | undefined,
  by: string,
  reason: string,
) {
  const stored = await imagesOf(db, `users/${account.uid}`, "avatar");
  const shown = account.photoURL ?? null;
  if (
    !hasRemovableAvatar({
      avatarImageId: profile?.avatarImageId,
      storedAvatars: stored.length > 0,
      photoURL: shown,
      providerPhotoURL: providerPhotoOf(account),
    })
  ) {
    throw nothingToDo("To konto nie ma własnego zdjęcia profilowego.");
  }
  // The url it showed, for the history: the picture itself is deleted, and
  // what an administrator took down should still be nameable afterwards.
  return await removeUserAvatar(db, account.uid, {
    kind: "removeAvatar",
    target: account.uid,
    by,
    reason,
    detail: shown ?? undefined,
  });
}

/** Clears the display name, so the account is shown by its fallback -
 * "Uczestnik" on its profile, an ordinal in the ranking - until its holder sets
 * another on /profil.
 *
 * The handle goes with it, to a neutral `uczestnik-xxxx`
 * (`replaceHandleWithNeutral`): it was most likely cut from this very name, and
 * would otherwise keep the words just taken down in the profile's address and
 * in the ranking's link to it. The old one is kept in the history line, next
 * to the name.
 *
 * Auth first, then one transaction with the handle, the mirror and the history
 * line: Auth cannot join a transaction, and a line saying a name was reset must
 * not exist for a reset that failed. The other way round is logged loudly
 * instead. */
async function resetName(
  db: Firestore,
  account: UserRecord,
  by: string,
  reason: string,
) {
  const usersRef = db.collection("users").doc(account.uid);
  // One field: the document is its holder's to write, with no shape.
  const [snap] = await db.getAll(usersRef, { fieldMask: ["displayName"] });
  const mirrored = snap?.get("displayName") as unknown;
  const name =
    account.displayName || (typeof mirrored === "string" ? mirrored : "");
  if (!name) throw nothingToDo("To konto nie ma nazwy użytkownika.");

  await getAuth().updateUser(account.uid, { displayName: null });

  try {
    await db.runTransaction(async (tx) => {
      // Every read of the transaction is in here, so it goes first.
      const handle = await replaceHandleWithNeutral(db, tx, account.uid);
      // Not for an account that never saved a setting: it has no document,
      // and gets none for this.
      if (mirrored !== undefined) {
        tx.set(usersRef, { displayName: FieldValue.delete() }, { merge: true });
      }
      recordUserAction(
        db,
        {
          kind: "resetName",
          target: account.uid,
          by,
          reason,
          detail: handle
            ? `${name} (adres profilu: ${handle.from} → ${handle.to})`
            : name,
        },
        tx,
      );
    });
  } catch (error) {
    console.error(
      `moderate: the name of ${account.uid} is reset in Auth, but neither ` +
        `its handle, its users document nor the record of who reset it ` +
        `was written`,
      error,
    );
    throw error;
  }
}

/** Hides or shows the public profile again. A hidden profile is a 404 for
 * everybody (`/api/profiles/[handle]`), and hiding one that does not exist yet
 * keeps it from ever opening. Only the record changes: the account, its name
 * and its picture are left as they are. */
async function setHidden(
  db: Firestore,
  uid: string,
  action: "hideProfile" | "unhideProfile",
  by: string,
  reason: string,
) {
  const hide = action === "hideProfile";
  const ref = db.collection(userCollections.profiles).doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current =
      (snap.data() as Partial<ProfileDoc> | undefined)?.hidden ?? null;
    if (hide && current) throw nothingToDo("Ten profil jest już ukryty.");
    if (!hide && !current) throw nothingToDo("Ten profil nie jest ukryty.");

    const hidden: ProfileDoc["hidden"] = hide
      ? { by, at: new Date().toISOString(), reason }
      : null;
    tx.set(
      ref,
      snap.exists ? { hidden } : { handle: null, avatarImageId: null, hidden },
      { merge: true },
    );
    recordUserAction(
      db,
      // Bringing a profile back keeps why it was hidden next to why it is
      // back.
      { kind: action, target: uid, by, reason, detail: current?.reason },
      tx,
    );
  });
}

/** An established administrator's takedowns on somebody's account: the
 * picture, the name, the public profile. Each is recorded in `userActions`
 * with the reason given, and each refuses with a 409 when it would change
 * nothing, so the history holds only what happened.
 *
 * Established administrators only, like the rest of /admin/uzytkownicy: an
 * administrator on trial is who that page watches. Nobody but the owner
 * touches the owner's account. Acting on one's own account is allowed - it is
 * the same takedown the person could do themselves, with a line on record.
 *
 * Moderation never takes a role away; that is a nomination, and the claims
 * script's to apply.
 *
 * Answers with the account's row, read again once the action is done, as the
 * page's other writes do. The page puts it in place of the row it shows rather
 * than asking for the list, which comes out of a five-minute memo of Auth and
 * would bring back the very name or picture just taken down.
 */
export default defineEventHandler(async (event): Promise<AdminUserRow> => {
  const caller = await requireEstablishedAdmin(event);
  const { uid, action, reason } = await readValidatedBody(event, (body) =>
    moderateBodySchema.parse(body),
  );

  const account = await findAccount(uid);
  if (roleFromClaims(account.customClaims).owner && caller.owner !== true) {
    throw createError({
      statusCode: 403,
      message: "Konto właściciela serwisu może zmienić tylko on sam.",
    });
  }

  const db = getFirestore("koryta-pl");
  const profile = (
    await db.collection(userCollections.profiles).doc(uid).get()
  ).data() as Partial<ProfileDoc> | undefined;

  switch (action) {
    case "removeAvatar":
      await takeDownAvatar(db, account, profile, caller.uid, reason);
      break;
    case "resetName":
      await resetName(db, account, caller.uid, reason);
      break;
    case "hideProfile":
    case "unhideProfile":
      await setHidden(db, uid, action, caller.uid, reason);
      break;
  }

  // Read again rather than the `UserRecord` above, which still has the name
  // and the picture as they were.
  const after = await readAccount(uid);
  if (!after) {
    throw createError({ statusCode: 404, message: "Nie ma takiego konta." });
  }
  return buildRowFor(db, after);
});
