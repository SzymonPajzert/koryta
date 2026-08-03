import { Timestamp } from "firebase-admin/firestore";
import { getUser } from "~~/server/utils/auth";
import {
  baseNodeFields,
  sanitizeFirestoreData,
} from "~~/server/utils/revisions";
import { companyEditSchema, personEditSchema } from "~~/shared/api";
import { adminFirestore } from "~~/server/utils/firebase";

export default defineEventHandler(async (event) => {
  const rawBody = await readBody(event);
  const node_id =
    typeof rawBody.node_id === "string" ? rawBody.node_id : undefined;

  // Without a node_id the user proposes a brand new node instead of a change
  // to an existing one.
  const isNewNode = !node_id;

  const user = await getUser(event);

  const db = adminFirestore();
  const nodeRef = isNewNode
    ? db.collection("nodes").doc()
    : db.collection("nodes").doc(node_id);
  const revisionRef = db.collection("revisions").doc();
  const timestamp = Timestamp.now();

  // Fetch the existing node to use as a base layer so that the revision
  // contains a complete snapshot (type, wikipedia, rejestrIo, etc.). A brand
  // new node has no prior data, so it just starts out as a person.
  const baseFields: Record<string, unknown> = isNewNode
    ? { type: "person" }
    : await baseNodeFields(nodeRef);

  // Which fields are on offer depends on what is being edited: a place takes a
  // KRS number and an ownership answer, a person a party and its source links.
  // Parsing against the schema also strips anything not explicitly allowed, so
  // a caller can't smuggle in e.g. `revision_id` and have it written straight
  // to the node below.
  const schema =
    baseFields.type === "place" ? companyEditSchema : personEditSchema;
  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: parsed.error.issues[0]?.message || "Invalid request body",
      data: parsed.error.issues,
    });
  }
  const dataFields: Record<string, unknown> = { ...parsed.data };

  // A person answering the ownership question outranks the scrapers, which
  // cannot see it for a spółka akcyjna and have nothing to read for an
  // institution outside KRS. The marker is what `ingest/company` checks before
  // writing its own guess over this one.
  if (dataFields.isPublic !== undefined) {
    dataFields.isPublicSource = "manual";
  }

  // User-submitted fields override the base node fields
  const mergedData = { ...baseFields, ...dataFields };

  const revision = {
    node_id: nodeRef.id,
    data: sanitizeFirestoreData(mergedData),
    update_time: timestamp,
    update_user: user.uid,
    update_automatic: false,
    status: "pending",
  };

  const batch = db.batch();
  batch.set(revisionRef, revision);
  if (isNewNode) {
    // Create the node itself so the proposal gets an id and can be linked to,
    // voted on and edited further. It is written without a `revision_id`, which
    // keeps it unapproved and therefore hidden from logged out users.
    batch.set(nodeRef, revision.data as Record<string, unknown>);
  }
  await batch.commit();

  return { id: revisionRef.id, node_id: nodeRef.id };
});
