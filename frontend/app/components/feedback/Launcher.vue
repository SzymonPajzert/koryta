<template>
  <ClientOnly>
    <!-- Narrow screens get the icon with no label beside it, so the button is
         named here rather than being announced as an unlabelled control. -->
    <v-btn
      :icon="mdAndUp ? undefined : mdiMessageAlertOutline"
      :prepend-icon="mdAndUp ? mdiMessageAlertOutline : undefined"
      color="primary"
      position="fixed"
      location="bottom end"
      class="feedback-fab"
      :size="mdAndUp ? 'default' : 'small'"
      aria-label="Zgłoś błąd lub pomysł"
      @click="open = true"
    >
      <span v-if="mdAndUp">Zgłoś</span>
    </v-btn>

    <FeedbackDialog v-model="open" />
  </ClientOnly>
</template>

<script setup lang="ts">
import { mdiMessageAlertOutline } from "@mdi/js";
import { useDisplay } from "vuetify";
import { useFeedbackDialog } from "~/composables/feedbackDialog";

const { mdAndUp } = useDisplay();
// Shared, so „Zgłoś błąd albo podrzuć pomysł” on the home call to action and
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
