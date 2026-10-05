import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody, setResponseHeader } from "h3";
import { requireEstablishedAdmin } from "~~/server/utils/auth";
import { recordUserAction } from "~~/server/utils/userActions";
import { buildRowFor, readAccount } from "~~/server/utils/userDirectory";
import {
  dismissRequestBodySchema,
  userCollections,
  type AccessRequestDoc,
  type AdminUserRow,
} from "~~/shared/userAdmin";

/** The account's row with the request closed. */
export type DismissRequestResponse = AdminUserRow;

/** Says no, for now, to somebody who asked for the team's tools.
 *
 * The request stays where it is, marked `dismissed` with who, when and why:
 * the person sees on /pomoc that it was answered and when they may ask again
 * (`ACCESS_REQUEST_COOLDOWN_DAYS` after `handledAt`), and the next
 * administrator to open the account sees what the last one decided. Saying
 * yes is a nomination (`/api/admin/users/nominate`), which closes the request
 * itself.
 *
 * A transaction rather than a batch, because the request is read first: two
 * administrators answering the same request at once must not both succeed,
 * and one nominating while the other dismisses must not leave a nominated
 * person marked as turned down.
 */
export default defineEventHandler(
  async (event): Promise<DismissRequestResponse> => {
    const caller = await requireEstablishedAdmin(event);
    const body = await readValidatedBody(event, (b) =>
      dismissRequestBodySchema.parse(b),
    );
    setResponseHeader(event, "Cache-Control", "private, no-store");

    const account = await readAccount(body.uid);
    if (!account) {
      throw createError({ statusCode: 404, message: "Nie ma takiego konta." });
    }
    const reason = body.reason || undefined;

    const db = getFirestore("koryta-pl");
    const ref = db.collection(userCollections.accessRequests).doc(body.uid);

    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        throw createError({
          statusCode: 404,
          message: "Ta osoba nie prosiła o dostęp.",
        });
      }
      const request = snapshot.data() as AccessRequestDoc;
      if (request.status !== "open") {
        throw createError({
          statusCode: 409,
          message: "Ta prośba została już rozpatrzona.",
        });
      }

      const handled: Pick<
        AccessRequestDoc,
        "status" | "handledBy" | "handledAt" | "handledReason"
      > = {
        status: "dismissed",
        handledBy: caller.uid,
        handledAt: new Date().toISOString(),
        handledReason: reason ?? null,
      };
      tx.update(ref, handled);

      recordUserAction(
        db,
        { kind: "dismissRequest", target: body.uid, by: caller.uid, reason },
        tx,
      );
    });

    return buildRowFor(db, account);
  },
);
