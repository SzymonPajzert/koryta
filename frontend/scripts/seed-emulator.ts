import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import waitOn from "wait-on";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  initializeTestEnvironment
} from "@firebase/rules-unit-testing"

import nodes from "./nodes.json";
import edges from "./edges.json";
import revisions from "./revisions.json";

process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "demo-koryta-pl";

const app = initializeApp({
  projectId: "demo-koryta-pl",
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

async function seedDatabase() {
  await waitOn({
    resources: ["tcp:localhost:8080"],
    timeout: undefined,
  });
  const db = getFirestore(app, "koryta-pl");

  console.log("Seeding database...");

  const batch = db.batch();

  for (const [id, node] of Object.entries(nodes)) {
    const ref = db.collection("nodes").doc(id);
    batch.set(ref, node);
  }

  for (const edge of edges) {
    const ref = db.collection("edges").doc();
    batch.set(ref, edge);
  }

  for (const [id, rev] of Object.entries(revisions)) {
    const ref = db.collection("revisions").doc(id);
    batch.set(ref, rev);
  }

  await batch.commit();
  console.log("Database seeded successfully!");

  console.log((await db.collection("nodes").get()).docs.length, "nodes");
  console.log((await db.collection("edges").get()).docs.length, "edges");
  console.log(
    (await db.collection("revisions").get()).docs.length,
    "revisions",
  );
}

async function seedAuth() {
  await waitOn({
    resources: ["tcp:localhost:9099"],
    timeout: undefined,
  });
  const auth = getAuth(app);

  if (auth.app.options.projectId !== "demo-koryta-pl") {
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
  const projectId = "demo-koryta-pl";

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
