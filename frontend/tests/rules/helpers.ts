import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  setDoc,
  type Firestore,
} from "firebase/firestore";

/** The emulator every rules test file talks to, and the browsers it talks as.
 *
 * Plain client SDK against the emulator, which `npm run test:rules` starts on
 * its own port. Every file loads the rules itself and empties the database
 * before each test, so the files share nothing but the emulator - and
 * vitest.rules.config.ts runs them one at a time, since they share that.
 */
const RULES = readFileSync(
  fileURLToPath(new URL("../../../firestore.rules", import.meta.url)),
  "utf8",
);
const PROJECT = "demo-koryta-rules";
const DATABASE = "koryta-pl";
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8081")
  .split(":")
  .map((part, index) => (index === 0 ? part.replace(/^\[|\]$/g, "") : part));
const EMULATOR = `http://${HOST}:${PORT}`;

const apps: FirebaseApp[] = [];
let owner: Firestore | undefined;

/** A browser's Firestore: nobody, somebody signed in - with the custom claims
 * their token carries, such as `datascience` - or the emulator's "owner",
 * which skips the rules and is how a test sets itself up. */
export function firestoreAs(
  who:
    "owner" | "anonymous" | { uid: string; claims?: Record<string, unknown> },
): Firestore {
  const app = initializeApp(
    { projectId: PROJECT, apiKey: "fake-api-key" },
    `rules-${apps.length}`,
  );
  apps.push(app);
  const db = getFirestore(app, DATABASE);
  connectFirestoreEmulator(
    db,
    HOST!,
    Number(PORT),
    who === "anonymous"
      ? {}
      : {
          mockUserToken:
            who === "owner"
              ? "owner"
              : { sub: who.uid, user_id: who.uid, ...who.claims },
        },
  );
  return db;
}

/** What a refused read or write looks like from the client. */
export const denied = { code: "permission-denied" };

/** Puts the repo's firestore.rules in front of the emulator. */
export async function loadRules() {
  const response = await fetch(
    `${EMULATOR}/emulator/v1/projects/${PROJECT}:securityRules`,
    {
      method: "PUT",
      body: JSON.stringify({
        rules: { files: [{ name: "firestore.rules", content: RULES }] },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`The emulator refused the rules: ${await response.text()}`);
  }
}

/** Empties the database, so that every test starts from its own fixtures. */
export async function clearDatabase() {
  await fetch(
    `${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/${DATABASE}/documents`,
    { method: "DELETE" },
  );
}

/** Writes a fixture past the rules. */
export async function seed(path: string, data: Record<string, unknown>) {
  owner ??= firestoreAs("owner");
  await setDoc(doc(owner, path), data);
}

export async function closeApps() {
  await Promise.all(apps.splice(0).map((app) => deleteApp(app)));
  owner = undefined;
}
