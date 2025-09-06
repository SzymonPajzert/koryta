<template>
  <main v-if="user">Cześć {{ user?.displayName }}!</main>
  <main v-if="!user">
    <h2 class="blue">Zaloguj się</h2>
    <v-form @submit.prevent="login">
      <div class="form-group">
        <button
          type="button"
          :disabled="loading"
          class="google-button"
          @click="loginWithGoogle"
        >
          <span v-if="loading">Loguję się</span>
          <span v-else>Zaloguj się z Google</span>
        </button>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>
    </v-form>
    <div>
      Logowanie się oznacza zgodę z
      <a href="/plik/regulamin">regulaminem</a> oraz
      <a href="/plik/polityka_prywatnosci">polityką prywatności</a>.
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
  getAuth,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  type User,
  onAuthStateChanged,
} from "firebase/auth";
import { set, ref as dbRef } from "firebase/database";

const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

const auth = useFirebaseAuth()!;
const db = useDatabase();
const router = useRouter();

const user = ref<User | null>();
// TODO move it into a composable
onAuthStateChanged(auth, (userIn) => {
  user.value = userIn;
  set(dbRef(db, `user/${userIn?.uid}/displayName`), userIn?.displayName);
  set(dbRef(db, `user/${userIn?.uid}/email`), userIn?.email);
  set(dbRef(db, `user/${userIn?.uid}/photoURL`), userIn?.photoURL);
});

const login = async () => {
  error.value = null;
  loading.value = true;
  try {
    const auth = getAuth();
    await signInWithEmailAndPassword(auth, email.value, password.value);
    // User is signed in.
    console.debug("User logged in successfully!");
    router.push("/");
  } catch (err) {
    console.error("Login error:", err.code, err.message);
    error.value = getErrorMessage(err.code);
  } finally {
    loading.value = false;
  }
};

const loginWithGoogle = async () => {
  error.value = null;
  loading.value = true;
  try {
    const auth = getAuth();
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    console.debug("User logged in with Google successfully!");
    router.push("/");
  } catch (err) {
    console.error("Google login error:", err.code, err.message);
    error.value = getErrorMessage(err.code);
  } finally {
    loading.value = false;
  }
};

const getErrorMessage = (errorCode: string) => {
  switch (errorCode) {
    case "auth/invalid-email":
      return "Invalid email address.";
    case "auth/user-disabled":
      return "This user account has been disabled.";
    case "auth/user-not-found":
      return "User not found.";
    case "auth/wrong-password":
      return "Incorrect password.";
    case "auth/popup-closed-by-user":
      return "Login popup was closed by user.";
    case "auth/cancelled-popup-request":
      return "Login popup request was cancelled.";
    case "auth/popup-blocked":
      return "Login popup was blocked by the browser.";
    default:
      return "An unexpected error occurred. Please try again.";
  }
};
</script>

<style scoped>
/* Basic styling to resemble a form, adapt to your submitview's style */
.login-view {
  max-width: 400px;
  margin: 0 auto;
  padding: 20px;
  border: 1px solid #ccc;
  border-radius: 5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.form-group {
  margin-bottom: 15px;
}

label {
  display: block;
  margin-bottom: 5px;
}

input[type="email"],
input[type="password"] {
  width: 100%;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 3px;
  box-sizing: border-box;
}

button {
  background-color: #4caf50; /* Example color, change to match submitview */
  color: white;
  padding: 10px 15px;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}

button:disabled {
  background-color: #cccccc;
  cursor: not-allowed;
}

.error-message {
  color: red;
  margin-top: 10px;
}

.google-button {
  background-color: #db4437; /* Google red */
  margin-top: 10px;
}
</style>
