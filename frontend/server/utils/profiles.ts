import { randomInt } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { ownAvatarPath } from "~~/server/utils/avatars";
import { publicProfileEnabled } from "~~/shared/profile";
import { isAutomatedUid } from "~~/shared/stats";
import {
  isValidHandle,
  profilePath,
  userCollections,
  type OwnProfileSettings,
  type ProfileDoc,
  type ProfileHandleDoc,
  type PublicProfile,
} from "~~/shared/userAdmin";

/** The public profile's address, and what it may show.
 *
 * A profile is reached by a handle and never by the uid. The uid is the key
 * every rating, note and revision is stored under, and those collections are
 * readable by anybody, so a page at `/uczestnik/<uid>` would join a name to the
 * whole of somebody's history - including everything they did before they
 * opted in. A handle names the page and nothing else.
 *
 * The handle lives in `profileHandles/{handle}` as well as on the profile, so
 * that two accounts can never hold the same one: a document id is unique, and
 * `create` inside a transaction is the only lock Firestore offers that holds
 * across server instances.
 */

/** Longest handle `HANDLE_PATTERN` accepts. */
const HANDLE_MAX = 30;

/** Changes of handle one account may make in a UTC day. A handle is a link
 * somebody may have shared, and every change releases the old one for anybody
 * to take - so a handle that changes every few seconds is a way to make other
 * people's links point at you. Five is plenty to fix a typo twice over. */
export const HANDLE_CHANGES_PER_DAY = 5;

/** How many numbered variants of a name to try before giving up on it -
 * `anna-nowak-2` to `anna-nowak-20`. Twenty people of one name is past what
 * the site has; the bound keeps the transaction's reads bounded too. */
const NUMBERED_TRIES = 19;

/** How many random handles to try when the name gives none. Thirty-six to the
 * fourth is 1.7 million, so the second try is already a formality. */
const RANDOM_TRIES = 5;

/** `getAll` takes its references as one argument list; 300 at a time, as
 * `readPublicProfiles` does. */
const READ_CHUNK = 300;

type HandleChanges = NonNullable<ProfileDoc["handleChanges"]>;

/** A name folded the way a page slug is (`createSlug` in
 * app/composables/slugs.ts), cut to the length a handle may have.
 *
 * Copied rather than imported: shared and server code may not import from
 * `app/`, and the rule is four lines. It drops diacritics through NFD and
 * spells out `ł`, which has no decomposition, so "Łukasz Żółć" is
 * `lukasz-zolc`. Null when what is left is not a handle - too short, nothing
 * but another script, or a word the site speaks with ("Admin").
 */
