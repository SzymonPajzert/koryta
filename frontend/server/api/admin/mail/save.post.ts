import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody } from "h3";
import { z } from "zod";
import { requireOwner } from "~~/server/utils/auth";
import {
  campaignContentSchema,
  saveCampaign,
} from "~~/server/utils/mailCampaigns";
import { CAMPAIGN_ID_PATTERN } from "~~/shared/campaigns";

const bodySchema = z.object({
  /** Absent for a new campaign. */
  id: z.string().max(100).regex(CAMPAIGN_ID_PATTERN).optional(),
  content: campaignContentSchema,
});

/** Saves a campaign's text: a new draft, or an edit of an existing one. */
export default defineEventHandler(async (event) => {
  const user = await requireOwner(event);
  const input = await readValidatedBody(event, (body) =>
    bodySchema.parse(body),
  );
  return {
    campaign: await saveCampaign(getFirestore("koryta-pl"), {
      id: input.id,
      content: input.content,
      by: user.uid,
      now: new Date(),
    }),
  };
});
