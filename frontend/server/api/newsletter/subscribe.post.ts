import { getFirestore } from "firebase-admin/firestore";
import { createError, defineEventHandler, readValidatedBody } from "h3";
import { z } from "zod";
import { requestSubscription } from "~~/server/utils/newsletterSubscribers";
import {
  EMAIL_MAX,
  looksLikeEmail,
  newsletterSignupPlaces,
  normaliseEmail,
} from "~~/shared/newsletterSignup";

const bodySchema = z.object({
  email: z.string().max(EMAIL_MAX + 20),
  where: z.enum(newsletterSignupPlaces),
  // Hidden in the form, so only a bot filling every input reaches this.
  website: z.string().max(200).optional(),
});

/** Signs an address up for the newsletter, from the form for readers without
 * an account. Open to anybody, which is why it only ever sends the one
 * confirmation mail (see server/utils/newsletterSubscribers.ts), and why it
 * answers the same way whatever became of the address.
 *
 * Closed until site mail is delivered: the Trigger Email extension sends only
 * what is written after it is installed, so a confirmation written before
 * would never arrive. */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  if (!config.public.newsletterSignupOpen) {
    throw createError({
      statusCode: 503,
      message: "Zapisy na newsletter jeszcze nie ruszyły.",
    });
  }

  const body = await readValidatedBody(event, (raw) => bodySchema.parse(raw));
  // A filled honeypot is a bot. Answered as if it worked, so it learns nothing.
  if (body.website) return { ok: true };

  const email = normaliseEmail(body.email);
  if (!looksLikeEmail(email)) {
    throw createError({
      statusCode: 400,
      message: "To nie wygląda na adres e-mail. Sprawdź, czy nie ma literówki.",
    });
  }

  const outcome = await requestSubscription(getFirestore("koryta-pl"), {
    email,
    where: body.where,
    siteUrl: config.public.siteUrl,
    now: new Date(),
  });
  // The outcome stays in the log: the reader is told the same thing either way.
  console.info(`newsletter/subscribe: ${outcome} (${body.where})`);
  return { ok: true };
});
