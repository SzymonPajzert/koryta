import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody, setResponseHeader } from "h3";
import { requireEstablishedAdmin } from "~~/server/utils/auth";
import { recordUserAction } from "~~/server/utils/userActions";
import {
  buildRowFor,
  readAccount,
  roleState,
} from "~~/server/utils/userDirectory";
import {
  normalizeRoleState,
  roleLevelLabels,
  roleLevels,
  sameRoleState,
  type RoleLevel,
} from "~~/shared/roles";
import { isAutomatedUid } from "~~/shared/stats";
import {
  levelsNeedingVerifiedEmail,
  nominateBodySchema,
  userCollections,
  type AccessRequestDoc,
  type AdminUserRow,
  type RoleNominationDoc,
} from "~~/shared/userAdmin";

/** The account's row as it stands after the nomination, so the page can
 * replace the one it shows. */
export type NominateResponse = AdminUserRow;

/** Levels a request for access is answered by. The request asks for the
 * team's tools, which is what `datascience` is and `admin` includes; a
 * nomination to `trusted` is something else and leaves the request open.
 *
 * A request stays `nominated` only as long as the wish answers it. A wish
 * changed to a level below these - by a second administrator who thinks
 * otherwise, or by the first one changing their mind - takes the answer away,
 * so the request is opened again. Left `nominated`, it would sit outside every
 * section of the users page, refused by dismiss-request as already handled,
 * while the requester's /pomoc kept promising access nothing is going to grant.
 * withdraw.post.ts opens it again on the same terms. */
const levelsAnsweringRequest: readonly RoleLevel[] = ["datascience", "admin"];

/** What the nomination's line in the history adds when it opened a request
 * again. withdraw.post.ts writes the same words. */
const REQUEST_REOPENED = "Prośba o dostęp wróciła do rozpatrzenia.";

/** An established administrator saying what role somebody should have.
 *
 * Nothing here changes a claim. The wish goes into `roleNominations/{uid}`,
 * and the claims script shows it to the site's owner, who answers y/N per
 * account before anything is granted or taken away. What this route refuses is
 * what the owner should never have to be asked about:
 *
 * - yourself - a nomination is somebody else vouching for you;
 * - a robot, whose claims come with its custom token and are nobody's to give;
 * - the team's tools or admin for an address nobody proved they own: anybody
 *   may register under anybody's email, and the name and address are what the
 *   nominator recognises the person by. Google accounts are verified. Not for
 *   a step down, though, nor for a wish set back to the role the account
 *   holds: the script asks about neither, and an unverified administrator from
 *   before addresses were checked should not keep `admin` because nobody may
 *   nominate them to the team;
 * - the owner out of an administrator's role, which the script refuses too;
 * - a wish that is already the account's role, with nothing pending to
 *   replace.
 *
 * `trial` below admin means nothing and is dropped rather than refused.
 *
 * The wish, the line in the account's history and the answer to a request for
 * access - given, or taken back - are written in one transaction: the history
 * can never miss a nomination, and a request dismissed by somebody else a
 * second earlier is neither turned back into a nominated one nor reopened.
 */
