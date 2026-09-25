<template>
  <div class="login-page w-100 mx-auto">
    <main v-if="user && arrivedSignedIn">
      <v-card rounded="lg" class="pa-2">
        <v-card-title class="text-h5 text-wrap">
          Cześć {{ user?.displayName || user?.email }}!
        </v-card-title>
        <v-card-text>
          <v-alert
            v-if="!user.emailVerified"
            type="info"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            <div class="d-flex flex-column flex-sm-row align-sm-center ga-2">
              <span class="flex-grow-1">
                {{
                  verificationSent
                    ? "Wysłaliśmy link. Sprawdź swoją skrzynkę."
                    : verificationError ||
                      "Adres email nie jest jeszcze potwierdzony."
                }}
              </span>
              <v-btn
                v-if="!verificationSent"
                size="small"
                variant="outlined"
                :loading="loading"
                @click="sendVerification"
              >
                Wyślij link ponownie
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
    <!-- Signed in here a moment ago: on the way to `redirect`. -->
    <main v-else-if="user" class="d-flex justify-center py-8">
      <v-progress-circular
        indeterminate
        color="primary"
        aria-label="Przechodzę dalej"
      />
    </main>
    <main v-else>
      <v-alert v-if="reason === 'unauthorized'" type="info" class="mb-4">
        Musisz być zalogowany, aby uzyskać dostęp do tej strony.
      </v-alert>
      <v-alert
        v-else-if="powodText"
        type="info"
        class="mb-4"
        :data-testid="`login-powod-${powod}`"
      >
        {{ isLogin ? "Po zalogowaniu" : "Po założeniu konta" }}
        {{ powodText }}
      </v-alert>
      <v-card rounded="lg" class="pa-2">
        <v-card-title class="text-h5 text-center">
          {{ isLogin ? "Zaloguj się" : "Rejestracja" }}
        </v-card-title>
        <v-card-text>
          <FormLoginForm v-model:is-login="isLogin" />
          <div class="text-center mt-4">
            <a href="javascript:void(0)" @click="isLogin = !isLogin">
              {{
                isLogin
                  ? "Nie masz konta? Zarejestruj się"
                  : "Masz już konto? Zaloguj się"
              }}
            </a>
          </div>
          <!-- Worded so that the register-mode title is the only element with
               its word in it: the e2e spec finds the mode by that text. -->
          <div class="text-caption text-medium-emphasis text-center mt-4">
            {{ isLogin ? "Logując się" : "Zakładając konto" }}, zgadzasz się z
            <a href="/plik/regulamin">regulaminem</a> oraz
            <a href="/plik/polityka_prywatnosci">polityką prywatności</a>.
          </div>
        </v-card-text>
      </v-card>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useCountdown } from "@vueuse/core";
import { type User, onAuthStateChanged } from "firebase/auth";
import {
  redirectPath,
  sendVerificationEmail,
  useAuthState,
} from "~/composables/auth";
import { CONTRACT_LINK_ID_PATTERN } from "~~/shared/contractLinks";

const loading = ref(false);
// `?konto=nowe` opens the form on registration: a lock that says „załóż konto"
// should not land the reader on a login form they have no account for.
const isLogin = ref(useRoute().query.konto !== "nowe");
const verificationSent = ref(false);
const verificationError = ref<string | null>(null);

const auth = useFirebaseAuth()!;
const router = useRouter();
const route = useRoute();

const { reason, powod } = route.query;
const destination = redirectPath(route.query.redirect);
const { logout } = useAuthState();

/** The finding the link names (`?powiazanie=` inside the redirect), so the
 * ask can be about that one. */
const findingId = (() => {
  const id = new URL(destination, "http://koryta.invalid").searchParams.get(
    "powiazanie",
  );
  return id && CONTRACT_LINK_ID_PATTERN.test(id) ? id : null;
})();

/** What the account gets the reader, for links that say why they came. Follows
 * „Po założeniu konta" or „Po zalogowaniu".
 *
 * Only a teaser's `ukryte_<rank>` is promised outright: the reader has seen
 * that finding exist. A `cru_<nip>` comes from the locked permalink, which
 * cannot say whether the finding is gated or gone - and does not, on purpose -
 * so this hedges as that card does. `powiazania-osoby` is the „jeszcze N
 * osoby" line on a public card, whose name, firm and contracts the reader has
 * already read. */
const powodText =
  powod === "powiazania"
    ? findingId?.startsWith("ukryte_")
      ? "zobaczysz, kogo dotyczy wybrane powiązanie — nazwisko, firmę i umowy — a także wszystkie pozostałe z rejestru umów."
      : findingId
        ? "zobaczysz wybrane powiązanie z nazwiskami, firmą i umowami — o ile nadal jest na liście — a także wszystkie pozostałe z rejestru umów."
        : "zobaczysz wszystkie powiązania z rejestru umów — nazwiska, firmy i umowy — i od razu do nich wrócisz."
    : powod === "powiazania-osoby"
      ? "zobaczysz także osoby powiązane z tą firmą — ich nazwiska i role — oraz wszystkie pozostałe powiązania z rejestru umów."
      : powod === "ludzie"
        ? "zobaczysz osoby we władzach instytucji z rejestru umów."
        : null;

/** `replace`, not `push`: Back from where the reader was going must not land
 * on /login again, which would only forward them once more. */
const doRedirect = () => {
  pause();
  router.replace(destination);
};

const {
  remaining: countdown,
  resume,
  pause,
} = useCountdown(5, {
  onComplete: doRedirect,
});

const user = ref<User | null>();
/** Whether somebody was signed in when /login opened; `null` until Firebase
 * has restored or ruled out the session. Only they get the greeting above -
 * somebody who signs in or makes an account here is sent on at once. */
const arrivedSignedIn = ref<boolean | null>(null);
if (auth) {
  onAuthStateChanged(auth, (userIn) => {
    arrivedSignedIn.value ??= !!userIn;
    user.value = userIn;
  });
}

// Driven by the auth state rather than by the form's `success`: the form sits
// under `v-else`, so the new user unmounts it before it can emit, and an emit
// from an unmounted component goes nowhere.
watch(
  user,
  (newUser) => {
    if (!newUser) {
      pause();
    } else if (arrivedSignedIn.value) {
      resume();
    } else {
      router.replace(destination);
    }
  },
  { immediate: true },
);

const logoutForced = async () => {
  await logout();
  // Force reload or redirect to be sure
  window.location.reload();
};

const sendVerification = async () => {
  if (!user.value) return;
  loading.value = true;
  verificationError.value = null;
  try {
    await sendVerificationEmail(user.value, destination);
    verificationSent.value = true;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    console.error("Verification email error:", code);
    verificationError.value =
      code === "auth/too-many-requests"
        ? "Link wysłaliśmy przed chwilą. Spróbuj ponownie za kilka minut."
        : "Nie udało się wysłać linku. Spróbuj ponownie.";
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.login-page {
  max-width: 440px;
}
</style>
