import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { recordUserAction } from "~~/server/utils/userActions";
import {
  describeOwnRequest,
  holdsTeamTools,
} from "~~/server/utils/accessRequests";
import { isAutomatedUid } from "~~/shared/stats";
import {
  ACCESS_REQUEST_COOLDOWN_DAYS,
  accessRequestBodySchema,
  userCollections,
  type AccessRequestDoc,
  type OwnAccessRequest,
} from "~~/shared/userAdmin";

/** Asks the administrators for the team's tools - the `datascience` level.
 *
 * This replaces "O dostęp poproś mailem albo na Slacku", which reached
 * whoever happened to read the mail, left no trace on the account, and asked
 * the owner to match an address in a message to an account by hand. The
 * request lands on /admin/uzytkownicy under „Prośby o dostęp”, next to the
 * account it is about, and an administrator answers it there by nominating the
 * account or dismissing the request. Nothing here grants anything: the
 * nomination still goes through the owner's y/N in the claims script.
 *
 * One standing request per account, keyed by uid. While it is open a second
 * one is refused, and after an answer the next may come only after
 * `ACCESS_REQUEST_COOLDOWN_DAYS` - so the queue holds at most one line per
 * person, and a "no" is not something to click past.
 *
 * The check and the write are one transaction rather than a read followed by
 * a batch: two clicks in flight would otherwise both find no open request and
 * file two lines in the account's history for one request.
 */
export default defineEventHandler(async (event): Promise<OwnAccessRequest> => {
  const user = await getUser(event);
  // Pipeline and migration accounts write under the site's own name. They do
  // not sign in to a browser, and a request from one would be a bug wearing a
  // person's form.
  if (isAutomatedUid(user.uid)) {
    throw createError({
      statusCode: 403,
      message: "Konta automatyczne nie proszą o dostęp.",
    });
  }
  const body = await readValidatedBody(event, (raw) =>
    accessRequestBodySchema.parse(raw),
  );
  setResponseHeader(event, "Cache-Control", "private, no-store");

  if (await holdsTeamTools(user)) {
    throw createError({
      statusCode: 409,
      message: "Masz już dostęp do narzędzi zespołu.",
    });
  }

  const db = getFirestore("koryta-pl");
  const ref = db.collection(userCollections.accessRequests).doc(user.uid);

  return await db.runTransaction(async (tx) => {
    const now = new Date();
    const existing = (await tx.get(ref)).data() as AccessRequestDoc | undefined;

    if (existing?.status === "open") {
      throw createError({
        statusCode: 409,
        message: "Twoja prośba o dostęp już czeka na administratorów.",
      });
    }
    const before = describeOwnRequest(existing, { hasAccess: false, now });
    if (before.retryAfter) {
      throw createError({
        statusCode: 429,
        message:
          "Na Twoją poprzednią prośbę odpowiedzieliśmy niedawno. Kolejną " +
          `możesz wysłać po ${ACCESS_REQUEST_COOLDOWN_DAYS} dniach od odpowiedzi.`,
        data: { retryAfter: before.retryAfter },
      });
    }

    // The whole document, not a merge: a renewed request is a new question,
    // and the answer to the last one stays in the history, not on the
    // request an administrator is about to read.
    const request: AccessRequestDoc = {
      reason: body.reason,
      source: body.source,
      createdAt: now.toISOString(),
      status: "open",
      handledBy: null,
      handledAt: null,
      handledReason: null,
    };
    tx.set(ref, request);
    recordUserAction(
      db,
      {
        kind: "accessRequest",
        target: user.uid,
        by: user.uid,
        reason: body.reason,
        // The page the button was on, so the history reads "/rozszerzenie"
        // rather than a bare word.
        detail: `/${body.source}`,
      },
      tx,
    );

    return describeOwnRequest(request, { hasAccess: false, now });
  });
});
