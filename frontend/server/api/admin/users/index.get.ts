import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { requireEstablishedAdmin } from "~~/server/utils/auth";
import { listUserRows } from "~~/server/utils/userDirectory";
import { userListScopes, type AdminUsersResponse } from "~~/shared/userAdmin";

const queryValidator = z.object({
  zakres: z.enum(userListScopes).default("aktywni"),
});

/** The accounts on /admin/uzytkownicy: who holds what, who was nominated to
 * what, who asked for access, how often they sign in and what they did in the
 * last 90 days.
 *
 * For established administrators only, checked against the account rather
 * than the token (`requireEstablishedAdmin`). The response carries every
 * listed account's address, and the administrators on trial are the people
 * the page's trial section is about - the same reason /aktywnosc gives them the
 * contributor view.
 *
 * `?zakres=aktywni` (the default) keeps the accounts that are part of the work
 * in some way; `wszyscy` is every account the walk reached. See
 * `isActiveAccount` and `listUserRows` for what is read fresh and what comes
 * out of the five-minute memo.
 */
export default defineEventHandler(
  async (event): Promise<AdminUsersResponse> => {
    await requireEstablishedAdmin(event);
    const { zakres } = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );

    // Addresses and roles of other people. Per caller, never stored by anything
    // between here and the browser.
    setResponseHeader(event, "Cache-Control", "private, no-store");

    return listUserRows(getFirestore("koryta-pl"), zakres);
  },
);
