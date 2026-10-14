import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/** What firestore.rules lets a browser read of the drafts.
 *
 * The routes keep drafts to signed in readers (server/utils/handlers.ts), but
 * every route goes through the admin SDK and the rules are the other door: on
 * 2026-10-01 a REST call with no token read any person node, published or not,
 * and listed every revision with its parties. Rules deploy on their own, by a
 * separate `firebase deploy`, so nothing else would notice them being wrong.
 *
 * Plain client SDK against the emulator, which `npm run test:rules` starts on
 * its own port:
 *
 *   devns npm run test:rules
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

/** A browser's Firestore: nobody, somebody signed in, or the emulator's
 * "owner", which skips the rules and is how a test sets itself up. */
function firestoreAs(who: "owner" | "anonymous" | { uid: string }): Firestore {
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
            who === "owner" ? "owner" : { sub: who.uid, user_id: who.uid },
        },
  );
  return db;
}

let owner: Firestore;
let anonymous: Firestore;
let reader: Firestore;

async function seed(path: string, data: Record<string, unknown>) {
  await setDoc(doc(owner, path), data);
}

/** What a refused read looks like from the client. */
const denied = { code: "permission-denied" };

beforeAll(async () => {
  const response = await fetch(
    `${EMULATOR}/emulator/v1/projects/${PROJECT}:securityRules`,
    {
      method: "PUT",
      body: JSON.stringify({
        rules: { files: [{ name: "firestore.rules", content: RULES }] },
      }),
    },
  );
  expect(response.ok).toBe(true);
  owner = firestoreAs("owner");
  anonymous = firestoreAs("anonymous");
  reader = firestoreAs({ uid: "reader" });
});

afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
});

beforeEach(async () => {
  await fetch(
    `${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/${DATABASE}/documents`,
    { method: "DELETE" },
  );
  await seed("nodes/published", {
    type: "person",
    name: "Anna Nowak",
    published: true,
  });
  await seed("nodes/draft", {
    type: "person",
    name: "Jan Kowalski",
    published: false,
    parties: ["Partia"],
  });
  await seed("nodes/merged", {
    type: "person",
    name: "Anna Nowak",
    published: true,
    deleted: true,
    merged_into: "published",
  });
  await seed("nodes/company", {
    type: "place",
    name: "Spółka S.A.",
    published: true,
  });
});

describe("nodes", () => {
  it("lets anybody read a published page", async () => {
    await expect(
      getDoc(doc(anonymous, "nodes/published")),
    ).resolves.toBeDefined();
    await expect(
      getDoc(doc(anonymous, "nodes/company")),
    ).resolves.toBeDefined();
  });

  it("does not let anybody read a draft, signed in or not", async () => {
    // Nothing in the app reads a node through the client SDK; the drafts a
    // signed in reader sees come from /api.
    await expect(getDoc(doc(anonymous, "nodes/draft"))).rejects.toMatchObject(
      denied,
    );
    await expect(getDoc(doc(reader, "nodes/draft"))).rejects.toMatchObject(
      denied,
    );
  });

  it("does not let anybody read a page merged away", async () => {
    await expect(getDoc(doc(anonymous, "nodes/merged"))).rejects.toMatchObject(
      denied,
    );
  });

  it("does not let anybody list the people", async () => {
    // A list is allowed only if every document it could return is, and most
    // people are drafts.
    await expect(
      getDocs(
        query(collection(anonymous, "nodes"), where("type", "==", "person")),
      ),
    ).rejects.toMatchObject(denied);
  });
});

describe("revisions", () => {
  beforeEach(async () => {
    await seed("revisions/rev-1", {
      node_id: "draft",
      data: { name: "Jan Kowalski", parties: ["Partia"] },
    });
  });

  it("are read by nobody through the client", async () => {
    await expect(
      getDoc(doc(anonymous, "revisions/rev-1")),
    ).rejects.toMatchObject(denied);
    await expect(getDoc(doc(reader, "revisions/rev-1"))).rejects.toMatchObject(
      denied,
    );
    await expect(
      getDocs(collection(anonymous, "revisions")),
    ).rejects.toMatchObject(denied);
  });
});

describe("notes", () => {
  beforeEach(async () => {
    await seed("notes/company_alice", {
      nodeId: "company",
      userUid: "alice",
      sources: [{ url: "https://example.com", text: "Zarząd spółki" }],
    });
    await seed("notes/draft_alice", {
      nodeId: "draft",
      userUid: "alice",
      sources: [{ url: "https://example.com", text: "Członek partii" }],
    });
    await seed("notes/published_reader", {
      nodeId: "published",
      userUid: "reader",
      sources: [],
    });
  });

  /** The query `useNotes` makes for a page. */
  const notesOn = (db: Firestore, nodeId: string) =>
    getDocs(query(collection(db, "notes"), where("nodeId", "==", nodeId)));

  it("lets anybody read the notes on a company", async () => {
    const snapshot = await notesOn(anonymous, "company");
    expect(snapshot.docs.map((note) => note.id)).toEqual(["company_alice"]);
  });

  it("keeps the notes on a person to signed in readers", async () => {
    await expect(notesOn(anonymous, "draft")).rejects.toMatchObject(denied);
    await expect(notesOn(anonymous, "published")).rejects.toMatchObject(denied);
    await expect(
      getDoc(doc(anonymous, "notes/draft_alice")),
    ).rejects.toMatchObject(denied);

    const snapshot = await notesOn(reader, "draft");
    expect(snapshot.docs.map((note) => note.id)).toEqual(["draft_alice"]);
  });

  it("still lets a reader list their own notes, on any page", async () => {
    // The profile's contributions count, which asks by author, not by page.
    const snapshot = await getDocs(
      query(collection(reader, "notes"), where("userUid", "==", "reader")),
    );
    expect(snapshot.docs.map((note) => note.id)).toEqual(["published_reader"]);
  });

  it("keeps a note whose page is gone from a logged out reader", async () => {
    await seed("notes/ghost_alice", { nodeId: "ghost", userUid: "alice" });
    await expect(notesOn(anonymous, "ghost")).rejects.toMatchObject(denied);
  });
});
