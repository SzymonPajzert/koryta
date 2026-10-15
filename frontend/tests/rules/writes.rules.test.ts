import {
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  setDoc,
  updateDoc,
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

/** What firestore.rules lets a browser write.
 *
 * A reader writes notes and votes straight from the browser rather than
 * through /api, so these rules are all that stands between one account and
 * everybody else's contributions. Each test writes the way the app does - the
 * same document ids, the same `merge: true` - so a rule that is too tight
 * fails here before it fails for a reader.
 *
 *   devns npm run test:rules
 */
let anonymous: Firestore;
let reader: Firestore;

beforeAll(async () => {
  await loadRules();
  anonymous = firestoreAs("anonymous");
  reader = firestoreAs({ uid: "reader" });
});

afterAll(closeApps);

beforeEach(async () => {
  await clearDatabase();
  await seed("nodes/person", {
    type: "person",
    name: "Anna Nowak",
    published: true,
  });
});

describe("notes", () => {
  /** What `saveNote` in app/composables/notes.ts writes. */
  const saveNote = (db: Firestore, id: string, note: Record<string, unknown>) =>
    setDoc(doc(db, "notes", id), note, { merge: true });

  beforeEach(async () => {
    await seed("notes/person_alice", {
      nodeId: "person",
      userUid: "alice",
      sources: [{ url: "https://example.com", text: "Zarząd spółki" }],
    });
  });

  it("lets a reader write their note on a page, and come back to it", async () => {
    await saveNote(reader, "person_reader", {
      nodeId: "person",
      userUid: "reader",
      sources: [{ url: "https://example.com/a", text: "Pierwsza wersja" }],
    });
    await saveNote(reader, "person_reader", {
      nodeId: "person",
      userUid: "reader",
      sources: [{ url: "https://example.com/b", text: "Druga wersja" }],
    });

    const stored = await getDoc(doc(reader, "notes/person_reader"));
    expect(stored.data()?.sources).toEqual([
      { url: "https://example.com/b", text: "Druga wersja" },
    ]);
  });

  it("lets the author update the sources alone, as attachArticleIds does", async () => {
    await seed("notes/person_reader", {
      nodeId: "person",
      userUid: "reader",
      sources: [{ url: "https://example.com/a" }],
    });

    await runTransaction(reader, async (transaction) => {
      const ref = doc(reader, "notes/person_reader");
      await transaction.get(ref);
      transaction.update(ref, {
        sources: [{ url: "https://example.com/a", articleId: "article-1" }],
      });
    });
  });

  it("does not let a reader overwrite somebody else's note", async () => {
    // The hole: the old rule looked only at the incoming document, and this
    // one says it is the reader's.
    await expect(
      saveNote(reader, "person_alice", {
        nodeId: "person",
        userUid: "reader",
        sources: [],
      }),
    ).rejects.toMatchObject(denied);
    await expect(
      updateDoc(doc(reader, "notes/person_alice"), { sources: [] }),
    ).rejects.toMatchObject(denied);

    const stored = await getDoc(doc(reader, "notes/person_alice"));
    expect(stored.data()?.userUid).toBe("alice");
  });

  it("does not let a reader write a note in somebody else's name", async () => {
    await expect(
      saveNote(reader, "person_reader", {
        nodeId: "person",
        userUid: "alice",
        sources: [],
      }),
    ).rejects.toMatchObject(denied);
  });

  it("does not let a reader take another person's place on a page", async () => {
    // Filed under the reader's own uid, but where bob's note would go: with
    // owner-only updates, bob could never write his own note there again.
    await expect(
      saveNote(reader, "person_bob", {
        nodeId: "person",
        userUid: "reader",
        sources: [],
      }),
    ).rejects.toMatchObject(denied);
  });

  it("keeps one note per reader on a page", async () => {
    await expect(
      saveNote(reader, "second_reader", {
        nodeId: "person",
        userUid: "reader",
        sources: [],
      }),
    ).rejects.toMatchObject(denied);
    await expect(
      saveNote(reader, "person_reader", { userUid: "reader", sources: [] }),
    ).rejects.toMatchObject(denied);
  });

  it("does not let the author move their note to another page", async () => {
    await seed("notes/person_reader", {
      nodeId: "person",
      userUid: "reader",
      sources: [],
    });

    await expect(
      updateDoc(doc(reader, "notes/person_reader"), { nodeId: "company" }),
    ).rejects.toMatchObject(denied);
  });

  it("lets a reader remove their own note, and only their own", async () => {
    await seed("notes/person_reader", {
      nodeId: "person",
      userUid: "reader",
      sources: [],
    });

    await deleteDoc(doc(reader, "notes/person_reader"));
    await expect(
      deleteDoc(doc(reader, "notes/person_alice")),
    ).rejects.toMatchObject(denied);
  });

  it("does not let anybody signed out write a note", async () => {
    await expect(
      saveNote(anonymous, "person_reader", {
        nodeId: "person",
        userUid: "reader",
        sources: [],
      }),
    ).rejects.toMatchObject(denied);
  });
});
