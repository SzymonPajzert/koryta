import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody } from "h3";
import { z } from "zod";
import { confirmSubscription } from "~~/server/utils/newsletterSubscribers";

const bodySchema = z.object({
  s: z.string().min(1).max(64),
  t: z.string().min(1).max(200),
});

/** Confirms an address, from the page its confirmation mail links to. A POST
 * the page sends when the reader presses the button, never the opening of the
 * link itself - see `confirmationUrl`. The token is the whole of the
 * authorisation, as the reader is usually not signed in. */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (raw) => bodySchema.parse(raw));
  const outcome = await confirmSubscription(getFirestore("koryta-pl"), {
    id: body.s,
    token: body.t,
    now: new Date(),
  });
  return { outcome };
});
