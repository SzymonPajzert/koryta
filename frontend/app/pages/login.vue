<template>
  <div class="login-page w-100 mx-auto">
    <main v-if="user">
      <v-card rounded="lg" class="pa-2">
        <v-card-title class="text-h5 text-wrap">
          Cześć {{ user?.displayName || user?.email }}!
        </v-card-title>
        <v-card-text>
          <v-alert
            v-if="!user.emailVerified"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            <div class="d-flex flex-column flex-sm-row align-sm-center ga-2">
              <span class="flex-grow-1">Zweryfikuj swój adres email.</span>
              <v-btn
                size="small"
                variant="outlined"
                :loading="loading"
                @click="sendVerification"
              >
                Wyślij ponownie
              </v-btn>
            </div>
          </v-alert>
          <div class="d-flex flex-column ga-2">
            <v-btn color="primary" block size="large" @click="doRedirect">
              Wróć do przeglądania ({{ countdown }})
            </v-btn>
            <v-btn color="warning" variant="tonal" block @click="logoutForced">
              Wyloguj się teraz
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
    </main>
    <main v-if="!user">
      <v-alert v-if="reason === 'unauthorized'" type="info" class="mb-4">
        Musisz być zalogowany, aby uzyskać dostęp do tej strony.
      </v-alert>
      <v-card rounded="lg" class="pa-2">
        <v-card-title class="text-h5 text-center">
          {{ isLogin ? "Zaloguj się" : "Rejestracja" }}
        </v-card-title>
        <v-card-text>
          <FormLoginForm :is-login="isLogin" @success="onLoginSuccess" />
          <div class="text-center mt-4">
            <a href="javascript:void(0)" @click="isLogin = !isLogin">
              {{
                isLogin
                  ? "Nie masz konta? Zarejestruj się"
                  : "Masz już konto? Zaloguj się"
              }}
            </a>
          </div>
          <div class="text-caption text-medium-emphasis text-center mt-4">
            {{ isLogin ? "Logowanie się" : "Rejestracja" }} oznacza zgodę z
            <a href="/plik/regulamin">regulaminem</a> oraz
            <a href="/plik/polityka_prywatnosci">polityką prywatności</a>.
          </div>
        </v-card-text>
      </v-card>
    </main>
  </div>
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
.login-page {
  max-width: 440px;
}
</style>
