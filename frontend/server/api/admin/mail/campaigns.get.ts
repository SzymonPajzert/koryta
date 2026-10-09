import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, setResponseHeader } from "h3";
import { requireOwner } from "~~/server/utils/auth";
import { listCampaigns } from "~~/server/utils/mailCampaigns";

/** The owner's campaigns, newest first. */
export default defineEventHandler(async (event) => {
  await requireOwner(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return { campaigns: await listCampaigns(getFirestore("koryta-pl")) };
});
