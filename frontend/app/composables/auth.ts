import { onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, type User } from "firebase/auth";
import { collection, doc } from "firebase/firestore";
import { ref } from "vue";

type UserConfig = {
  photoURL?: string;
};

export function useAuthState() {
  const user = useState<User | null>("user", () => null);
  const isAdmin = useState<boolean>("isAdmin", () => false);
  const idToken = useState<string>("idToken", () => "");
  const auth = useFirebaseAuth()!;
  const router = useRouter();
  const db = useFirestore();
  const userConfigRef = computed(() =>
    user.value ? doc(collection(db, "users"), user.value.uid) : null,
  );
  const userConfig = useDocument<UserConfig>(userConfigRef);

  // Initialize listener only once on the client
  if (import.meta.client && !useState("authListenerInitialized").value) {
    useState("authListenerInitialized", () => true);
    onAuthStateChanged(auth, async (userIn) => {
      user.value = userIn;
      if (userIn) {
        const idTokenResult = await userIn.getIdTokenResult();
        isAdmin.value = !!idTokenResult.claims.admin;
        idToken.value = idTokenResult.token;
      } else {
        isAdmin.value = false;
        idToken.value = "";
      }
    });
  }

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

  return { user, isAdmin, idToken, userConfig, logout, login, register };
}
