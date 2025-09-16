import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { collection, doc } from "firebase/firestore";
import { ref } from "vue";

type UserConfig = {
  photoURL?: string;
};

export function useAuthState() {
  const user = ref<User | null>();
  const isAdmin = ref<boolean>(false);
  const idToken = ref<string>("");
  const auth = useFirebaseAuth()!;
  const router = useRouter();
  const db = useFirestore();
  const userConfigRef = computed(() =>
    user.value ? doc(collection(db, "users"), user.value.uid) : null,
  );
  const userConfig = useDocument<UserConfig>(userConfigRef);

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

  return { user, isAdmin, idToken, userConfig, logout };
}
