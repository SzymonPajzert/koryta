import { signInMode } from "~/utils/signInMode";

/** How the reader last signed in from the sign-in form in this tab. */
export type SignInMethod = "email-login" | "email-signup" | "google";

/** Set by the sign-in form before it calls Firebase, for the page or dialog
 * around it to read once the reader is signed in.
 *
 * Not an event: /login swaps the form out for the signed-in card the moment
 * the user appears, and an event a component emits once it is gone is never
 * delivered. */
export function useSignInMethod() {
  return useState<SignInMethod | null>("sign-in-method", () => null);
}

/** Whether the sign-in just now created the account. The form's own answer
 * where there is one; for Google, and for a reader who arrives already signed
 * in, Firebase's record of the account (see `signInMode`), which counts any
 * sign-in in an account's first minute as its creation. */
export function signedInAs(
  method: SignInMethod | null,
  metadata: { creationTime?: string; lastSignInTime?: string } | undefined,
): "login" | "signup" {
  if (method === "email-signup") return "signup";
  if (method === "email-login") return "login";
  return metadata ? signInMode(metadata) : "login";
}
