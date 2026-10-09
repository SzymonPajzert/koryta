import { getFirestore } from "firebase-admin/firestore";
import { createError, defineEventHandler, getQuery, readBody } from "h3";
import { z } from "zod";
import { unsubscribe } from "~~/server/utils/mailTokens";
import { campaignTopics } from "~~/shared/campaigns";

const paramsSchema = z.object({
  u: z.string().min(1).max(128),
  t: z.string().min(1).max(200),
  k: z.enum(campaignTopics),
  c: z.string().max(100).optional(),
});

/** Takes a reader off a topic, from the link in a campaign's footer.
 *
 * Open to anybody: the token in the link is the whole of the authorisation, as
 * a reader clicking it is usually not signed in. Two callers post here. The
 * /wypisz page sends the link's parameters as JSON, after the reader confirms.
 * A mail client's one-click button (RFC 8058) posts the form
 * `List-Unsubscribe=One-Click` to the URL in the `List-Unsubscribe` header,
 * so its parameters are in the query string.
 */
export default defineEventHandler(async (event) => {
  let body: unknown = null;
  try {
    body = await readBody(event);
  } catch {
    // An empty or unparseable body leaves the query to speak for itself.
  }
  const query: Record<string, unknown> = getQuery(event);
  const fields: Record<string, unknown> =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const parsed = paramsSchema.safeParse({ ...query, ...fields });
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message:
        "Link do wypisania jest niepełny. Skopiuj go z wiadomości w całości.",
    });
  }

  const { u, t, k, c } = parsed.data;
  const outcome = await unsubscribe(getFirestore("koryta-pl"), {
    uid: u,
    token: t,
    topic: k,
    campaignId: c,
  });
  if (outcome === "invalid") {
    throw createError({
      statusCode: 403,
      message:
        "Ten link do wypisania jest nieprawidłowy. Zaloguj się i zmień ustawienia wiadomości w profilu.",
    });
  }
  return { outcome, topic: k };
});
