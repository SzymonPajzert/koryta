import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { ref } from "vue";

const user = ref<User | null>();
const isAdmin = ref<boolean>(false);
const idToken = ref<string>("");

export function useAuthState() {
  const auth = useFirebaseAuth()!;
  const router = useRouter();

  onAuthStateChanged(auth, (userIn) => {
    user.value = userIn;
    user.value?.getIdTokenResult().then((idTokenResult) => {
      isAdmin.value = idTokenResult.claims.admin as boolean;
      idToken.value = idTokenResult.token;
    });
  });

  const logout = async () => {
    try {
      await signOut(auth);
      console.debug("User logged out successfully!");
      router.push("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return { user, isAdmin, idToken, logout };
}
