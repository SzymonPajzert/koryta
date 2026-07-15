<template>
  <main v-if="user">
    Cześć {{ user?.displayName }}!
    <div v-if="!user.emailVerified">
      Zweryfikuj swój email:
      <v-btn :loading="loading" @click="sendVerification">
        Wyślij ponownie
      </v-btn>
    </div>
    <div class="mt-4 d-flex gap-2 align-center">
      <v-btn color="primary" @click="doRedirect">
        Wróć do przeglądania ({{ countdown }})
      </v-btn>
      <v-btn color="warning" @click="logoutForced">Wyloguj się teraz</v-btn>
    </div>
  </main>
  <main v-if="!user">
    <v-alert v-if="reason === 'unauthorized'" type="info" class="mb-4">
      Musisz być zalogowany, aby uzyskać dostęp do tej strony.
    </v-alert>
    <h2 class="blue">{{ isLogin ? "Zaloguj się" : "Rejestracja" }}</h2>
    <div>
      <a href="javascript:void(0)" @click="isLogin = !isLogin">
        {{
          isLogin
            ? "Nie masz konta? Zarejestruj się"
            : "Masz już konto? Zaloguj się"
        }}
      </a>
    </div>
    <FormLoginForm :is-login="isLogin" @success="onLoginSuccess" />
    <div>
      {{ isLogin ? "Logowanie się" : "Rejestracja" }} oznacza zgodę z
      <a href="/plik/regulamin">regulaminem</a> oraz
      <a href="/plik/polityka_prywatnosci">polityką prywatności</a>.
    </div>
  </main>
</template>

<script setup lang="ts">
import { watch } from "vue";
import { useCountdown } from "@vueuse/core";
import {
  type User,
  onAuthStateChanged,
  sendEmailVerification,
} from "firebase/auth";
import { set, ref as dbRef } from "firebase/database";

const loading = ref(false);
const isLogin = ref(true);
const error = ref<string | null>(null);

const auth = useFirebaseAuth()!;
const db = useDatabase();
const router = useRouter();
const route = useRoute();

const { redirect, reason } = route.query;
const { logout, idToken } = useAuthState();

const doRedirect = () => {
  pause();
  router.push((redirect as string) || "/");
};

const {
  remaining: countdown,
  resume,
  pause,
} = useCountdown(5, {
  onComplete: doRedirect,
});

const user = ref<User | null>();
if (auth) {
  onAuthStateChanged(auth, (userIn) => {
    user.value = userIn;
    if (userIn) {
      console.log("User logged in:", userIn.uid, idToken.value, userIn.email);
      set(dbRef(db, `user/${userIn.uid}/displayName`), userIn.displayName);
      set(dbRef(db, `user/${userIn.uid}/email`), userIn.email);
      set(dbRef(db, `user/${userIn.uid}/photoURL`), userIn.photoURL);
    }
  });
}

watch(
  user,
  (newUser) => {
    if (newUser) {
      resume();
    } else {
      pause();
    }
  },
  { immediate: true },
);

const logoutForced = async () => {
  await logout();
  // Force reload or redirect to be sure
  window.location.reload();
};

const onLoginSuccess = async () => {
  // Wait for auth state to propagate to Vuefire before router.push
  if (!user.value) {
    await new Promise<void>((resolve) => {
      const unwatch = watch(user, (u) => {
        if (u) {
          unwatch();
          resolve();
        }
      });
      // Fallback timeout just in case
      setTimeout(() => {
        unwatch();
        resolve();
      }, 2000);
    });
  }

  router.push((redirect as string) || "/");
};

const sendVerification = async () => {
  if (!user.value) return;
  loading.value = true;
  try {
    await sendEmailVerification(user.value);
    alert("Wysłano email weryfikacyjny.");
  } catch (err: unknown) {
    const errorObj = err as { code: string; message: string };
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
/* Basic styling to resemble a form, adapt to your submitview's style */
.login-view {
  max-width: 400px;
  margin: 0 auto;
  padding: 20px;
  border: 1px solid #ccc;
  border-radius: 5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
</style>
