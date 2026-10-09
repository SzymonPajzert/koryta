<template>
  <ClientOnly>
    <!-- The one-time question about campaign mail, for signed-in readers who
         never answered it. Campaigns reach a non-administrator only if they
         said yes (shared/campaigns.ts), and the newsletter switches on
         /profil, which used to be the only way to say so, are found by
         nobody who is not looking for them. Bottom start, clear of the
         „Zgłoś” button at bottom end. -->
    <v-card
      v-if="visible"
      class="mail-opt-in"
      rounded="lg"
      elevation="8"
      max-width="440"
      data-mail-opt-in
    >
      <v-card-item>
        <v-card-title class="text-wrap text-subtitle-1 font-weight-bold">
          Chcesz dostawać od nas maile?
        </v-card-title>
      </v-card-item>
      <v-card-text class="text-body-2">
        <p class="mb-2">
          Napiszemy, gdzie Twoja pomoc jest najbardziej potrzebna i kogo
          ostatnio znaleźliśmy. Z każdej wiadomości wypiszesz się jednym
          kliknięciem, a w <NuxtLink to="/profil">profilu</NuxtLink> wybierzesz,
          o czym chcesz czytać.
        </p>
        <p v-if="needsVerification" class="mb-0 text-medium-emphasis">
          Piszemy tylko na potwierdzone adresy, więc wyślemy też link
          potwierdzający na {{ user?.email }}.
        </p>
      </v-card-text>
      <v-card-actions class="px-4 pb-4 pt-0 flex-wrap ga-2">
        <v-btn
          color="ink-sage"
          variant="flat"
          :loading="saving === 'yes'"
          :disabled="saving !== null"
          data-mail-opt-in-yes
          @click="answer(true)"
        >
          Tak, zapisz mnie
        </v-btn>
        <v-btn
          variant="text"
          :loading="saving === 'no'"
          :disabled="saving !== null"
          data-mail-opt-in-no
          @click="answer(false)"
        >
          Nie, dziękuję
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-snackbar v-model="snackbar" :color="snackbarColor" timeout="6000">
      {{ snackbarText }}
    </v-snackbar>
  </ClientOnly>
</template>

<script setup lang="ts">
import { sendEmailVerification } from "firebase/auth";
import { doc, getFirestore, setDoc } from "firebase/firestore";
import { useFirebaseApp } from "vuefire";
import { useAuthState } from "@/composables/auth";
import { trackGoal } from "~/composables/analytics";
import { mailPromptAnswered } from "~~/shared/campaigns";

const { user, userConfig, isAdmin } = useAuthState();
const route = useRoute();
const firestore = getFirestore(useFirebaseApp(), "koryta-pl");

/** Pages that already speak about mail, or where a reader is mid-way through
 * something else: /profil has the switches themselves, /wypisz is a reader
 * leaving a list, and /login is not somewhere to be asked anything. */
const QUIET_PATHS = ["/profil", "/wypisz", "/login"];

/** Set once this tab has an answer, so the card does not wait for the
 * document listener to come back before it goes. */
const answered = ref(false);
const saving = ref<"yes" | "no" | null>(null);

const visible = computed(() => {
  if (!user.value || answered.value) return false;
  // Administrators get campaigns as team mail and turn that off in /profil.
  // `isAdmin` is undefined until the token is read, which keeps the card away
  // from them during that moment too.
  if (isAdmin.value !== false) return false;
  // undefined while the document is in flight, null when it does not exist:
  // only the second is a reader who has never answered.
  const config = userConfig?.data?.value;
  if (config === undefined || mailPromptAnswered(config)) return false;
  return !QUIET_PATHS.includes(route.path.replace(/\/+$/, ""));
});

const needsVerification = computed(() => user.value?.emailVerified === false);

watch(
  visible,
  (shown) => {
    if (shown) trackGoal("mail-prompt:shown");
  },
  { immediate: true },
);

const snackbar = ref(false);
const snackbarText = ref("");
const snackbarColor = ref<"success" | "error">("success");
const notify = (text: string, color: "success" | "error" = "success") => {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
};

/** Writes the answer where /profil keeps the switches - both topics, as the
 * card offers them as one - and asks for a confirmed address on a yes from an
 * account that has none, since nothing is ever sent to an unconfirmed one. */
async function answer(yes: boolean) {
  if (!user.value) return;
  saving.value = yes ? "yes" : "no";
  try {
    await setDoc(
      doc(firestore, "users", user.value.uid),
      { newsletter: { callsToAction: yes, recentPeople: yes } },
      { merge: true },
    );
    answered.value = true;
    trackGoal("mail-prompt:answer", { answer: yes ? "yes" : "no" });
  } catch (error) {
    console.error("Failed to save the mail answer:", error);
    notify("Nie udało się zapisać odpowiedzi. Spróbuj ponownie.", "error");
    saving.value = null;
    return;
  }

  if (!yes) {
    notify("Jasne, nie będziemy pisać. Zdanie zmienisz w profilu.");
  } else if (needsVerification.value) {
    try {
      await sendEmailVerification(user.value);
      notify(
        `Zapisano. Wysłaliśmy link potwierdzający na ${user.value.email} - kliknij go, a maile zaczną dochodzić.`,
      );
    } catch (error) {
      console.error("Failed to send the verification email:", error);
      notify(
        "Zapisano, ale nie udało się wysłać linku potwierdzającego. Wyślesz go z profilu.",
        "error",
      );
    }
  } else {
    notify("Zapisano. Odezwiemy się mailem.");
  }
  saving.value = null;
}
</script>

<style scoped>
/* Fixed rather than in the page's flow, so no page moves when it shows up or
   goes away. Above the footer and the page's own cards, below dialogs. */
.mail-opt-in {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 1004;
  width: calc(100vw - 32px);
}

/* On a phone the „Zgłoś” button sits in the same bottom strip; lift the card
   clear of it rather than cover it. */
@media (max-width: 599px) {
  .mail-opt-in {
    bottom: 72px;
  }
}
</style>
