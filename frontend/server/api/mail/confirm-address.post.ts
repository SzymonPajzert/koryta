import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createError, defineEventHandler } from "h3";
import { getUser } from "~~/server/utils/auth";
import { queueAddressConfirmation } from "~~/server/utils/confirmAddress";

/** Mails the signed-in reader the link that confirms their address, through
 * the site's own mail (shared/confirmAddress.ts).
 *
 * The account is read from the auth service rather than the token, which can
 * still say "unconfirmed" for a while after the link was clicked. */
export default defineEventHandler(async (event) => {
  const { uid } = await getUser(event);
  const account = await getAuth().getUser(uid);
  const outcome = await queueAddressConfirmation(
    getFirestore("koryta-pl"),
    {
      uid,
      email: account.email ?? null,
      emailVerified: account.emailVerified,
    },
    { siteUrl: useRuntimeConfig(event).public.siteUrl, now: new Date() },
  );
  console.info(`mail/confirm-address: ${outcome} uid=${uid}`);

  if (outcome === "noAddress") {
    throw createError({
      statusCode: 400,
      message: "To konto nie ma adresu e-mail.",
    });
  }
  if (outcome === "tooSoon" || outcome === "dailyLimit") {
    throw createError({
      statusCode: 429,
      message:
        "Link już wysłaliśmy. Sprawdź skrzynkę, także folder ze spamem, albo spróbuj później.",
    });
  }
  return { outcome };
});
