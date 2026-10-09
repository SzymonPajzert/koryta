import { getFirestore } from "firebase-admin/firestore";
import { createError, defineEventHandler, readValidatedBody } from "h3";
import { z } from "zod";
import { requireOwner } from "~~/server/utils/auth";
import { loadAudience, queueToCheck } from "~~/server/utils/mailAudience";
import { getCampaign, queueTest } from "~~/server/utils/mailCampaigns";
import { CAMPAIGN_ID_PATTERN } from "~~/shared/campaigns";

const bodySchema = z.object({
  id: z.string().max(100).regex(CAMPAIGN_ID_PATTERN),
});

/** Sends the campaign to the owner alone, as they would get it, marked as a
 * test. The audience is read in full so the numbers in it are their real ones. */
export default defineEventHandler(async (event) => {
  const user = await requireOwner(event);
  const { id } = await readValidatedBody(event, (body) =>
    bodySchema.parse(body),
  );
  const db = getFirestore("koryta-pl");

  const campaign = await getCampaign(db, id);
  if (!campaign) {
    throw createError({ statusCode: 404, message: "Nie ma takiej kampanii." });
  }
  const audience = await loadAudience(db, { toCheck: await queueToCheck() });
  const member = audience.members.find((m) => m.uid === user.uid);
  if (!member) {
    throw createError({
      statusCode: 404,
      message: "Nie znaleziono Twojego konta.",
    });
  }

  return await queueTest(db, {
    campaign,
    member,
    community: audience.community,
    siteUrl: useRuntimeConfig(event).public.siteUrl,
    now: new Date(),
  });
});