export function handleFromName(name: string | null | undefined): string | null {
  const folded = (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const handle = fitHandle(folded);
  return isValidHandle(handle) ? handle : null;
}

/** Cut to `max` characters without leaving a hyphen at the end. */
const fitHandle = (handle: string, max = HANDLE_MAX) =>
  handle.slice(0, max).replace(/-+$/, "");

const randomSuffix = () =>
  Array.from(
    { length: 4 },
    () => "abcdefghijklmnopqrstuvwxyz0123456789"[randomInt(36)],
  ).join("");

/** The handles to try for a name, best first: the name itself, then the name
 * numbered, then `uczestnik-xxxx`. A generator, so a transaction that is
 * retried starts the list again rather than resuming somebody else's. */
function* handleCandidates(name: string | null | undefined) {
  const base = handleFromName(name);
  if (base) {
    yield base;
    for (let n = 2; n < 2 + NUMBERED_TRIES; n++) {
      const suffix = `-${n}`;
      const numbered = `${fitHandle(base, HANDLE_MAX - suffix.length)}${suffix}`;
      if (isValidHandle(numbered)) yield numbered;
    }
  }
  for (let i = 0; i < RANDOM_TRIES; i++) {
    yield `uczestnik-${randomSuffix()}`;
  }
}

const profileRef = (db: Firestore, uid: string) =>
  db.collection(userCollections.profiles).doc(uid);

const handleRef = (db: Firestore, handle: string) =>
  db.collection(userCollections.profileHandles).doc(handle);

/** Every field of `ProfileDoc`, whichever writer created the document - the
 * avatar code may well have made it before anybody asked for a handle. */
function normalizeProfile(data: Partial<ProfileDoc> | undefined): ProfileDoc {
  return {
    handle: typeof data?.handle === "string" ? data.handle : null,
    avatarImageId:
      typeof data?.avatarImageId === "string" ? data.avatarImageId : null,
    hidden: data?.hidden ?? null,
    ...(data?.handleChanges ? { handleChanges: data.handleChanges } : {}),
  };
}

/** The account's handle, assigned from its display name if it has none.
 *
 * Idempotent: an account keeps the handle it has, and calling this for it
 * writes nothing. Called wherever a handle is about to be needed - the owner's
 * /profil settings and the ranking, for people who opted in - so a profile
 * that has been public since before handles existed gets one without being
 * asked to choose.
 */
export async function ensureHandle(
  db: Firestore,
  uid: string,
  displayName: string | null | undefined,
): Promise<string> {
  return db.runTransaction(async (tx) => {
    const profileSnapshot = await tx.get(profileRef(db, uid));
    const existing = normalizeProfile(profileSnapshot.data()).handle;
    if (existing) return existing;

    for (const candidate of handleCandidates(displayName)) {
      const owner = await tx.get(handleRef(db, candidate));
      const ownedBy = (owner.data() as ProfileHandleDoc | undefined)?.uid;
      if (owner.exists && ownedBy !== uid) continue;

      // A document that is already this account's - left by a write that
      // claimed the handle and never reached the profile - is taken back as it
      // is, since `create` would refuse it.
      if (!owner.exists) {
        tx.create(handleRef(db, candidate), {
          uid,
          createdAt: new Date().toISOString(),
        } satisfies ProfileHandleDoc);
      }
      if (profileSnapshot.exists) {
        tx.update(profileRef(db, uid), { handle: candidate });
      } else {
        tx.set(profileRef(db, uid), {
          handle: candidate,
          avatarImageId: null,
          hidden: null,
        } satisfies ProfileDoc);
      }
      return candidate;
    }

    throw new Error(`ensureHandle: no free handle found for ${uid}`);
  });
}

/** Moves the account to a handle its owner chose. Validation of the handle
 * itself is the caller's (`handleBodySchema`); this decides whether it is
 * free and whether the account may change it today.
 *
 * The old handle is released in the same transaction, so between the two
 * there is never a moment when the account holds both or neither.
 */
export async function setHandle(
  db: Firestore,
  uid: string,
  handle: string,
  now: Date = new Date(),
): Promise<string> {
  return db.runTransaction(async (tx) => {
    const profileSnapshot = await tx.get(profileRef(db, uid));
    const profile = normalizeProfile(profileSnapshot.data());
    if (profile.handle === handle) return handle;

    const wanted = await tx.get(handleRef(db, handle));
    if (
      wanted.exists &&
      (wanted.data() as ProfileHandleDoc | undefined)?.uid !== uid
    ) {
      throw createError({
        statusCode: 409,
        message: "Ten adres profilu jest już zajęty. Wybierz inny.",
      });
    }
    // Read before any write, as a transaction must: whether the old document
    // is really this account's, so a profile that points at somebody else's
    // handle cannot free it for them.
    const previous = profile.handle
      ? await tx.get(handleRef(db, profile.handle))
      : null;

    const day = now.toISOString().slice(0, 10);
    const changesToday =
      profile.handleChanges?.day === day ? profile.handleChanges.count : 0;
    if (changesToday >= HANDLE_CHANGES_PER_DAY) {
      throw createError({
        statusCode: 429,
        message: `Adres profilu można zmienić najwyżej ${HANDLE_CHANGES_PER_DAY} razy dziennie. Spróbuj jutro.`,
      });
    }

    if (!wanted.exists) {
      tx.create(handleRef(db, handle), {
        uid,
        createdAt: now.toISOString(),
      } satisfies ProfileHandleDoc);
    }
    if (
      previous?.exists &&
      (previous.data() as ProfileHandleDoc | undefined)?.uid === uid
    ) {
      tx.delete(previous.ref);
    }
    const handleChanges: HandleChanges = { day, count: changesToday + 1 };
    if (profileSnapshot.exists) {
      tx.update(profileRef(db, uid), { handle, handleChanges });
    } else {
      tx.set(profileRef(db, uid), {
        handle,
        avatarImageId: null,
        hidden: null,
        handleChanges,
      } satisfies ProfileDoc);
    }
    return handle;
  });
}

/** A handle `ensureHandle` hands out when the name gives none. It says
 * nothing about anybody. */
const NEUTRAL_HANDLE = /^uczestnik-[a-z0-9]{4}$/;

/** Moves the account from its handle to a neutral `uczestnik-xxxx`, inside the
 * caller's transaction: what an administrator's reset of the display name does
 * to the handle too.
 *
 * A handle is cut from the display name when it is first assigned
 * (`ensureHandle`) and does not follow the name after, so a name taken down for
 * what it says would go on saying it in the profile's address and in every
 * ranking link to it. Any handle is replaced, not only one that still matches
 * the name: the owner may have typed the same words in by hand, and the
 * administrator who took the name down is not asked to compare the two. One
 * that is neutral already is left as it is - there is nothing in it to take
 * down, and links to it keep working.
 *
 * The old handle is released as `setHandle` releases it, only if its document
 * is really this account's. The move does not count against the owner's
 * `HANDLE_CHANGES_PER_DAY`: they did not make it, and must still be able to
 * choose a handle of their own today.
 *
 * Reads first and then writes, as a transaction must, so the caller reads
 * nothing after calling it; writes of its own may follow. Returns the handle
 * the account had and the one it has now, or null when there was nothing to
 * replace.
 */
export async function replaceHandleWithNeutral(
  db: Firestore,
  tx: Transaction,
  uid: string,
  now: Date = new Date(),
): Promise<{ from: string; to: string } | null> {
  const profileSnapshot = await tx.get(profileRef(db, uid));
  const from = normalizeProfile(profileSnapshot.data()).handle;
  if (!from || NEUTRAL_HANDLE.test(from)) return null;

  const previous = await tx.get(handleRef(db, from));
  for (const candidate of handleCandidates(null)) {
    if ((await tx.get(handleRef(db, candidate))).exists) continue;

    tx.create(handleRef(db, candidate), {
      uid,
      createdAt: now.toISOString(),
    } satisfies ProfileHandleDoc);
    if (
      previous.exists &&
      (previous.data() as ProfileHandleDoc | undefined)?.uid === uid
    ) {
      tx.delete(previous.ref);
    }
    // `handleChanges` is left alone: see above.
    tx.update(profileRef(db, uid), { handle: candidate });
    return { from, to: candidate };
  }

  throw new Error(`replaceHandleWithNeutral: no free handle found for ${uid}`);
}

/** The profiles of the given accounts, keyed by uid. An account with no
 * profile document is left out. */
export async function readProfiles(
  db: Firestore,
  uids: string[],
): Promise<Record<string, ProfileDoc>> {
  const found: Record<string, ProfileDoc> = {};
  for (let i = 0; i < uids.length; i += READ_CHUNK) {
    const chunk = uids.slice(i, i + READ_CHUNK);
    const snapshots = await db.getAll(
      ...chunk.map((uid) => profileRef(db, uid)),
    );
    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        found[snapshot.id] = normalizeProfile(
          snapshot.data() as Partial<ProfileDoc>,
        );
      }
    }
  }
  return found;
}

