/** Whether a sign-in just now made the account, from Firebase's own record of
 * the user: an account is created by signing in, so for a new one the two
 * times are the same moment. A minute of slack covers the clocks they are
 * read from; somebody signing in again within a minute of signing up is
 * counted as signing up twice, which nobody will notice. */
export function signInMode(metadata: {
  creationTime?: string;
  lastSignInTime?: string;
}): "login" | "signup" {
  const created = Date.parse(metadata.creationTime ?? "");
  const signedIn = Date.parse(metadata.lastSignInTime ?? "");
  if (Number.isNaN(created) || Number.isNaN(signedIn)) return "login";
  return Math.abs(signedIn - created) < 60_000 ? "signup" : "login";
}
