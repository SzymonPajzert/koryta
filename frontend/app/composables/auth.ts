import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { ref } from "vue";
import { ref as dbRef, get } from "firebase/database"

const user = ref<User | null>();
const isAdmin = ref<boolean>(false);
const idToken = ref<string>("");
const pictureURL = ref("")

export function useAuthState() {
  const auth = useFirebaseAuth()!;
  const router = useRouter();
  const db = useDatabase();

  onAuthStateChanged(auth, (userIn) => {
    user.value = userIn;
    user.value?.getIdTokenResult().then((idTokenResult) => {
      isAdmin.value = idTokenResult.claims.admin as boolean;
      idToken.value = idTokenResult.token;
    });
    get(dbRef(db, `user/${user.value?.uid}/photoURL`)).then(snapshot => pictureURL.value = snapshot.val());
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

  return { user, isAdmin, idToken, pictureURL, logout };
}
