<template>
  <v-form @submit.prevent="isLogin ? login() : register()">
    <v-btn
      v-if="isLogin"
      type="button"
      block
      variant="outlined"
      class="mb-4"
      :disabled="loading"
      :prepend-icon="mdiGoogle"
      @click="loginWithGoogle"
    >
      {{ loading ? "Loguję się..." : "Zaloguj się z Google" }}
    </v-btn>

    <v-divider v-if="isLogin" class="mb-4">
      <span class="text-caption text-medium-emphasis px-2">lub</span>
    </v-divider>

    <v-text-field
      id="email"
      v-model="email"
      type="email"
      label="Email"
      autocomplete="email"
      required
      class="mb-2"
    />

    <v-text-field
      id="password"
      v-model="password"
      :type="showPassword ? 'text' : 'password'"
      label="Hasło"
      :autocomplete="isLogin ? 'current-password' : 'new-password'"
      required
      class="mb-2"
      :append-inner-icon="showPassword ? mdiEyeOff : mdiEye"
      @click:append-inner="showPassword = !showPassword"
    />

    <v-btn type="submit" block color="primary" size="large" :loading="loading">
      {{ isLogin ? "Zaloguj się" : "Stwórz konto" }}
    </v-btn>

    <v-alert v-if="error" type="error" density="compact" class="mt-4">
      {{ error }}
    </v-alert>
  </v-form>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { mdiGoogle, mdiEye, mdiEyeOff } from "@mdi/js";
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
const showPassword = ref(false);
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
      return "To konto zostało zablokowane.";
    case "auth/user-not-found":
      return "Użytkownik nie istnieje.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Nieprawidłowy email lub hasło.";
    case "auth/popup-closed-by-user":
      return "Okno logowania zostało zamknięte.";
    case "auth/cancelled-popup-request":
      return "Logowanie zostało anulowane.";
    case "auth/popup-blocked":
      return "Przeglądarka zablokowała okno logowania.";
    case "auth/email-already-in-use":
      return "Ten email jest już w użyciu.";
    case "auth/weak-password":
      return "Hasło jest zbyt słabe. Powinno mieć co najmniej 6 znaków.";
    default:
      return "Wystąpił nieoczekiwany błąd. Spróbuj ponownie.";
  }
};
</script>
