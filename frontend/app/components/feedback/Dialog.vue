<template>
  <v-dialog v-model="open" max-width="560" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        Powiedz nam, co jest nie tak
        <v-spacer />
        <v-btn :icon="mdiClose" variant="text" size="small" @click="close" />
      </v-card-title>

      <v-card-text v-if="sent" class="text-center py-8">
        <v-icon :icon="mdiCheckCircleOutline" color="success" size="48" />
        <p class="text-body-1 mt-4">Dzięki! Zgłoszenie do nas dotarło.</p>
      </v-card-text>

      <v-card-text v-else>
        <v-chip-group v-model="kind" mandatory class="mb-2">
          <v-chip
            v-for="(config, value) in feedbackKindConfig"
            :key="value"
            :value="value"
            :color="config.color"
            variant="outlined"
          >
            <v-icon start :icon="config.icon" />
            {{ config.title }}
          </v-chip>
        </v-chip-group>

        <v-textarea
          v-model="message"
          :label="feedbackKindConfig[kind].hint"
          variant="outlined"
          rows="4"
          auto-grow
          counter="4000"
          :error-messages="error ? [error] : []"
          autofocus
        />

        <v-text-field
          v-model="contact"
          :label="
            user
              ? 'Twój e-mail (usuń, aby zgłosić anonimowo)'
              : 'E-mail (opcjonalnie, jeśli chcesz odpowiedź)'
          "
          variant="outlined"
          density="compact"
          clearable
          persistent-clear
          hide-details
          class="mb-1"
          @update:model-value="contactTouched = true"
          @click:clear="contactTouched = true"
        />

        <div class="text-caption text-medium-emphasis mb-3">
          <template v-if="signed">
            Zgłoszenie będzie podpisane Twoim kontem.
          </template>
          <template v-else-if="user">
            Wyślemy anonimowo — nie zapiszemy, że to Ty.
          </template>
        </div>

        <!-- Honeypot: hidden from people, irresistible to form-filling bots.
             Not `display: none`, which the better bots skip. -->
        <label class="feedback-honeypot" aria-hidden="true">
          Nie wypełniaj tego pola
          <input
            v-model="website"
            type="text"
            tabindex="-1"
            autocomplete="off"
          />
        </label>

        <div class="text-caption text-medium-emphasis">
          <div class="mb-1">Do zgłoszenia dołączymy:</div>
          <v-chip size="x-small" label class="mr-1 mb-1">
            <v-icon start :icon="mdiLinkVariant" />
            {{ context.route }}
          </v-chip>
          <v-chip v-if="context.pageTitle" size="x-small" label class="mb-1">
            {{ context.pageTitle }}
          </v-chip>
          <div class="mt-2">
            Zgłoszenia trzymamy tak długo, jak są nam potrzebne do poprawek. Nie
            podawaj w treści danych, których nie chcesz nam zostawiać.
          </div>
        </div>
      </v-card-text>

      <v-card-actions v-if="!sent">
        <v-spacer />
        <v-btn variant="text" @click="close">Anuluj</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="sending"
          :disabled="!message.trim()"
          @click="submit"
        >
          Wyślij
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { mdiClose, mdiCheckCircleOutline, mdiLinkVariant } from "@mdi/js";
import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  feedbackKindConfig,
  captureFeedbackContext,
  submitFeedback,
} from "~/composables/feedback";
import { useAuthState } from "~/composables/auth";
import { trackGoal } from "~/composables/analytics";
import type { FeedbackContext, FeedbackKind } from "~~/shared/model";

const open = defineModel<boolean>({ required: true });

const route = useRoute();
const { user } = useAuthState();

const kind = ref<FeedbackKind>("bug");
const message = ref("");
// Nullable: Vuetify's clearable button sets the model to null, and clearing is
// exactly the gesture that opts out of attribution here.
const contact = ref<string | null>("");
const contactTouched = ref(false);
const website = ref("");

/** A signed-in reporter who left their address in. Clearing the field is what
 * opts out, and it opts out of the account attribution too - see `submit`. */
const signed = computed(() => Boolean(user.value && contact.value?.trim()));
const context = ref<FeedbackContext>({ route: "" });
const sending = ref(false);
const sent = ref(false);
const error = ref("");

// Snapshot on open, so the report describes the page the reporter was looking
// at even if they navigate while the dialog is up.
watch(open, (isOpen) => {
  if (!isOpen) return;
  context.value = captureFeedbackContext(route);
  sent.value = false;
  error.value = "";
  // Prefill from the account, but never over a choice already made: someone
  // who cleared the field and then reopened the dialog meant it.
  if (!contactTouched.value) contact.value = user.value?.email ?? "";
});

const close = () => {
  open.value = false;
};

const submit = async () => {
  sending.value = true;
  error.value = "";

  const trimmedContact = contact.value?.trim() ?? "";

  try {
    // The same call the QA page makes - see composables/feedback.ts. Sending
    // without a token is what makes "anonimowo" true rather than a promise we
    // are keeping.
    await submitFeedback(
      {
        kind: kind.value,
        message: message.value,
        contact: trimmedContact || undefined,
        website: website.value || undefined,
        context: context.value,
      },
      { attribute: signed.value },
    );

    // After the call, so a report that never reached us is not counted as one
    // that did. `kind` is the chip; the message is somebody's words and stays
    // out of analytics entirely.
    trackGoal("feedback:sent", { kind: kind.value });

    sent.value = true;
    message.value = "";
    setTimeout(() => {
      if (sent.value) close();
    }, 1800);
  } catch (err) {
    console.error("Failed to send feedback", err);
    error.value = "Nie udało się wysłać. Spróbuj jeszcze raz.";
  } finally {
    sending.value = false;
  }
};
</script>

<style scoped>
/* Off-screen rather than hidden: bots that skip display:none still fill it. */
.feedback-honeypot {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
</style>
