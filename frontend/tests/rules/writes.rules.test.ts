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

describe("votes", () => {
  /** What `castVote`, `castVoteOnce` and `saveCommentOnce` in
   * app/composables/votes.ts write: always a merge. */
  const vote = (db: Firestore, id: string, data: Record<string, unknown>) =>
    setDoc(doc(db, "votes", id), data, { merge: true });

  const onPerson = (categoryVotes: Record<string, unknown>) => ({
    nodeId: "person",
    userUid: "reader",
    categoryVotes,
    updatedAt: "2026-10-15T10:00:00.000Z",
  });

  beforeEach(async () => {
    await seed("votes/person_alice", {
      nodeId: "person",
      userUid: "alice",
      categoryVotes: { interesting: 2 },
    });
  });

  it("lets a reader vote, change their mind and comment, on one document", async () => {
    await vote(reader, "person_reader", onPerson({ interesting: 1 }));
    await vote(reader, "person_reader", onPerson({ interesting: 5 }));
    await vote(reader, "person_reader", onPerson({ quality: -5 }));
    await vote(reader, "person_reader", {
      ...onPerson({}),
      comment: "Zarząd od 2016",
    });
  });

  it("lets a reader vote on an extraction", async () => {
    await vote(reader, "fact-1_reader", {
      extractionId: "fact-1",
      userUid: "reader",
      categoryVotes: { correct: -1 },
    });
  });

  it("does not let a reader vote twice on a page under other ids", async () => {
    // The hole: the old rule pinned only the end of the id, and each of these
    // documents counted as one more vote on the page.
    await expect(
      vote(reader, "a_reader", onPerson({ interesting: 5 })),
    ).rejects.toMatchObject(denied);
    await expect(
      vote(reader, "anything_reader", {
        ...onPerson({ interesting: 5 }),
        extractionId: "anything",
      }),
    ).rejects.toMatchObject(denied);
  });

  it("does not let one vote name two targets", async () => {
    await expect(
      vote(reader, "person_reader", {
        ...onPerson({ interesting: 1 }),
        extractionId: "fact-1",
      }),
    ).rejects.toMatchObject(denied);
  });

  it("does not let a reader vote in somebody else's name", async () => {
    await expect(
      vote(reader, "person_alice", {
        ...onPerson({ interesting: -5 }),
        userUid: "alice",
      }),
    ).rejects.toMatchObject(denied);
    await expect(
      vote(reader, "person_reader", {
        ...onPerson({ interesting: 1 }),
        userUid: "alice",
      }),
    ).rejects.toMatchObject(denied);
    await expect(
      vote(reader, "person_alice", onPerson({ interesting: -5 })),
    ).rejects.toMatchObject(denied);
  });

  it("keeps every value within -5..5", async () => {
    for (const value of [6, -6, 1_000_000, 2.5, "5", true, null]) {
      await expect(
        vote(reader, "person_reader", onPerson({ interesting: value })),
        `interesting: ${JSON.stringify(value)}`,
      ).rejects.toMatchObject(denied);
    }
    await vote(reader, "person_reader", onPerson({ interesting: -5 }));
    await vote(reader, "person_reader", onPerson({ quality: 5 }));
  });

  it("takes at most 40 categories on a vote", async () => {
    const categories = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`category${index}`, 1]),
      );

    await vote(reader, "person_reader", onPerson(categories(40)));
    await expect(
      vote(reader, "person_reader", onPerson({ oneMore: 1 })),
    ).rejects.toMatchObject(denied);
  });

  it("does not take a vote without its map of categories", async () => {
    // The aggregation reads `categoryVotes` on every vote of the page, and a
    // vote without it would make every later recount throw.
    await expect(
      vote(reader, "person_reader", { nodeId: "person", userUid: "reader" }),
    ).rejects.toMatchObject(denied);
    await expect(
      vote(reader, "person_reader", {
        nodeId: "person",
        userUid: "reader",
        categoryVotes: [1, 1, 1],
      }),
    ).rejects.toMatchObject(denied);
  });

  it("lets a vote in its category replace a value out of range, and only that", async () => {
    // Four such votes were on production on 2026-10-15, from before the UI
    // clamped. The rule judges the document after the merge, so the stale
    // value has to go before its owner can vote in another category.
    await seed("votes/person_reader", {
      nodeId: "person",
      userUid: "reader",
      categoryVotes: { interesting: 18 },
    });

    await expect(
      vote(reader, "person_reader", onPerson({ quality: 1 })),
    ).rejects.toMatchObject(denied);
    await vote(reader, "person_reader", onPerson({ interesting: 5 }));
    await vote(reader, "person_reader", onPerson({ quality: 1 }));
  });

  it("lets a reader remove their own vote, and only their own", async () => {
    await seed("votes/person_reader", onPerson({ interesting: 18 }));

    await deleteDoc(doc(reader, "votes/person_reader"));
    await expect(
      deleteDoc(doc(reader, "votes/person_alice")),
    ).rejects.toMatchObject(denied);
  });

  it("lets the datascience group write a model's scores, on any scale", async () => {
    // What `koryta_uploader --type score` writes, under the model's uid.
    const scientist = firestoreAs({
      uid: "scientist",
      claims: { datascience: true },
    });
    const score = {
      nodeId: "person",
      userUid: "pipeline-pagerank",
      categoryVotes: { interesting: 37 },
    };

    await vote(scientist, "person_pipeline-pagerank", score);
    await deleteDoc(doc(scientist, "votes/person_pipeline-pagerank"));
    await expect(
      vote(reader, "person_pipeline-pagerank", score),
    ).rejects.toMatchObject(denied);
  });

  it("does not let anybody signed out vote", async () => {
    await expect(
      vote(anonymous, "person_reader", onPerson({ interesting: 1 })),
    ).rejects.toMatchObject(denied);
  });
});

describe("nodes", () => {
  it("are written by nobody through the client", async () => {
    // Every page reaches Firestore through the server; a reader's change is a
    // revision, filed through /api.
    await expect(
      setDoc(doc(reader, "nodes/new"), { type: "person", name: "Jan Nowy" }),
    ).rejects.toMatchObject(denied);
    await expect(
      updateDoc(doc(reader, "nodes/person"), { name: "Ktoś inny" }),
    ).rejects.toMatchObject(denied);
    await expect(deleteDoc(doc(reader, "nodes/person"))).rejects.toMatchObject(
      denied,
    );
    await expect(
      setDoc(doc(anonymous, "nodes/new"), { type: "person" }),
    ).rejects.toMatchObject(denied);
  });
});

describe("users", () => {
  it("lets a reader read and write their own profile, and only their own", async () => {
    await seed("users/alice", { displayName: "Alice" });

    // What profil.vue writes.
    await setDoc(
      doc(reader, "users/reader"),
      { displayName: "Czytelnik" },
      { merge: true },
    );
    await getDoc(doc(reader, "users/reader"));
    await expect(getDoc(doc(reader, "users/alice"))).rejects.toMatchObject(
      denied,
    );
    await expect(
      setDoc(doc(reader, "users/alice"), { displayName: "Czytelnik" }),
    ).rejects.toMatchObject(denied);
  });

  it("are no business of anybody signed out", async () => {
    await seed("users/reader", { displayName: "Czytelnik" });

    await expect(getDoc(doc(anonymous, "users/reader"))).rejects.toMatchObject(
      denied,
    );
    await expect(
      setDoc(doc(anonymous, "users/reader"), { displayName: "Ktoś" }),
    ).rejects.toMatchObject(denied);
  });
});
