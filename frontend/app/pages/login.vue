<template>
  <div class="login-page w-100 mx-auto">
    <main v-if="user">
      <!-- Right after signing in or creating an account, a reader outside the
           team who never answered the newsletter question gets it here,
           before going back to where they were. -->
      <v-card v-if="stage === 'question'" rounded="lg" class="pa-2">
        <v-card-text>
          <MailNewsletterQuestion
            :where="signInWhere"
            :status="questionStatus"
            :verification-sent="signInWhere === 'signup'"
            title-tag="h1"
            autofocus
            @answered="onNewsletterAnswered"
          />
        </v-card-text>
      </v-card>
      <!-- Waiting to know whether to ask, so the greeting and its countdown do
           not flash up first and get replaced by the question. -->
      <v-card
        v-else-if="stage === 'waiting'"
        rounded="lg"
        class="pa-6 d-flex justify-center"
      >
        <v-progress-circular indeterminate aria-label="Logowanie" />
      </v-card>
      <v-card v-else rounded="lg" class="pa-2">
        <v-card-title class="text-h5 text-wrap">
          Cześć {{ user?.displayName || user?.email }}!
        </v-card-title>
        <v-card-text>
          <!-- A line rather than a tinted alert: what was saved, in body
               ink, under the greeting. -->
          <p
            v-if="newsletterNote"
            class="newsletter-note mb-4"
            data-newsletter-note
          >
            <v-icon
              :icon="mdiCheckCircle"
              size="18"
              color="ink-sage"
              class="newsletter-note__icon"
            />
            <span>{{ newsletterNote }}</span>
          </p>
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
import { mdiCheckCircle } from "@mdi/js";
import { useNewsletterQuestion } from "~/composables/newsletter";
import { signedInAs, useSignInMethod } from "~/composables/signInMethod";

const loading = ref(false);
// `?konto=nowe` opens the form on registration: a lock that says „załóż konto"
// should not land the reader on a login form they have no account for.
const isLogin = ref(useRoute().query.konto !== "nowe");
const error = ref<string | null>(null);

const auth = useFirebaseAuth()!;
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
    }
  });
}

// The newsletter question, for a reader who has just signed in here or came
// back to /login signed in, and never answered it. `due` is undefined until the
// account's claims and its user document are in.
const { due, whenKnown } = useNewsletterQuestion();
const newsletterNote = ref<string | null>(null);
/** Gives up waiting for `due` after a while, so a document that never loads
 * leaves the reader at the greeting rather than at a spinner; the layout's
 * card asks them later. */
const stopWaiting = ref(false);
watch(
  user,
  (signedIn) => {
    if (signedIn) setTimeout(() => (stopWaiting.value = true), 5000);
  },
  { immediate: true },
);

/** Set once the question is up, so it stays up until it is answered. The
 * answer reaches the user document - and turns `due` off - before the save
 * returns, and with the stage read off `due` alone the card would go from
 * under the reader's click, taking the confirmation with it. */
const asking = ref(false);
watch(
  due,
  (value) => {
    if (value === true) asking.value = true;
  },
  { immediate: true },
);
// Somebody else signing in on this page starts from the beginning.
watch(
  () => user.value?.uid,
  () => {
    asking.value = due.value === true;
    newsletterNote.value = null;
  },
);

const stage = computed<"waiting" | "question" | "hello">(() => {
  if (newsletterNote.value) return "hello";
  if (asking.value) return "question";
  if (due.value === undefined) return stopWaiting.value ? "hello" : "waiting";
  return "hello";
});

/** Whether the sign-in just now created the account - an email registration
 * or somebody's first Google sign-in alike. */
const signInMethod = useSignInMethod();
const signInWhere = computed(() =>
  signedInAs(signInMethod.value, user.value?.metadata),
);

const questionStatus = computed(() => {
  const who = user.value?.displayName || user.value?.email || "";
  if (signInWhere.value !== "signup") return `Zalogowano jako ${who}.`;
  return user.value?.emailVerified
    ? "Konto założone."
    : `Konto założone. Link potwierdzający wysłaliśmy na ${user.value?.email}.`;
});

const onNewsletterAnswered = ({ note }: { note: string }) => {
  newsletterNote.value = note;
};

// Back to browsing only from the greeting: never while the question waits for
// an answer.
watch(
  [user, stage],
  ([signedIn, current]) => {
    if (signedIn && current === "hello") {
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

  // Asked first, if there is something to ask; answering leads to the
  // greeting, whose countdown takes the reader back. So does a new account
  // that is not asked: the greeting says the address is still to confirm,
  // which is the line the old alert carried.
  if (await whenKnown()) return;
  if (signInWhere.value === "signup") return;
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

.newsletter-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.875rem;
  line-height: 1.45;
}

.newsletter-note__icon {
  flex: none;
  margin-top: 1px;
}

/* The address in it is one unbroken word, and some are longer than a phone. */
.newsletter-note > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
