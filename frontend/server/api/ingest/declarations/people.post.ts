import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { PEOPLE_DOC } from "~~/server/utils/declarationPeople";
import { declarationPeopleSchema } from "~~/shared/declarations";

/**
 * The night's count of the declarations in people, from the declarations job
 * on predator (`koryta_bip_declarations people --send`). It replaces
 * `stats/declaration_people` whole: the schema holds the job to the contract,
 * the stages adding up included, so a count that does not read as one is
 * refused and the last night's stays up.
 *
 * `GET /api/declarations/people` keeps it an hour; this instance's copy goes
 * at once.
 */
export default defineEventHandler(async (event) => {
  requireDatascience(await getUser(event));
  const snapshot = await readValidatedBody(event, (raw) =>
    declarationPeopleSchema.parse(raw),
  );
  const db = getFirestore(getApp(), "koryta-pl");
  await db.collection("stats").doc(PEOPLE_DOC).set(snapshot);
  await useStorage("cache").clear("nitro:handlers:declarations-people");
  return {
    status: "ok",
    people: snapshot.people,
    exportDay: snapshot.exportDay,
  };
});
