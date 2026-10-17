<template>
  <ClientOnly>
    <!-- The newsletter question, for signed-in readers who never answered it
         and were not asked as they signed in - a session kept from before, or
         a "not now" in an earlier visit. Campaigns reach a non-administrator
         only if they said yes (shared/campaigns.ts). Bottom start, clear of
         the „Zgłoś” button at bottom end. -->
    <v-card
      v-if="visible"
      class="mail-opt-in"
      rounded="lg"
      elevation="8"
      max-width="440"
      data-mail-opt-in
    >
      <v-card-text>
        <MailNewsletterQuestion
          where="prompt"
          compact
          title-tag="h2"
          @choosing="held = true"
          @answered="onAnswered"
        />
      </v-card-text>
    </v-card>

    <v-snackbar v-model="snackbar" timeout="6000">
      {{ snackbarText }}
    </v-snackbar>
  </ClientOnly>
</template>

<script setup lang="ts">
import {
  useNewsletterAskedOnSignIn,
  useNewsletterQuestion,
} from "~/composables/newsletter";

const route = useRoute();
const { due } = useNewsletterQuestion();
const askedOnSignIn = useNewsletterAskedOnSignIn();

/** Pages that already speak about mail, or where a reader is mid-way through
 * something else: /profil has the switches themselves, /wypisz is a reader
 * leaving a list, and /login asks the question itself, right after signing
 * in. */
const QUIET_PATHS = ["/profil", "/wypisz", "/login"];

/** Set once this tab has an answer, so the card does not wait for the
 * document listener to come back before it goes. */
const answered = ref(false);
/** The reader has pressed a button and the save is under way. Their answer
 * reaches the document - and turns `due` off - before the save returns, so
 * the card is kept until it has said how it went. */
const held = ref(false);

const visible = computed(() => {
  if (answered.value || askedOnSignIn.value) return false;
  // Unknown counts as no: the card never shows to an administrator, or to a
  // reader who answered, while their claims or document are still loading.
  if (due.value !== true && !held.value) return false;
  return !QUIET_PATHS.includes(route.path.replace(/\/+$/, ""));
});

const snackbar = ref(false);
const snackbarText = ref("");

function onAnswered({ note }: { note: string }) {
  answered.value = true;
  held.value = false;
  snackbarText.value = note;
  snackbar.value = true;
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
