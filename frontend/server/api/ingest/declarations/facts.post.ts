import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import {
  countDeclarationPeople,
  refuseOlderFacts,
} from "~~/server/utils/declarationPeopleCount";
import {
  declarationFactsIngestSchema,
  type DeclarationFactsResult,
} from "~~/shared/declarations";

/**
 * What predator knows of each candidacy of the night's list, from the night
 * (`koryta_bip_declarations send-facts`): the site counts the people snapshot
 * from it whole (`countDeclarationPeople`) and moves people during the day
 * from there. Facts older than the ones counted last are a 409 unless forced,
 * so a late resend does not undo a newer count.
 *
 * Scoped like the other ingests, to the datascience group, checked before
 * the body is read.
 */
export default defineEventHandler(
  async (event): Promise<DeclarationFactsResult> => {
    requireDatascience(await getUser(event));
    const body = await readValidatedBody(event, (raw) =>
      declarationFactsIngestSchema.parse(raw),
    );
    const db = getFirestore(getApp(), "koryta-pl");
    await refuseOlderFacts(db, body);
    return countDeclarationPeople(db, body, new Date());
  },
);
