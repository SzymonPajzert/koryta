import type { vi } from "vitest";
import type { Ref } from "vue";

export type MockAuthState = {
  user: Ref<{ uid: string; getIdToken?: () => Promise<string> } | null>;
  isAdmin?: Ref<boolean>;
  isOwner?: Ref<boolean>;
  isDatascience?: Ref<boolean>;
  /** `admin` with `newAdmin`: an administrator on trial. */
  isNewAdmin?: Ref<boolean>;
  /** `admin` without `newAdmin`. */
  isEstablishedAdmin?: Ref<boolean>;
  /** Set once a claims change has refreshed the token; the layout shows it as
   * a snackbar and clears it. */
  claimsRefreshed?: Ref<boolean>;
  /** Set when a claims change ended the session instead; shown and cleared
   * the same way. */
  claimsSignedOut?: Ref<boolean>;
  idToken?: Ref<string | undefined>;
  userConfig?: { data: Ref<Record<string, unknown>> };
  logout?: ReturnType<typeof vi.fn>;
  login?: ReturnType<typeof vi.fn>;
  register?: ReturnType<typeof vi.fn>;
  authFetch?: ReturnType<typeof vi.fn>;
};
