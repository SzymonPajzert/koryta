import type { vi } from "vitest";
import type { Ref } from "vue";

export type MockAuthState = {
  user: Ref<{ uid: string; getIdToken?: () => Promise<string> } | null>;
  isAdmin?: Ref<boolean>;
  idToken?: Ref<string | undefined>;
  userConfig?: { data: Ref<Record<string, unknown>> };
  logout?: ReturnType<typeof vi.fn>;
  login?: ReturnType<typeof vi.fn>;
  register?: ReturnType<typeof vi.fn>;
  authFetch?: ReturnType<typeof vi.fn>;
};
