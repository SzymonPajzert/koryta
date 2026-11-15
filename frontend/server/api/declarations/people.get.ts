import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readDeclarationPeople } from "~~/server/utils/declarationPeople";
import type { DeclarationPeople } from "~~/shared/declarations";

/**
 * How far the declarations got, in people, for the home page, /oswiadczenia/postep
 * and the admin overview. Public: counts only, nobody named.
 *
 * The job writes it once a night, so an hour here costs nothing a reader
 * could notice, and the home page asks on every visit.
 */
export default defineCachedEventHandler(
  async (): Promise<{ people: DeclarationPeople | null }> => ({
    people: await readDeclarationPeople(getFirestore(getApp(), "koryta-pl")),
  }),
  { name: "declarations-people", maxAge: 3600, swr: true },
);
