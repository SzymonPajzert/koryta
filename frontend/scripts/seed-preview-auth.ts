/**
 * The accounts the preview site is signed into.
 *
 * Production's users are not copied. Auth is the one thing a preview cannot
 * share without being able to do real damage - a password changed or an
 * account deleted on a throwaway site is changed and deleted for the person it
 * belongs to - and it is also the one thing that is cheap to fake, because
 * nothing on the site cares who you are beyond a uid and a couple of claims.
 * So the preview project gets two synthetic accounts and nobody else's.
 *
 *   npm run preview:seed:auth                 # create what is missing
 *   PREVIEW_PASSWORD=... npm run preview:seed:auth   # and reset the passwords
 *
 * Existing accounts keep their password unless PREVIEW_PASSWORD says
 * otherwise, so re-running this after a data refresh does not silently
 * invalidate the one written down somewhere. A generated password is printed
 * once, when the account is created.
 */
import { randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import {
  PREVIEW_PROJECT_ID,
  PROD_PROJECT_ID,
  USERS_DATABASE_ID,
} from "../shared/firebase-env";

const projectId = process.env.PREVIEW_PROJECT || PREVIEW_PROJECT_ID;

const ACCOUNTS = [
  {
    uid: "preview-admin",
    email: "admin@preview.koryta.pl",
    displayName: "Preview Admin",
    // datascience: allows uploading extractions via /api/ingest/extraction
    claims: { admin: true, datascience: true },
  },
  {
    uid: "preview-user",
    email: "user@preview.koryta.pl",
    displayName: "Preview User",
    claims: {},
  },
];

async function seed() {
  if (projectId === PROD_PROJECT_ID) {
    throw new Error(`Refusing to create accounts in ${PROD_PROJECT_ID}`);
  }
  // A leftover emulator host in the shell would send all of this to a local
  // emulator and report success, leaving the preview project with no way in.
  for (const variable of [
    "FIREBASE_AUTH_EMULATOR_HOST",
    "FIRESTORE_EMULATOR_HOST",
  ]) {
    if (process.env[variable]) {
      throw new Error(
        `${variable} is set (${process.env[variable]}); this seeds the real ${projectId} project. Unset it.`,
      );
    }
  }

  const app = initializeApp({ projectId });
  const auth = getAuth(app);
  // `users` lives in the unnamed database, in preview as in production.
  const users = getFirestore(app, USERS_DATABASE_ID);

  // One password for both accounts: they are handed round together, and a
  // second one to lose helps nobody.
  const requested = process.env.PREVIEW_PASSWORD;
  const password = requested ?? randomBytes(12).toString("base64url");
  const created: string[] = [];

  for (const account of ACCOUNTS) {
    const existing = await auth.getUser(account.uid).catch(() => null);
    if (existing) {
      await auth.updateUser(account.uid, {
        email: account.email,
        displayName: account.displayName,
        ...(requested ? { password: requested } : {}),
      });
      console.log(
        `${account.email}: ${requested ? "password reset" : "already there, password left alone"}`,
      );
    } else {
      await auth.createUser({
        uid: account.uid,
        email: account.email,
        displayName: account.displayName,
        password,
        emailVerified: true,
      });
      created.push(account.email);
      console.log(`${account.email}: created`);
    }
    await auth.setCustomUserClaims(account.uid, account.claims);
    // What the site itself keeps about a user, so the profile page has
    // something to show before anyone touches it.
    await users
      .collection("users")
      .doc(account.uid)
      .set({ displayName: account.displayName }, { merge: true });
  }

  console.log(`\nSeeded ${ACCOUNTS.length} accounts in ${projectId}.`);
  if (requested) {
    console.log(`Password for all of them: ${password}`);
  } else if (created.length > 0) {
    console.log(`Password for ${created.join(" and ")}: ${password}`);
    console.log(
      "Generated, and printed only here. Set PREVIEW_PASSWORD to choose one.",
    );
  }
}

seed().catch((error) => {
  console.error("Failed to seed the preview accounts:", error);
  process.exit(1);
});
