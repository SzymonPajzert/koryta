import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getUser } from "~~/server/utils/auth";
import { defineEventHandler, readBody, createError } from "h3";
import type { Operation, Revision } from "~~/shared/model";

const operationSchema = z.object({
  op: z.enum(["add", "remove", "replace"]),
  field: z.string(),
  value: z.any(),
});

const bodySchema = z.object({
  operations: z.array(operationSchema),
});

export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (!user) {
    throw createError({ statusCode: 401, message: "Musisz być zalogowany." });
  }

  const nodeId = event.context.params?.id;
  if (!nodeId) {
    throw createError({ statusCode: 400, message: "Brak ID węzła." });
  }

  const body = await readBody(event);
  const { operations } = bodySchema.parse(body);

  if (operations.length === 0) {
    return { success: true, message: "Brak zmian do zapisu." };
  }

  const db = getFirestore("koryta-pl");
  const nodeRef = db.collection("nodes").doc(nodeId);
  
  const nodeSnap = await nodeRef.get();
  if (!nodeSnap.exists) {
    throw createError({ statusCode: 404, message: "Węzeł nie istnieje." });
  }

  const nodeData = nodeSnap.data() || {};
  const isTrusted = user.role === "moderator" || user.role === "admin";

  const batch = db.batch();

  // 1. Save Revision
  const revisionRef = db.collection("revisions").doc();
  const revision: Revision = {
    nodeId: nodeId,
    data: operations as Operation[],
    update_time: new Date().toISOString(),
    update_user: user.uid,
    update_automatic: isTrusted, // mark if it was auto-applied to draft
  };
  batch.set(revisionRef, revision);

  // 2. Synchronous Draft Promotion for Trusted Users
  if (isTrusted) {
    const draftUpdate: Record<string, any> = {};
    const currentDraft = nodeData.draft || {};
    
    let parties = currentDraft.parties !== undefined ? [...currentDraft.parties] : (nodeData.parties ? [...nodeData.parties] : []);
    let content = currentDraft.content !== undefined ? currentDraft.content : (nodeData.content || "");
    let draftChanged = false;

    for (const op of operations) {
      if (op.field === "parties") {
        if (op.op === "add" && !parties.includes(op.value)) {
          parties.push(op.value);
          draftChanged = true;
        } else if (op.op === "remove" && parties.includes(op.value)) {
          parties = parties.filter((p: string) => p !== op.value);
          draftChanged = true;
        }
      } else if (op.field === "content") {
        if (op.op === "replace") {
          content = op.value;
          draftChanged = true;
        }
      }
    }

    if (draftChanged) {
      draftUpdate["draft.parties"] = parties;
      draftUpdate["draft.content"] = content;
      // You could also increment pending_revisions_count here if you want an explicit badge
      draftUpdate["pending_revisions_count"] = FieldValue.increment(1);
      
      batch.update(nodeRef, draftUpdate);
    }
  }

  await batch.commit();

  return { success: true, isTrusted };
});
