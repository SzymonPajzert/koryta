import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import {
  accountDisplayName,
  ownProfileSettings,
  setHandle,
} from "~~/server/utils/profiles";
import { isAutomatedUid } from "~~/shared/stats";
import { handleBodySchema, type OwnProfileSettings } from "~~/shared/userAdmin";

/** Changes the address of the caller's own profile.
 *
 * Allowed whether or not the profile is public: a handle on its own shows
 * nothing, and choosing it before switching the profile on is a reasonable
 * order to do things in. Answers with the settings as they now are, so /profil
 * can show the new address without asking again.
 */
export default defineEventHandler(
  async (event): Promise<OwnProfileSettings> => {
    const user = await getUser(event);
    const { handle } = await readValidatedBody(event, (body) =>
      handleBodySchema.parse(body),
    );
    if (isAutomatedUid(user.uid)) {
      throw createError({
        statusCode: 403,
        message: "Konta automatyczne nie mają profilu.",
      });
    }

    const db = getFirestore("koryta-pl");
    await setHandle(db, user.uid, handle);

    setResponseHeader(event, "Cache-Control", "private, no-store");
    return ownProfileSettings(db, user.uid, () =>
      accountDisplayName(user.uid, user.name),
    );
  },
);
