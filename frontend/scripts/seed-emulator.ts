import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import waitOn from "wait-on";
import { readFileSync } from "fs";
import { resolve } from "path";

import { generateChunksLower } from "../shared/search";

import nodes from "./nodes.json";
import edges from "./edges.json";
import revisions from "./revisions.json";
import extractions from "./extractions.json";

const projectId =
  process.env.USE_PROD_PROJECT === "true" ? "koryta-pl" : "demo-koryta-pl";

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = projectId;

const app = initializeApp({
  projectId: projectId,
});

/**
 * Seed the emulators with the test data.
 * Always populates auth (but checks that it's test directory).
 * If --empty is passed, don't seed firestore.
 */
async function seed() {
  const empty = process.argv.includes("--empty");
  console.log("empty: ", empty);
  if (!empty) {
    await seedDatabase();
  }
  await seedAuth();
  await seedRules();
}

/** Gives a fixture the `published` flag it predates.
 *
 * `pageIsPublic` used to fall back to `!!revision_id` when the field was
 * absent, and the fixtures were written against that rule - which is why none
 * of them carries it. Once the fallback was removed (every real document
 * having been backfilled), the seeded site went blank for logged out readers:
 * an absent flag now means "draft", so nothing in it was public and the graph
 * rendered empty.
 *
 * The old rule is reproduced here rather than written into the JSON so the
 * fixtures keep saying one thing about a page - `revision_id` for "somebody
 * approved this" - and a fixture that wants to be a draft can still say
 * `published: false` outright.
 */
function defaultPublished(
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (data.published === undefined) {
    data.published = !!data.revision_id;
  }
  return data;
}

async function seedDatabase() {
  await waitOn({
    resources: ["tcp:127.0.0.1:8080"],
    timeout: undefined,
  });
  const db = getFirestore(app, "koryta-pl");

  console.log("Seeding database...");

  // Clear existing collections
  const collections = [
    "nodes",
    "edges",
    "revisions",
    "extractions",
    "feedback",
    // Verdicts on the QA changelog. Cleared with the rest so /qa opens on an
    // unchecked list, which is what its spec - and anybody looking at a fresh
    // local stack - expects to see.
    "qaChecks",
    // Cleared because the seed now writes some, and the admin specs write more
    // at run time under stamped ids. Left alone, re-seeding a live emulator
    // would leave every note any earlier run had made sitting on the page
    // under the fixtures below.
    "notes",
  ];
  for (const col of collections) {
    const docs = await db.collection(col).listDocuments();
    if (docs.length > 0) {
      const deleteBatch = db.batch();
      docs.forEach((doc) => deleteBatch.delete(doc));
      await deleteBatch.commit();
      console.log(`Cleared ${col}`);
    }
  }

  const batch = db.batch();

  for (const [id, node] of Object.entries(nodes)) {
    const nodeData = { ...node } as Record<string, unknown>;
    if (!nodeData.stats) nodeData.stats = {};
    const stats = nodeData.stats as Record<string, unknown>;
    // Only default to approved=true if not explicitly set in seed data
    if (stats.isApproved === undefined) {
      stats.isApproved = true;
    }
    // The search index is computed here rather than written into the fixture,
    // with the function the trigger in functions/src/nodes.ts uses. The fixture
    // used to carry it by hand and had drifted to a different scheme entirely,
    // which is why every spec that searched for a full name found nobody.
    if (typeof nodeData.name === "string") {
      nodeData.nameChunksLower = generateChunksLower(nodeData.name);
    }
    // JSON has no timestamp, and the collection stores one - the same
    // conversion the extractions below need. Without a date at all an article
    // is invisible to /zrodla, which sorts on this field: Firestore's orderBy
    // drops any document that does not carry it, so the table came up empty in
    // the emulator however many articles had been seeded.
    if (typeof nodeData.publishedDate === "string") {
      nodeData.publishedDate = new Date(nodeData.publishedDate);
    }
    defaultPublished(nodeData);
    const ref = db.collection("nodes").doc(id);
    batch.set(ref, nodeData);
  }

  for (const edge of edges) {
    const edgeData = defaultPublished({ ...edge } as Record<string, unknown>);
    const ref = db.collection("edges").doc();
    batch.set(ref, edgeData);
  }

  for (const [id, rev] of Object.entries(revisions)) {
    const ref = db.collection("revisions").doc(id);
    batch.set(ref, rev);
  }

  // Notes on Jan Kowalski (1), one of each kind, so the notes section has
  // something in it to look at.
  //
  // Written by somebody else - `seed-notes-author`, an id no seeded account
  // holds - which is what puts them in `otherSources` rather than in the
  // reader's own note. A signed in reader therefore sees the whole section at
  // once: other people's entries, the prompt inviting theirs, and the three
  // buttons that add one. Owned by the reader it would be their note in edit
  // mode instead, and the prompt would be gone.
  //
  // Only this person. Orlen (2) is deliberately left without any, because the
  // empty section is a state worth a picture of its own and that is the page
  // that takes it.
  const seededNotes = {
    "1_seed-notes-author": {
      nodeId: "1",
      userUid: "seed-notes-author",
      createdAt: "2026-05-04T09:15:00.000Z",
      sources: [
        {
          kind: "source",
          url: "https://example.org/kowalski-rada-nadzorcza",
          note: "Wzmianka o powołaniu do rady nadzorczej - notatka prasowa z maja.",
        },
        {
          kind: "change_request",
          note: "Data końca zatrudnienia w Orlenie wygląda na przesuniętą o rok.",
        },
        {
          kind: "missing",
          note: "Brakuje kadencji w radzie miasta sprzed 2019 roku.",
        },
      ],
    },
  };
  for (const [id, note] of Object.entries(seededNotes)) {
    const ref = db.collection("notes").doc(id);
    batch.set(ref, note);
  }

  for (const [id, fact] of Object.entries(extractions)) {
    const ref = db.collection("extractions").doc(id);
    // The fixture carries an ISO string because JSON has no timestamp; the
    // collection stores a Timestamp, which is what /api/extractions orders by.
    batch.set(ref, { ...fact, createdAt: new Date(fact.createdAt) });
  }

  await batch.commit();
  console.log("Database seeded successfully!");

  console.log((await db.collection("nodes").get()).docs.length, "nodes");
  console.log((await db.collection("edges").get()).docs.length, "edges");
  console.log(
    (await db.collection("revisions").get()).docs.length,
    "revisions",
  );
  console.log(
    (await db.collection("extractions").get()).docs.length,
    "extractions",
  );
}

