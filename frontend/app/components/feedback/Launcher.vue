<template>
  <ClientOnly>
    <!-- The same button at every width. Phones used to get the icon alone, but
         the label's slot was still there, and VBtn draws a default slot in
         place of its icon even when the slot renders nothing - so a phone got
         a blank disc, reported as „a dot with no Zgłoś on it”. The label says
         what the button is for; the aria-label says a little more. -->
    <v-btn
      :prepend-icon="mdiMessageAlertOutline"
      color="primary"
      position="fixed"
      location="bottom end"
      class="feedback-fab"
      aria-label="Zgłoś błąd lub pomysł"
      @click="open = true"
    >
      Zgłoś
    </v-btn>

    <FeedbackDialog v-model="open" />
  </ClientOnly>
</template>

<script setup lang="ts">
import { mdiMessageAlertOutline } from "@mdi/js";
import { useFeedbackDialog } from "~/composables/feedbackDialog";

// Shared, so „Zgłoś błąd albo pomysł” on the home call to action and
// the card on /pomoc open this dialog rather than a second one of their own.
const open = useFeedbackDialog();
</script>

<style scoped>
/* Clear of the footer's bottom edge and of Vuetify's default FAB inset. */
.feedback-fab {
  margin: 0 16px 16px 0;
  z-index: 1005;
}
</style>
