import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getUser } from "~~/server/utils/auth";
import {
  addDeclarationLink,
  draftPerson,
  personDeclarationCrops,
} from "~~/server/utils/declarationPersonCrops";
import {
  declarationLinkSchema,
  type PersonDeclarationCrops,
} from "~~/shared/declarations";

/**
 * A link to a draft's declaration that a signed-in reader found by hand,
 * given on the page where the crawl found none (decision on 2026-11-20), for
 * the crawl to fetch. Answers with the page's declarations as they stand
 * now, the link among them.
 *
 * Signed-in readers only, checked before the body is read, and drafts only
 * (`draftPerson`); a reader's links are capped a day (`LINKS_PER_DAY`).
 */
export default defineEventHandler(
  async (event): Promise<PersonDeclarationCrops> => {
    const user = await getUser(event);
    const id = getRouterParam(event, "id");
    if (!id) throw createError({ statusCode: 400, message: "Missing id" });
    const body = await readValidatedBody(event, (raw) =>
      declarationLinkSchema.parse(raw),
    );

    const db = getFirestore(getApp(), "koryta-pl");
    const personId = await draftPerson(db, id);
    await addDeclarationLink(db, { personId, url: body.url, uid: user.uid });
    return personDeclarationCrops(db, personId, user.uid);
  },
);
