import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody, setResponseHeader } from "h3";
import { requireEstablishedAdmin } from "~~/server/utils/auth";
import { recordUserAction } from "~~/server/utils/userActions";
import {
  buildRowFor,
  readAccount,
  roleState,
} from "~~/server/utils/userDirectory";
import { sameRoleState, type RoleLevel } from "~~/shared/roles";
import {
  userActionLabels,
  userCollections,
  withdrawBodySchema,
  type AccessRequestDoc,
  type AdminUserRow,
  type RoleNominationDoc,
} from "~~/shared/userAdmin";

/** The account's row once nothing is pending for it. */
export type WithdrawResponse = AdminUserRow;

/** Levels that answer a request for access - the same list nominate.post.ts
 * marks a request `nominated` by, and opens it again by when a wish drops
 * below them. */
const levelsAnsweringRequest: readonly RoleLevel[] = ["datascience", "admin"];

/** What the withdrawal's line in the history adds when it opened a request
 * again. nominate.post.ts writes the same words. */
const REQUEST_REOPENED = "Prośba o dostęp wróciła do rozpatrzenia.";

/** Takes back a nomination the script has not applied yet.
 *
 * A nomination is a desired state, not an entry in a queue, so there is
 * nothing to delete: the wish is set back to the role the account holds now,
 * and the script, which acts on the difference, has nothing left to ask the
 * owner. Deleting the document instead would also delete the script's receipt
 * (`applied`) and the trial's start date.
 *
 * The history line's `from` is the role the account holds and its `to` the
 * wish that was withdrawn - the same pair the nomination it undoes was written
 * with, so the two lines read as one change and its reversal.
 *
 * Withdrawing a nomination of yourself is refused like nominating yourself:
 * keeping your own role against a wish to take it away is a nomination too.
 *
 * A request for access the withdrawn nomination answered is opened again, in
 * the same transaction. Left `nominated`, it would drop out of every section
 * of the users page - it is not open, and nothing is pending - dismiss-request
 * would refuse it as already handled, and the requester's /pomoc would go on
 * promising access the script is no longer going to grant. Only when the
 * account does not hold the team's tools already: for one that does, the
 * request was granted, and what is withdrawn is a step past it.
 */
export default defineEventHandler(async (event): Promise<WithdrawResponse> => {
  const caller = await requireEstablishedAdmin(event);
  const body = await readValidatedBody(event, (b) =>
    withdrawBodySchema.parse(b),
  );
  setResponseHeader(event, "Cache-Control", "private, no-store");

  if (body.uid === caller.uid) {
    throw createError({
      statusCode: 403,
      message:
        "Nie możesz wycofać nominacji dotyczącej Ciebie. Poproś o to innego administratora.",
    });
  }

  const account = await readAccount(body.uid);
  if (!account) {
    throw createError({ statusCode: 404, message: "Nie ma takiego konta." });
  }
  const current = account.current;
  const reason = body.reason || undefined;

  const db = getFirestore("koryta-pl");
  const ref = db.collection(userCollections.roleNominations).doc(body.uid);
  const requestRef = db
    .collection(userCollections.accessRequests)
    .doc(body.uid);

  await db.runTransaction(async (tx) => {
    const [snapshot, requestSnapshot] = await tx.getAll(ref, requestRef);
    const nomination = snapshot?.exists
      ? (snapshot.data() as RoleNominationDoc)
      : null;
    if (!nomination || sameRoleState(nomination.desired, current)) {
      throw createError({
        statusCode: 409,
        message: "Nic nie czeka na skrypt - nie ma czego wycofać.",
      });
    }

    const wish: RoleNominationDoc["desired"] = {
      ...roleState(current),
      reason: reason ?? userActionLabels.withdraw,
      by: caller.uid,
      at: new Date().toISOString(),
    };
    tx.update(ref, { desired: wish });

    // The wish is now the live role, so whether it answers the request is
    // whether the account holds the tools.
    const request = requestSnapshot?.exists
      ? (requestSnapshot.data() as AccessRequestDoc)
      : null;
    const reopensRequest =
      request?.status === "nominated" &&
      !levelsAnsweringRequest.includes(current.level);

    recordUserAction(
      db,
      {
        kind: "withdraw",
        target: body.uid,
        by: caller.uid,
        reason,
        from: current,
        to: roleState(nomination.desired),
        // On this line rather than one of its own, as in nominate.post.ts:
        // nobody decided anything about the request.
        detail: reopensRequest ? REQUEST_REOPENED : undefined,
      },
      tx,
    );

    if (reopensRequest) {
      // As it was sent, `createdAt` included: the same request, waiting again.
      const reopened: Pick<
        AccessRequestDoc,
        "status" | "handledBy" | "handledAt" | "handledReason"
      > = {
        status: "open",
        handledBy: null,
        handledAt: null,
        handledReason: null,
      };
      tx.update(requestRef, reopened);
    }
  });

  return buildRowFor(db, account);
});
