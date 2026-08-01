import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";

/** What firestore.rules lets a browser do.
 *
 * Rules are deployed on their own, by a separate `firebase deploy`, and no
 * other suite touches them: every server route goes through the admin SDK,
 * which bypasses rules entirely. So a rule can be wrong for as long as it
 * takes someone to notice in prod - which is the exact shape of failure this
 * whole exercise is about.
 *
 * Run with the emulator around it:
 *
 *   npm run test:rules
 */
const RULES = readFileSync(
  fileURLToPath(new URL("../../../firestore.rules", import.meta.url)),
  "utf8",
);

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    // A demo- project never reaches real Google infrastructure.
    projectId: "demo-koryta-rules",
    firestore: { rules: RULES },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** Writes a document past the rules, to set a test up rather than exercise it. */
async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

describe("users", () => {
  it("lets a user read their own document", async () => {
    await seed("users/alice", { email: "alice@example.com" });

    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(db, "users/alice")));
  });

  it("does not let a user read somebody else's document", async () => {
    await seed("users/alice", { email: "alice@example.com" });

    const db = testEnv.authenticatedContext("bob").firestore();
    await assertFails(getDoc(doc(db, "users/alice")));
  });

  it("does not let a signed out visitor read a user document", async () => {
    await seed("users/alice", { email: "alice@example.com" });

    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "users/alice")));
  });

  it("does not let a user write into somebody else's document", async () => {
    const db = testEnv.authenticatedContext("bob").firestore();
    await assertFails(setDoc(doc(db, "users/alice"), { admin: true }));
  });
});

describe("nodes", () => {
  it("lets anyone read a person", async () => {
    await seed("nodes/person-1", { type: "person", name: "Jan Kowalski" });

    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, "nodes/person-1")));
  });

  it("lets anyone read an article and a place", async () => {
    await seed("nodes/article-1", { type: "article" });
    await seed("nodes/place-1", { type: "place" });

    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, "nodes/article-1")));
    await assertSucceeds(getDoc(doc(db, "nodes/place-1")));
  });

  it("hides node types the rules do not name, such as regions", async () => {
    await seed("nodes/region-1", { type: "region", name: "Opole" });

    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "nodes/region-1")));
  });

  it("refuses direct node writes from a signed in user", async () => {
    // Nodes reach Firestore only through the server, which uses the admin SDK
    // and bypasses rules. Anything a user contributes goes via a revision.
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "nodes/person-2"), { type: "person" }));
  });

  it("refuses to let a signed in user rewrite an existing node", async () => {
    await seed("nodes/person-3", { type: "person", name: "Jan Kowalski" });

    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(
      setDoc(doc(db, "nodes/person-3"), { type: "person", name: "Not Jan" }),
    );
  });
});

describe("notes", () => {
  it("lets anyone read notes", async () => {
    await seed("notes/note-1", { userUid: "alice", body: "hello" });

    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, "notes/note-1")));
  });

  it("lets a user create a note under their own uid", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(
      setDoc(doc(db, "notes/note-2"), { userUid: "alice", body: "mine" }),
    );
  });

  it("does not let a user file a note under somebody else's uid", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(
      setDoc(doc(db, "notes/note-3"), { userUid: "bob", body: "not mine" }),
    );
  });

  it("does not let a signed out visitor create a note", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, "notes/note-4"), { userUid: "alice", body: "anon" }),
    );
  });

  it("lets a user edit and remove their own note", async () => {
    await seed("notes/note-5", { userUid: "alice", body: "first" });

    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(
      setDoc(doc(db, "notes/note-5"), { userUid: "alice", body: "second" }),
    );
    await assertSucceeds(deleteDoc(doc(db, "notes/note-5")));
  });

  it("does not let a user overwrite somebody else's note by claiming it", async () => {
    await seed("notes/note-6", { userUid: "bob", body: "bob's" });

    // Checking only the incoming payload would allow this: the write says it
    // belongs to alice, and alice is who is asking.
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(
      setDoc(doc(db, "notes/note-6"), { userUid: "alice", body: "hijacked" }),
    );
  });

  it("does not let a user remove somebody else's note", async () => {
    await seed("notes/note-7", { userUid: "bob", body: "bob's" });

    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(deleteDoc(doc(db, "notes/note-7")));
  });
});

describe("votes", () => {
  it("lets a user cast a vote whose id and payload are both theirs", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(
      setDoc(doc(db, "votes/node1_alice"), { userUid: "alice", value: 1 }),
    );
  });

  it("does not let a user cast a vote in somebody else's slot", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(
      setDoc(doc(db, "votes/node1_bob"), { userUid: "alice", value: 1 }),
    );
  });

  it("does not let a user attribute a vote to somebody else", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(
      setDoc(doc(db, "votes/node1_alice"), { userUid: "bob", value: 1 }),
    );
  });

  it("lets a user change and withdraw their own vote", async () => {
    await seed("votes/node1_alice", { userUid: "alice", value: 1 });

    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(
      setDoc(doc(db, "votes/node1_alice"), { userUid: "alice", value: -1 }),
    );
    await assertSucceeds(deleteDoc(doc(db, "votes/node1_alice")));
  });

  it("does not let a user delete somebody else's vote", async () => {
    await seed("votes/node1_bob", { userUid: "bob", value: 1 });

    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(deleteDoc(doc(db, "votes/node1_bob")));
  });
});

describe("revisions", () => {
  it("lets anyone read a revision", async () => {
    await seed("revisions/rev-1", { nodeId: "person-1" });

    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, "revisions/rev-1")));
  });

  it("lets a signed in user create a revision", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(
      setDoc(doc(db, "revisions/rev-2"), { nodeId: "person-1" }),
    );
  });

  it("does not let a signed out visitor create a revision", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, "revisions/rev-3"), { nodeId: "person-1" }),
    );
  });

  it("does not let anyone rewrite an existing revision", async () => {
    await seed("revisions/rev-4", { nodeId: "person-1" });

    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "revisions/rev-4"), { nodeId: "other" }));
  });
});

describe("extractions", () => {
  it("only opens to a token carrying the datascience claim", async () => {
    await seed("extractions/ex-1", { nodeId: "person-1" });

    const plain = testEnv.authenticatedContext("alice").firestore();
    await assertFails(getDoc(doc(plain, "extractions/ex-1")));

    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "extractions/ex-1")));

    const scientist = testEnv
      .authenticatedContext("dana", { datascience: true })
      .firestore();
    await assertSucceeds(getDoc(doc(scientist, "extractions/ex-1")));
  });

  it("is read only, whoever is asking", async () => {
    const scientist = testEnv
      .authenticatedContext("dana", { datascience: true })
      .firestore();
    await assertFails(
      setDoc(doc(scientist, "extractions/ex-2"), { nodeId: "person-1" }),
    );
  });
});

describe("the rules file", () => {
  it("guards every collection the app writes from the browser", async () => {
    // A new top-level collection with no `match` block is denied by default,
    // which is safe - but it is worth failing loudly here if someone adds a
    // collection and expects client writes to work.
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "somethingNew/doc-1"), { a: 1 }));
    expect(RULES).toContain("rules_version = '2'");
  });
});
