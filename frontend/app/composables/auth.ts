import {
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { computedAsync } from "@vueuse/core";
import {
  useCurrentUser,
  useFirebaseAuth,
  useIsCurrentUserLoaded,
} from "vuefire";
import { collection, doc } from "firebase/firestore";

type UserConfig = {
  photoURL?: string;
};

export function useAuthState() {
  const router = useRouter();
  const db = useFirestore();

  const user = useCurrentUser();
  const isAdmin = computedAsync(
    async () =>
      await user.value?.getIdTokenResult().then((r) => !!r.claims.admin),
  );
  const idToken = computed(() => user.value?.getIdToken());
  const auth = useFirebaseAuth()!;

  const userConfigRef = computed(() =>
    user.value ? doc(collection(db, "users"), user.value.uid) : null,
  );
  const userConfig = useDocument<UserConfig>(userConfigRef);

  const logout = async () => {
    try {
      await signOut(auth);
      console.debug("User logged out successfully!");
      router.push("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const login = async (email: string, pass: string) => {
    return await signInWithEmailAndPassword(auth, email, pass);
  };

  const register = async (email: string, pass: string) => {
    return await createUserWithEmailAndPassword(auth, email, pass);
  };

  return {
    user,
    isAdmin,
    idToken,
    userConfig,
    logout,
    login,
    register,
  };
}

export const authFetch = createUseFetch({
  onRequest: async function ({ options }) {
    const isAuthReady = useIsCurrentUserLoaded();
    const user = useCurrentUser();
    // 1. If on the client and Firebase is still checking auth, PAUSE the request
    if (import.meta.client && !isAuthReady.value) {
      await new Promise<void>((resolve) => {
        const unwatch = watch(
          isAuthReady,
          (ready) => {
            if (ready) {
              unwatch();
              resolve(); // Release the pause!
            }
          },
          { immediate: true },
        );
      });
    }

    if (user.value) {
      options.query = { ...options.query, latest: true };
      const token = await user.value.getIdToken();
      options.headers = new Headers(options.headers);
      options.headers.set("Authorization", `Bearer ${token}`);
    }
  },
});
