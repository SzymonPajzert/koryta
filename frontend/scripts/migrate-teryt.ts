import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Setup for emulator - similar to seed-emulator.ts
const isProd = process.argv.includes("--prod");

if (!isProd) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  process.env.GCLOUD_PROJECT = "demo-koryta-pl";
}

const app = initializeApp({
  projectId: isProd ? "koryta-pl" : "demo-koryta-pl",
});

async function migrate() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "Production" : "Local Emulator"} Firestore...`,
  );

  const nodesSnapshot = await db.collection("nodes").get();
  console.log(`Found ${nodesSnapshot.docs.length} nodes to check.`);

  let batch = db.batch();
  let operationsCount = 0;
  let nodesMigrated = 0;

  for (const doc of nodesSnapshot.docs) {
    const data = doc.data();
    if (data.teryt && data.teryt !== null) {
      const expectedId = `teryt${data.teryt}`;

      if (doc.id !== expectedId) {
        console.log(
          `Node ${doc.id} (name: ${data.name}) has teryt=${data.teryt} but id is not ${expectedId}. Migrating...`,
        );
        nodesMigrated++;

        // 1. Create the new node
        const newNodeRef = db.collection("nodes").doc(expectedId);
        batch.set(newNodeRef, data);
        operationsCount++;

        // 2. Migrate edges where this node is the source
        const sourceEdgesSnapshot = await db
          .collection("edges")
          .where("source", "==", doc.id)
          .get();
        for (const edgeDoc of sourceEdgesSnapshot.docs) {
          batch.update(edgeDoc.ref, { source: expectedId });
          operationsCount++;
        }

        // 3. Migrate edges where this node is the target
        const targetEdgesSnapshot = await db
          .collection("edges")
          .where("target", "==", doc.id)
          .get();
        for (const edgeDoc of targetEdgesSnapshot.docs) {
          batch.update(edgeDoc.ref, { target: expectedId });
          operationsCount++;
        }

        // 4. Delete the old node
        batch.delete(doc.ref);
        operationsCount++;

        // Commit immediately for this node to ensure subsequent loop iterations read the updated edges
        console.log(
          `Committing batch for node ${doc.id} (${operationsCount} ops)...`,
        );
        await batch.commit();
        batch = db.batch(); // Reinitialize batch
        operationsCount = 0;
      }
    }
  }

  if (operationsCount > 0) {
    console.log(`Committing final batch of ${operationsCount} operations...`);
    await batch.commit();
  } else if (nodesMigrated === 0) {
    console.log("No nodes needed migration.");
  }

  console.log(`Migration complete! Migrated ${nodesMigrated} nodes.`);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
