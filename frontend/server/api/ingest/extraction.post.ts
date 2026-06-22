import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { z } from "zod";

const extractionRequestSchema = z.object({
  url: z.string(),
  agentID: z.string(),
  entities: z.array(z.record(z.any())),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    extractionRequestSchema.parse(body),
  );

  // Checks that the user is logged in
  const user = await getUser(event);

  if (user.datascience !== true) {
    throw createError({
      statusCode: 403,
      statusMessage: "Forbidden",
      message: "You need to be a member of the datascience group",
    });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const extractionRef = db.collection("extractions").doc();

  const extractionData = {
    url: body.url,
    agentID: body.agentID,
    entities: body.entities,
    createdAt: Timestamp.now(),
    uploaderUid: user.uid,
  };

  await extractionRef.set(extractionData);

  return {
    id: extractionRef.id,
    status: "ok",
  };
});