async function seedAuth() {
  await waitOn({
    resources: ["tcp:127.0.0.1:9099"],
    timeout: undefined,
  });
  const auth = getAuth(app);

  if (auth.app.options.projectId !== projectId) {
    throw "this is not a test environment";
  }

  try {
    for (const user of [
      {
        uid: "test-admin",
        email: "admin@koryta.pl",
        password: "password123",
        displayName: "Admin User",
      },
      {
        uid: "test-user",
        email: "user@koryta.pl",
        password: "password123",
        displayName: "Normal User",
      },
    ]) {
      await auth.createUser(user);
      if (user.uid === "test-admin") {
        // datascience: allows uploading extractions via /api/ingest/extraction
        await auth.setCustomUserClaims(user.uid, {
          admin: true,
          datascience: true,
        });
        console.log(`Set admin + datascience claim for ${user.email}`);
      }
      console.log(`User created: ${user.email} / ${user.password}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (
      error.code === "auth/email-already-exists" ||
      error.code === "auth/uid-already-exists"
    ) {
      console.log("User already exists", error);
    } else {
      throw error;
    }
  }
}

async function seedRules() {
  const rulesPath = resolve(process.cwd(), "../firestore.rules");
  const rulesContent = readFileSync(rulesPath, "utf8");

  const rulesUrl = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}:securityRules`;

  const response = await fetch(rulesUrl, {
    method: "PUT",
    body: JSON.stringify({
      rules: {
        files: [
          {
            name: "security.rules",
            content: rulesContent,
          },
        ],
      },
    }),
  });

  if (response.ok) {
    console.log("Firestore rules updated.");
  } else {
    console.error("Failed to update firestore rules", await response.text());
  }
}

seed().catch((err) => {
  console.error("Error seeding database:", err);
  process.exit(1);
});
