import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearDatabase,
  closeApps,
  denied,
  firestoreAs,
  loadRules,
  seed,
} from "./helpers";

/** What firestore.rules lets a browser do with the BIP declarations.
 *
 * Nothing, for anybody: a crop is a named person's birth date in their own
 * hand, and a reader must not see the others' answers before giving theirs.
 * The routes go through the admin SDK; this is the other door.
 *
 *   devns npm run test:rules
 */
const COLLECTIONS = [
  ["declarationCandidacies", "f23a52f46489f75f"],
  ["declarationExtracts", "a-p0"],
  ["declarationExtractImages", "a-p0"],
  ["declarationAnswers", "a-p0_reader"],
  ["declarationPublications", "kowalska"],
  ["declarationPublishLimits", "2026-10-29"],
] as const;

let browsers: [string, Firestore][];

beforeAll(async () => {
  await loadRules();
  browsers = [
    ["anonymous", firestoreAs("anonymous")],
    ["a reader", firestoreAs({ uid: "reader" })],
    [
      "an admin in the datascience group",
      firestoreAs({
        uid: "admin",
        claims: { admin: true, datascience: true, owner: true },
      }),
    ],
  ];
});

afterAll(closeApps);

beforeEach(async () => {
  await clearDatabase();
  for (const [name, id] of COLLECTIONS) {
    await seed(`${name}/${id}`, { status: "open" });
  }
});

describe.each(COLLECTIONS)("%s", (name, id) => {
  it("is read by nobody through the client", async () => {
    for (const [, db] of browsers) {
      await expect(getDoc(doc(db, `${name}/${id}`))).rejects.toMatchObject(
        denied,
      );
      await expect(getDocs(collection(db, name))).rejects.toMatchObject(denied);
    }
  });

  it("is written by nobody through the client", async () => {
    for (const [, db] of browsers) {
      await expect(
        setDoc(doc(db, `${name}/${id}`), { status: "agreed" }),
      ).rejects.toMatchObject(denied);
    }
  });
});
