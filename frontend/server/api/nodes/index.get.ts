import { getFirestore } from "firebase-admin/firestore";

export default defineEventHandler(async () => {
  const db = getFirestore("koryta-pl");

  const list = await db.collection("nodes").where("type", "!=", "record").get();
  const nodes = Object.fromEntries(
    list.docs.map((doc) => [doc.id, doc.data()]),
  );
  return { nodes };
});
