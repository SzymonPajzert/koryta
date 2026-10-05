import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import {
  accountDisplayName,
  ownProfileSettings,
} from "~~/server/utils/profiles";
import type { OwnProfileSettings } from "~~/shared/userAdmin";

/** The caller's own public profile, for the block under the switch on
 * /profil: whether it is on, its address, and whether an administrator hid it.
 *
 * Reading it is also what gives a profile its handle. The switch is saved by
 * the browser straight into `users/{uid}`, where the server has no hook, so
 * /profil asks here once the write has landed and the handle is made then,
 * from the name the account has now. Somebody who turned the switch on before
 * profiles existed gets theirs the first time they look - or the first time
 * the ranking lists them, whichever is sooner.
 */
export default defineEventHandler(
  async (event): Promise<OwnProfileSettings> => {
    const user = await getUser(event);
    setResponseHeader(event, "Cache-Control", "private, no-store");

    const db = getFirestore("koryta-pl");
    return ownProfileSettings(db, user.uid, () =>
      accountDisplayName(user.uid, user.name),
    );
  },
);