/** Where the profile can be opened, or null: only for an account whose owner
 * made it public, which has a handle and which no administrator hid. */
export function openProfilePath(
  profile: ProfileDoc | undefined,
  isPublic: boolean,
): string | null {
  return isPublic && profile?.handle && !profile.hidden
    ? profilePath(profile.handle)
    : null;
}

/** Whether the account's owner turned `publicProfile` on.
 *
 * With a field mask: `users/{uid}` is writable by its owner with no constraint
 * on shape, so the one boolean is all that is read of it. */
export async function readPublicProfileChoice(
  db: Firestore,
  uid: string,
): Promise<boolean> {
  const [snapshot] = await db.getAll(db.collection("users").doc(uid), {
    fieldMask: ["publicProfile"],
  });
  return publicProfileEnabled(
    snapshot?.data()?.publicProfile as boolean | undefined,
  );
}

/** The account's display name as it is now, for a handle about to be made
 * from it. The token's `name` is what the account was called when the token
 * was issued, up to an hour ago - and /profil is where the name is changed,
 * so it is often stale exactly when this is asked. It stands in only when the
 * auth service cannot be reached. */
export async function accountDisplayName(
  uid: string,
  tokenName: unknown,
): Promise<string | null> {
  try {
    return (await getAuth().getUser(uid)).displayName ?? null;
  } catch (error) {
    console.warn(`accountDisplayName: could not read ${uid}`, error);
    return typeof tokenName === "string" ? tokenName : null;
  }
}

/** What /profil shows about the caller's own public profile.
 *
 * A handle is assigned here, the first time the owner looks while the switch is
 * on - which is also right after they turned it on, since /profil asks again
 * once the switch is saved. `displayName` is asked for only then, because it
 * is a call to the auth service the common case does not need.
 */
export async function ownProfileSettings(
  db: Firestore,
  uid: string,
  displayName: () => Promise<string | null>,
): Promise<OwnProfileSettings> {
  const isPublic = await readPublicProfileChoice(db, uid);
  const profile = (await readProfiles(db, [uid]))[uid];

  let handle = profile?.handle ?? null;
  if (isPublic && !handle && !isAutomatedUid(uid)) {
    handle = await ensureHandle(db, uid, await displayName());
  }

  const withHandle = profile
    ? { ...profile, handle }
    : normalizeProfile({ handle });
  return {
    publicProfile: isPublic,
    handle,
    path: isAutomatedUid(uid) ? null : openProfilePath(withHandle, isPublic),
    hidden: !!profile?.hidden,
    avatar: ownAvatarPath(profile),
  };
}

/** What the account did, by document, for its public profile.
 *
 * Four aggregations and no document reads, on single-field indexes Firestore
 * merges for equality filters - no composite needed. Proposals are those made
 * by hand (`update_automatic == false`), as on /admin/uzytkownicy and in the
 * activity counts: an import signed by the person is not their proposal, and
 * the 1,760 legacy revisions without the flag are left out with them.
 */
export async function profileCounts(
  db: Firestore,
  uid: string,
): Promise<PublicProfile["counts"]> {
  const count = async (query: FirebaseFirestore.Query) =>
    (await query.count().get()).data().count;
  const proposals = db
    .collection("revisions")
    .where("update_user", "==", uid)
    .where("update_automatic", "==", false);

  const [votes, notes, proposed, accepted] = await Promise.all([
    count(db.collection("votes").where("userUid", "==", uid)),
    count(db.collection("notes").where("userUid", "==", uid)),
    count(proposals),
    count(proposals.where("status", "==", "approved")),
  ]);
  return { votes, notes, proposals: proposed, accepted };
}
