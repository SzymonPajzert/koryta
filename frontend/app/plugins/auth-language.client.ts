import { getAuth } from "firebase/auth";

/** Firebase's own mail (the password reset, and the address confirmation when
 * the site cannot send its own) and its Google sign-in window speak Polish.
 * Unset, they took the console template's language. */
export default defineNuxtPlugin(() => {
  getAuth(useFirebaseApp()).languageCode = "pl";
});
