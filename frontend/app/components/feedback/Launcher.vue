<template>
  <!-- „Zgłoś” in the app bar, at every width. It used to float in the bottom
       corner, where on a phone it covered text at 38-62% of scroll positions
       and on a desktop landed on the footer's icons.

       Both forms are drawn and the display classes pick one, rather than a
       width-driven `v-if`: under SSR Vuetify assumes a 1280px window, so a
       phone would get the desktop button in its html and swap it on hydration.
       `hidden-*` rather than `d-*-inline-flex`, which would have turned the
       button's own grid into a flex box. The word on a computer; on a phone
       the icon - with the word too where the bar has room for it (`labelled`:
       home, whose bar has no search). The aria-label says a little more than
       the word, and `aria-haspopup` that it opens a dialog. -->
  <v-btn
    class="feedback-launcher hidden-sm-and-down"
    aria-label="Zgłoś błąd lub pomysł"
    aria-haspopup="dialog"
    data-testid="feedback-launcher"
    @click="open = true"
  >
    Zgłoś
  </v-btn>
  <v-btn
    v-if="labelled"
    class="feedback-launcher feedback-launcher--labelled hidden-md-and-up"
    rounded="pill"
    :prepend-icon="mdiMessageAlertOutline"
    aria-label="Zgłoś błąd lub pomysł"
    aria-haspopup="dialog"
    data-testid="feedback-launcher-phone"
    @click="open = true"
  >
    Zgłoś
  </v-btn>
  <v-btn
    v-else
    class="feedback-launcher hidden-md-and-up"
    :icon="mdiMessageAlertOutline"
    aria-label="Zgłoś błąd lub pomysł"
    aria-haspopup="dialog"
    data-testid="feedback-launcher-phone"
    @click="open = true"
  />

  <ClientOnly>
    <FeedbackDialog v-model="open" />
  </ClientOnly>
</template>

<script setup lang="ts">
import { mdiMessageAlertOutline } from "@mdi/js";
import { useFeedbackDialog } from "~/composables/feedbackDialog";

defineProps<{
  /** Show the word beside the icon on a phone, for a bar with the room. */
  labelled?: boolean;
}>();

// Shared, so „Zgłoś błąd albo pomysł” on the home call to action and
// the card on /pomoc open this dialog rather than a second one of their own.
const open = useFeedbackDialog();
</script>

<style scoped>
/* The account group's ink: full, like „Zaloguj się” beside it. */
.feedback-launcher {
  color: rgb(var(--v-theme-ink-strong));
}

.feedback-launcher--labelled {
  padding: 0 14px 0 10px;
}
</style>
