<template>
  <!-- Back to the form only once the dialog is out of sight, so it does not
       flash up while the answered question fades. -->
  <v-dialog v-model="dialog" max-width="500" @after-leave="stage = 'form'">
    <template #activator="{ props: activatorProps }">
      <slot name="activator" :props="activatorProps">
        <v-btn v-if="!hideActivator" v-bind="activatorProps" color="primary">
          Zaloguj się
        </v-btn>
      </slot>
    </template>

    <!-- Right after signing in or creating an account here, a reader
         outside the team who never answered the newsletter question gets it
         in place of the form. Closing the dialog instead counts as "not now":
         the page goes on as after any sign-in. -->
    <v-card v-if="stage === 'signedIn'" data-login-newsletter>
      <div class="d-flex justify-end pt-2 px-2">
        <v-btn
          icon
          variant="text"
          size="small"
          aria-label="Zamknij"
          @click="dialog = false"
        >
          <v-icon :icon="mdiClose" />
        </v-btn>
      </div>
      <v-card-text class="pt-0">
        <MailNewsletterSignInStep :signed-up="signedUp" @done="finish" />
      </v-card-text>
    </v-card>

    <v-card v-else>
      <v-card-title class="d-flex justify-space-between align-center">
        <span>{{ isLogin ? "Zaloguj się" : "Rejestracja" }}</span>
        <v-btn icon variant="text" @click="dialog = false">
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>
      <v-card-text>
        <div class="mb-4 text-center">
          <a href="javascript:void(0)" @click="isLogin = !isLogin">
            {{
              isLogin
                ? "Nie masz konta? Zarejestruj się"
                : "Masz już konto? Zaloguj się"
            }}
          </a>
        </div>
        <FormLoginForm :is-login="isLogin" @success="onLoginSuccess" />
        <div class="mt-4 text-center text-caption">
          {{ isLogin ? "Logowanie się" : "Rejestracja" }} oznacza zgodę z
          <a href="/plik/regulamin" target="_blank" rel="noopener"
            >regulaminem</a
          >
          oraz
          <a href="/plik/polityka_prywatnosci" target="_blank" rel="noopener"
            >polityką prywatności</a
          >.
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-snackbar v-model="snackbar" timeout="6000" data-login-snackbar>
    {{ snackbarText }}
  </v-snackbar>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { mdiClose } from "@mdi/js";
import { useCurrentUser } from "vuefire";
import { signedInAs, useSignInMethod } from "~/composables/signInMethod";
import { countSignInOnScreen } from "~/composables/signInOnScreen";

const dialog = defineModel<boolean>();
const props = withDefaults(
  defineProps<{
    hideActivator?: boolean;
    /** The form it opens on, each time it opens: "signup" for a button that
     * says „Rejestracja”, which should not land the reader on a login form
     * they have no account for (/login?konto=nowe does the same). Absent, it
     * opens on whichever form it was left on. */
    form?: "login" | "signup";
  }>(),
  {
    hideActivator: false,
    form: undefined,
  },
);
const isLogin = ref(props.form !== "signup");

const emit = defineEmits<{
  (e: "success"): void;
}>();

const user = useCurrentUser();
const signInMethod = useSignInMethod();

const stage = ref<"form" | "signedIn">("form");
/** The sign-in that got here created the account. */
const signedUp = ref(false);

const snackbar = ref(false);
const snackbarText = ref("");

// On screen until its note has gone too: a page with a line of its own for
// the foot of the window holds it while the dialog is (`useSignInOnScreen`).
countSignInOnScreen(() => !!dialog.value || snackbar.value);

/** `success` has gone out for this sign-in. */
let finished = false;

/** Closes the dialog and lets the page go on with whatever the sign-in was
 * for - opening the form somebody wanted, say. */
function finish(note?: string) {
  finished = true;
  dialog.value = false;
  if (note) {
    snackbarText.value = note;
    snackbar.value = true;
  }
  emit("success");
}

const onLoginSuccess = async () => {
  // Let the auth state propagate through firebase/vuefire
  await new Promise((resolve) => setTimeout(resolve, 500));
  // Closed while that happened: the page goes on as after any sign-in.
  if (!dialog.value) {
    finish();
    return;
  }
  signedUp.value =
    signedInAs(signInMethod.value, user.value?.metadata) === "signup";
  stage.value = "signedIn";
};

// Closed without an answer: the sign-in still happened, so the page goes on.
watch(dialog, (open) => {
  if (open) {
    finished = false;
    if (props.form) isLogin.value = props.form === "login";
  } else if (stage.value === "signedIn" && !finished) {
    finish();
  }
});
</script>
