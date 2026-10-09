import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { z } from "zod";
import { requireOwner } from "~~/server/utils/auth";
import { campaignDeliveries } from "~~/server/utils/mailCampaigns";
import { CAMPAIGN_ID_PATTERN } from "~~/shared/campaigns";

const querySchema = z.object({
  id: z.string().max(100).regex(CAMPAIGN_ID_PATTERN),
});

/** How far the mail extension has got with each message of one campaign. */
export default defineEventHandler(async (event) => {
  await requireOwner(event);
  const { id } = await getValidatedQuery(event, (query) =>
    querySchema.parse(query),
  );
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return {
    deliveries: await campaignDeliveries(getFirestore("koryta-pl"), id),
  };
});
