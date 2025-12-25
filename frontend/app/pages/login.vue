<template>
  <main v-if="user">
    Cześć {{ user?.displayName }}!
    <div v-if="!user.emailVerified">
      Zweryfikuj swój email:
      <v-btn :loading="loading" @click="sendVerification">
        Wyślij ponownie
      </v-btn>
    </div>
    <div class="mt-4">
      <v-btn color="warning" @click="logoutForced">Wyloguj się teraz</v-btn>
    </div>
  </main>
  <main v-if="!user">
    <v-alert v-if="reason === 'unauthorized'" type="info" class="mb-4">
      Musisz być zalogowany, aby uzyskać dostęp do tej strony.
    </v-alert>
    <h2 class="blue">{{ isLogin ? "Zaloguj się" : "Rejestracja" }}</h2>
    <div>
      <a href="#" @click.prevent="isLogin = !isLogin">
        {{
          isLogin
            ? "Nie masz konta? Zarejestruj się"
            : "Masz już konto? Zaloguj się"
        }}
      </a>
    </div>
    <v-form @submit.prevent="isLogin ? login() : register()">
      <div class="form-group">
        <button
          v-if="isLogin"
          type="button"
          :disabled="loading"
          class="google-button"
          @click="loginWithGoogle"
        >
          <span v-if="loading">Loguję się</span>
          <span v-else>Zaloguj się z Google</span>
        </button>
      </div>

      <div class="form-group">
        <label for="email">Email</label>
        <input id="email" v-model="email" type="email" required />
      </div>

      <div class="form-group">
        <label for="password">Hasło</label>
        <input id="password" v-model="password" type="password" required />
      </div>

      <div class="form-group">
        <button type="submit" :disabled="loading">
          <span v-if="loading">Proszę czekać...</span>
          <span v-else>{{ isLogin ? "Zaloguj się" : "Stwórz konto" }}</span>
        </button>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>
    </v-form>
    <div>
      {{ isLogin ? "Logowanie się" : "Rejestracja" }} oznacza zgodę z
      <a href="/plik/regulamin">regulaminem</a> oraz
      <a href="/plik/polityka_prywatnosci">polityką prywatności</a>.
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  GoogleAuthProvider,
  signInWithPopup,
  type User,
  onAuthStateChanged,
  sendEmailVerification,
} from "firebase/auth";
import { set, ref as dbRef } from "firebase/database";

const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const loading = ref(false);
const isLogin = ref(true);

const auth = useFirebaseAuth()!;
const db = useDatabase();
const router = useRouter();
const route = useRoute();

const { redirect, reason } = route.query;

const user = ref<User | null>();
onAuthStateChanged(auth, (userIn) => {
  user.value = userIn;
  if (userIn) {
    console.log("User logged in:", userIn.uid, userIn.email);
    set(dbRef(db, `user/${userIn.uid}/displayName`), userIn.displayName);
    set(dbRef(db, `user/${userIn.uid}/email`), userIn.email);
    set(dbRef(db, `user/${userIn.uid}/photoURL`), userIn.photoURL);
  }
});

const { login: authLogin, register: authRegister, logout } = useAuthState();

const logoutForced = async () => {
  await logout();
  // Force reload or redirect to be sure
  window.location.reload();
};

const login = async () => {
  error.value = null;
  loading.value = true;
  try {
    await authLogin(email.value, password.value);
    // User is signed in.
    console.debug("User logged in successfully!");
    router.push((redirect as string) || "/");
  } catch (err: any) {
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
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    console.debug("User logged in with Google successfully!");
    router.push((redirect as string) || "/");
  } catch (err: any) {
    console.error("Google login error:", err.code, err.message);
    error.value = getErrorMessage(err.code);
  } finally {
    loading.value = false;
  }
};

const register = async () => {
  error.value = null;
  loading.value = true;
  try {
    const userCredential = await authRegister(email.value, password.value);
    await sendEmailVerification(userCredential.user);
    alert("Wysłano email weryfikacyjny. Sprawdź swoją skrzynkę.");

    // Add delay to allow auth state to propagate to middleware (especially for tests)
    await new Promise((resolve) => setTimeout(resolve, 500));

    router.push((redirect as string) || "/");
  } catch (err: any) {
    if (err.code === "auth/user-not-found") {
      error.value = "Użytkownik nie istnieje";
      return;
    }
    error.value = getErrorMessage(err.code);
  } finally {
    loading.value = false;
  }
};

const sendVerification = async () => {
  if (!user.value) return;
  loading.value = true;
  try {
    await sendEmailVerification(user.value);
    alert("Wysłano email weryfikacyjny.");
  } catch (err: any) {
    error.value = getErrorMessage(err.code);
  } finally {
    loading.value = false;
  }
};

const getErrorMessage = (errorCode: string) => {
  switch (errorCode) {
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
    case "auth/email-already-in-use":
      return "Ten email jest już w użyciu.";
    case "auth/weak-password":
      return "Hasło jest zbyt słabe. Powinno mieć co najmniej 6 znaków.";
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
