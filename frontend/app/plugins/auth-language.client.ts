import { getAuth } from "firebase/auth";

/** Firebase's own mail (the address confirmation, the password reset) and
 * its Google sign-in window speak Polish. Unset, they took the console
 * template's language. */
export default defineNuxtPlugin(() => {
  getAuth(useFirebaseApp()).languageCode = "pl";
});
