<template>
  <div class="login-form">
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
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
} from "firebase/auth";

defineProps<{
  isLogin: boolean;
}>();

const emit = defineEmits<{
  (e: "success"): void;
}>();

const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

const auth = useFirebaseAuth()!;
const { login: authLogin, register: authRegister } = useAuthState();

const login = async () => {
  error.value = null;
  loading.value = true;
  try {
    await authLogin(email.value, password.value);
    console.debug("User logged in successfully!");
    emit("success");
  } catch (err: unknown) {
    const errorObj = err as { code: string; message: string };
    console.error("Login error:", errorObj.code, errorObj.message);
    error.value = getErrorMessage(errorObj.code);
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
    emit("success");
  } catch (err: unknown) {
    const errorObj = err as { code: string; message: string };
    console.error("Google login error:", errorObj.code, errorObj.message);
    error.value = getErrorMessage(errorObj.code);
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
    emit("success");
  } catch (err: unknown) {
    const errorObj = err as { code: string; message: string };
    if (errorObj.code === "auth/user-not-found") {
      error.value = "Użytkownik nie istnieje";
      return;
    }
    error.value = getErrorMessage(errorObj.code);
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
  background-color: #4caf50;
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
  background-color: #db4437;
  margin-top: 10px;
}
</style>
