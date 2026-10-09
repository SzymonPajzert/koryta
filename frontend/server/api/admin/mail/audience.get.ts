import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, setResponseHeader } from "h3";
import { requireOwner } from "~~/server/utils/auth";
import { loadAudience, queueToCheck } from "~~/server/utils/mailAudience";

/** Every account, with whether a campaign may reach it and how recently it
 * was around - for the owner's /admin/mailing. It carries addresses, so it is
 * the owner's alone and never cached anywhere on the way. */
export default defineEventHandler(async (event) => {
  await requireOwner(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return await loadAudience(getFirestore("koryta-pl"), {
    toCheck: await queueToCheck(),
  });
});
