<template>
  <v-form @submit.prevent="isLogin ? login() : register()">
    <!-- First, and in both modes: for Firebase, making an account with Google
         and signing in with it are the same tap, and on a phone it is the
         cheapest way in. Every „załóż konto" link lands on register mode. -->
    <v-btn
      type="button"
      block
      variant="outlined"
      class="mb-4"
      data-testid="login-google"
      :disabled="loading"
      :prepend-icon="mdiGoogle"
      @click="loginWithGoogle"
    >
      Kontynuuj z Google
    </v-btn>

    <v-divider class="mb-4">
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

    <!-- The rule is shown up front in register mode rather than as an error
         after a round trip on a phone keyboard. -->
    <v-text-field
      id="password"
      ref="passwordField"
      v-model="password"
      :type="showPassword ? 'text' : 'password'"
      label="Hasło"
      :autocomplete="isLogin ? 'current-password' : 'new-password'"
      :hint="isLogin ? undefined : 'Co najmniej 6 znaków'"
      :persistent-hint="!isLogin"
      required
      class="mb-2"
      :append-inner-icon="showPassword ? mdiEyeOff : mdiEye"
      @click:append-inner="showPassword = !showPassword"
    />

    <div v-if="isLogin" class="text-right mb-2">
      <a href="javascript:void(0)" class="text-caption" @click="resetPassword">
        Nie pamiętasz hasła?
      </a>
    </div>

    <v-btn type="submit" block color="primary" size="large" :loading="loading">
      {{ isLogin ? "Zaloguj się" : "Stwórz konto" }}
    </v-btn>

    <v-alert
      v-if="error"
      type="error"
      density="compact"
      class="mt-4"
      data-testid="login-error"
    >
      {{ error }}
      <v-btn
        v-if="emailInUse"
        type="button"
        size="small"
        variant="outlined"
        class="d-block mt-2"
        data-testid="login-zaloguj-tym-adresem"
        @click="signInInstead"
      >
        Zaloguj się tym adresem
      </v-btn>
    </v-alert>

    <v-alert v-if="info" type="success" density="compact" class="mt-4">
      {{ info }}
    </v-alert>
  </v-form>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { trackGoal } from "~/composables/analytics";
import { sendVerificationEmail } from "~/composables/auth";
import { mdiGoogle, mdiEye, mdiEyeOff } from "@mdi/js";
import {
  GoogleAuthProvider,
  getAdditionalUserInfo,
  signInWithPopup,
} from "firebase/auth";

/** Two-way, so the form can switch itself to signing in when the address
 * turns out to have an account already. A parent that binds it one-way still
 * gets the switch inside the form. */
const isLogin = defineModel<boolean>("isLogin", { required: true });

const emit = defineEmits<{
  (e: "success"): void;
}>();

const email = ref("");
const password = ref("");
const showPassword = ref(false);
const error = ref<string | null>(null);
/** Whether `error` is „this address has an account", which offers the way
 * into it. */
const emailInUse = ref(false);
const info = ref<string | null>(null);
const loading = ref(false);
const passwordField = ref<{ focus: () => void } | null>(null);

const auth = useFirebaseAuth()!;
const {
  login: authLogin,
  register: authRegister,
  resetPassword: authResetPassword,
} = useAuthState();

/** Read once in setup: `useRoute` after an `await` runs outside it, and by the
 * time an account exists /login may already be navigating away. */
const route = useRoute();
/** The `from` of `konto:utworzone`: the `powod` of the link that brought the
 * reader here. */
const from =
  typeof route.query.powod === "string" && route.query.powod
    ? route.query.powod
    : "inne";
/** Where the verification mail leads back to: the page the reader was headed
 * for, or - when this form is a dialog on some page - that page. */
const returnTo =
  typeof route.query.redirect === "string"
    ? route.query.redirect
    : route.path.startsWith("/login")
      ? "/"
      : route.fullPath;

// An error about one mode means nothing in the other.
watch(isLogin, () => {
  error.value = null;
  emailInUse.value = false;
});

const login = async () => {
  error.value = null;
  emailInUse.value = false;
  info.value = null;
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
  emailInUse.value = false;
  info.value = null;
  loading.value = true;
  try {
    const provider = new GoogleAuthProvider();
    const credential = await signInWithPopup(auth, provider);
    // Signing up with Google is this same call, and only its answer says
    // whether it made an account. Left uncounted, every Google sign-up is
    // missing from the conversion the locks are measured by.
    if (getAdditionalUserInfo(credential)?.isNewUser) {
      trackGoal("konto:utworzone", { from });
    }
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

const resetPassword = async () => {
  error.value = null;
  emailInUse.value = false;
  info.value = null;

  if (!email.value) {
    error.value = "Podaj swój adres email, i wyślemy Ci link do zmiany hasła.";
    return;
  }

  loading.value = true;
  try {
    await authResetPassword(email.value);
    // Deliberately worded so it does not reveal whether the account exists.
    info.value = `Jeśli konto dla ${email.value} istnieje, wysłaliśmy na nie link do ustawienia nowego hasła. Sprawdź swoją skrzynkę.`;
  } catch (err: unknown) {
    const errorObj = err as { code: string; message: string };
    console.error("Password reset error:", errorObj.code, errorObj.message);
    error.value = getErrorMessage(errorObj.code);
  } finally {
    loading.value = false;
  }
};

const register = async () => {
  error.value = null;
  emailInUse.value = false;
  info.value = null;
  loading.value = true;
  try {
    const userCredential = await authRegister(email.value, password.value);
    // The conversion every lock on the site exists for, counted where it
    // happens.
    trackGoal("konto:utworzone", { from });
    // Neither awaited nor announced: the account works before the address is
    // confirmed, so the reader goes straight on to what they came for, and a
    // mail that fails to send is not a failed sign-up - /profil sends it again.
    sendVerificationEmail(userCredential.user, returnTo).catch((err: unknown) =>
      console.error("Verification email error:", err),
    );
    emit("success");
  } catch (err: unknown) {
    const errorObj = err as { code: string; message: string };
    if (errorObj.code === "auth/user-not-found") {
      error.value = "Użytkownik nie istnieje";
      return;
    }
    emailInUse.value = errorObj.code === "auth/email-already-in-use";
    error.value = getErrorMessage(errorObj.code);
  } finally {
    loading.value = false;
  }
};

/** The way out of „this address has an account": the same form in sign-in
 * mode, with what was typed still in it. */
const signInInstead = async () => {
  isLogin.value = true;
  await nextTick();
  passwordField.value?.focus();
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
      return "Na ten adres jest już konto.";
    case "auth/weak-password":
      return "Hasło jest zbyt słabe. Powinno mieć co najmniej 6 znaków.";
    case "auth/invalid-email":
    case "auth/missing-email":
      return "Podaj poprawny adres email.";
    case "auth/too-many-requests":
      return "Zbyt wiele prób. Spróbuj ponownie za chwilę.";
    default:
      return "Wystąpił nieoczekiwany błąd. Spróbuj ponownie.";
  }
};
</script>
