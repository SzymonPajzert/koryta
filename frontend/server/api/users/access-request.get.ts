import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import {
  describeOwnRequest,
  holdsTeamTools,
} from "~~/server/utils/accessRequests";
import { isAutomatedUid } from "~~/shared/stats";
import {
  userCollections,
  type AccessRequestDoc,
  type OwnAccessRequest,
} from "~~/shared/userAdmin";

/** The signed-in caller's own access request, for the „Poproś o dostęp”
 * button on /pomoc and /rozszerzenie: whether the form may be sent, and if not,
 * what to say instead.
 *
 * The uid comes from the verified token and there is no parameter for it, so
 * this cannot be turned into a way to read somebody else's request.
 */
export default defineEventHandler(async (event): Promise<OwnAccessRequest> => {
  const user = await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");

  const db = getFirestore("koryta-pl");
  const [snapshot, hasAccess] = await Promise.all([
    db.collection(userCollections.accessRequests).doc(user.uid).get(),
    holdsTeamTools(user),
  ]);

  return describeOwnRequest(snapshot.data() as AccessRequestDoc | undefined, {
    hasAccess,
    robot: isAutomatedUid(user.uid),
  });
});
