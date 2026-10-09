import { getFirestore } from "firebase-admin/firestore";
import { createError, defineEventHandler, readValidatedBody } from "h3";
import { z } from "zod";
import { requireOwner } from "~~/server/utils/auth";
import { loadAudience, queueToCheck } from "~~/server/utils/mailAudience";
import { getCampaign, queueCampaign } from "~~/server/utils/mailCampaigns";
import { CAMPAIGN_ID_PATTERN } from "~~/shared/campaigns";

const bodySchema = z.object({
  id: z.string().max(100).regex(CAMPAIGN_ID_PATTERN),
  /** Who the owner ticked. Each is checked again here before anything is
   * queued; see `queueCampaign`. */
  uids: z.array(z.string().min(1).max(128)).min(1).max(5000),
});

/** Sends a campaign to the people the owner picked, once each. */
export default defineEventHandler(async (event) => {
  const user = await requireOwner(event);
  const input = await readValidatedBody(event, (body) =>
    bodySchema.parse(body),
  );
  const db = getFirestore("koryta-pl");

  const campaign = await getCampaign(db, input.id);
  if (!campaign) {
    throw createError({ statusCode: 404, message: "Nie ma takiej kampanii." });
  }
  const audience = await loadAudience(db, { toCheck: await queueToCheck() });

  return await queueCampaign(db, {
    campaign,
    members: audience.members,
    community: audience.community,
    uids: input.uids,
    by: user.uid,
    siteUrl: useRuntimeConfig(event).public.siteUrl,
    now: new Date(),
  });
});