export default defineEventHandler(async (event): Promise<NominateResponse> => {
  const caller = await requireEstablishedAdmin(event);
  const body = await readValidatedBody(event, (b) =>
    nominateBodySchema.parse(b),
  );
  setResponseHeader(event, "Cache-Control", "private, no-store");

  if (body.uid === caller.uid) {
    throw createError({
      statusCode: 403,
      message:
        "Nie możesz nominować samego siebie. Poproś o to innego administratora.",
    });
  }
  if (isAutomatedUid(body.uid)) {
    throw createError({
      statusCode: 400,
      message:
        "To konto automatu (pipeline'u albo migracji), a nie osoby - nie nadaje się mu ról na tej stronie.",
    });
  }

  const account = await readAccount(body.uid);
  if (!account) {
    throw createError({ statusCode: 404, message: "Nie ma takiego konta." });
  }

  const desired = normalizeRoleState({ level: body.level, trial: body.trial });
  const current = account.current;

  // The script's rule (`refusal` in set_auth_claims.py), so that nothing the
  // owner is shown is something the script would refuse anyway: a level that
  // publishes is refused for an unverified address only when it is not below
  // the one the account holds. Equal counts - ending a trial makes a full
  // administrator of the address all the same. A wish that is the live role
  // grants nothing, and the script passes it as unchanged.
  const notBelowCurrent =
    roleLevels.indexOf(desired.level) >= roleLevels.indexOf(current.level);
  if (
    levelsNeedingVerifiedEmail.includes(desired.level) &&
    !account.emailVerified &&
    notBelowCurrent &&
    !sameRoleState(desired, current)
  ) {
    throw createError({
      statusCode: 400,
      message:
        `Poziom „${roleLevelLabels[desired.level].title}” wymaga potwierdzonego ` +
        "adresu e-mail, a ta osoba swojego nie potwierdziła. Może to zrobić na stronie /profil.",
    });
  }
  // A trial counts as below: it would put the owner among the people the
  // established administrators watch, and out of this page.
  if (current.owner && (desired.level !== "admin" || desired.trial)) {
    throw createError({
      statusCode: 403,
      message:
        "Właściciel serwisu pozostaje administratorem - tej roli nie można mu odebrać ani zamienić na okres próbny.",
    });
  }

  const db = getFirestore("koryta-pl");
  const nominationRef = db
    .collection(userCollections.roleNominations)
    .doc(body.uid);
  const requestRef = db
    .collection(userCollections.accessRequests)
    .doc(body.uid);

  await db.runTransaction(async (tx) => {
    const [nominationSnapshot, requestSnapshot] = await tx.getAll(
      nominationRef,
      requestRef,
    );
    const existing = nominationSnapshot?.exists
      ? (nominationSnapshot.data() as RoleNominationDoc)
      : null;
    const pending =
      existing !== null && !sameRoleState(existing.desired, current);

    if (sameRoleState(desired, current) && !pending) {
      throw createError({
        statusCode: 409,
        message:
          "Ta osoba ma już tę rolę i żadna nominacja nie czeka na skrypt.",
      });
    }

    const request = requestSnapshot?.exists
      ? (requestSnapshot.data() as AccessRequestDoc)
      : null;
    const answersRequest = levelsAnsweringRequest.includes(desired.level);
    const reopensRequest = request?.status === "nominated" && !answersRequest;

    const at = new Date().toISOString();
    const wish: RoleNominationDoc["desired"] = {
      ...desired,
      reason: body.reason,
      by: caller.uid,
      at,
    };
    if (existing) {
      // Only `desired`: `applied`, `trialStartedAt` and `applyError` are the
      // script's, and say what happened to the previous wish.
      tx.update(nominationRef, { desired: wish });
    } else {
      const created: RoleNominationDoc = {
        desired: wish,
        applied: null,
        trialStartedAt: null,
        applyError: null,
      };
      tx.create(nominationRef, created);
    }

    recordUserAction(
      db,
      {
        kind: "nominate",
        target: body.uid,
        by: caller.uid,
        reason: body.reason,
        from: current,
        to: roleState(desired),
        // Said on this line rather than one of its own: the request is opened
        // again because of this nomination, not because anybody decided
        // anything about the request.
        detail: reopensRequest ? REQUEST_REOPENED : undefined,
      },
      tx,
    );

    if (request?.status === "open" && answersRequest) {
      const handled: Pick<
        AccessRequestDoc,
        "status" | "handledBy" | "handledAt" | "handledReason"
      > = {
        status: "nominated",
        handledBy: caller.uid,
        handledAt: at,
        handledReason: body.reason,
      };
      tx.update(requestRef, handled);
    } else if (reopensRequest) {
      // As it was sent, `createdAt` included: it is the same request, still
      // waiting, and nothing is kept of an answer it no longer has - an open
      // request with a `handledBy` would read as one somebody dealt with.
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
