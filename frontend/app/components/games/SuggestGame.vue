<template>
  <v-card variant="outlined" class="pa-4" data-testid="suggest-game">
    <h2 class="text-h6 font-weight-bold mb-1">Zaproponuj grę</h2>
    <p class="text-body-2 text-medium-emphasis mb-3">
      Masz pomysł na kolejną codzienną zagadkę? Napisz, na czym miałaby polegać
      — czytamy wszystkie zgłoszenia, a kolejne gry powstają właśnie z nich.
    </p>

    <template v-if="sent">
      <v-alert
        type="success"
        variant="tonal"
        data-testid="suggest-game-sent"
        text="Dzięki! Pomysł trafił do nas."
      />
    </template>

    <template v-else>
      <v-textarea
        v-model="message"
        label="Na czym polega gra?"
        placeholder="np. zgadywanie, z której partii jest osoba, po samym CV"
        rows="3"
        counter="4000"
        :maxlength="4000"
        :disabled="sending"
        auto-grow
        data-testid="suggest-game-message"
      />
      <v-text-field
        v-model="contact"
        label="Kontakt (opcjonalnie)"
        placeholder="e-mail, jeśli chcesz odpowiedź"
        :maxlength="200"
        :disabled="sending"
        density="comfortable"
      />

      <!-- Honeypot: hidden from people, irresistible to form-filling bots. Not
           `display: none`, which the better bots skip. Same field name the
           feedback dialog uses, because it is the same route that reads it. -->
      <label class="suggest-honeypot" aria-hidden="true">
        Nie wypełniaj tego pola
        <input v-model="website" type="text" tabindex="-1" autocomplete="off" />
      </label>

      <v-btn
        color="primary"
        variant="flat"
        :loading="sending"
        :disabled="!message.trim()"
        data-testid="suggest-game-submit"
        @click="send"
      >
        Wyślij pomysł
      </v-btn>

      <v-alert
        v-if="failed"
        class="mt-3"
        type="error"
        variant="tonal"
        text="Nie udało się wysłać. Spróbuj ponownie za chwilę."
      />
    </template>
  </v-card>
</template>

<script lang="ts" setup>
import { submitFeedback } from "~/composables/feedback";

/** "Zaproponuj grę" on the /gry hub.
 *
 * Files into the existing `feedback` collection as an `idea`, rather than into
 * a collection of its own. A new one would need a rules block, an index, an
 * admin route and page, an entry in the nightly export and its own Slack
 * function - all so that a suggestion could arrive somewhere nobody is already
 * looking. `context.route` is `/gry`, which is what tells these apart from
 * ideas submitted anywhere else on the site.
 *
 * Anonymous on purpose: this sits at the bottom of a page whose whole point is
 * that you can play without an account.
 */
const message = ref("");
const contact = ref("");
const website = ref("");
const sending = ref(false);
const sent = ref(false);
const failed = ref(false);

const route = useRoute();

async function send() {
  if (!message.value.trim() || sending.value) return;
  sending.value = true;
  failed.value = false;
  try {
    await submitFeedback(
      {
        kind: "idea",
        message: message.value.trim(),
        ...(contact.value.trim() ? { contact: contact.value.trim() } : {}),
        ...(website.value ? { website: website.value } : {}),
        context: {
          route: route.path,
          pageTitle: "Gry — propozycja gry",
        },
      },
      { attribute: false },
    );
    sent.value = true;
  } catch {
    failed.value = true;
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.suggest-honeypot {
  height: 1px;
  left: -9999px;
  overflow: hidden;
  position: absolute;
  width: 1px;
}
</style>
