<template>
  <v-dialog v-model="open" max-width="560" scrollable>
    <!-- A screenshot can be pasted or dropped anywhere on the form, not only
         on the button that picks one. -->
    <v-card @paste="onPaste" @dragover="onDragOver" @drop="onDrop">
      <v-card-title class="d-flex align-center">
        Powiedz nam, co jest nie tak
        <v-spacer />
        <v-btn :icon="mdiClose" variant="text" size="small" @click="close" />
      </v-card-title>

      <v-card-text v-if="sent" class="text-center py-8">
        <v-icon :icon="mdiCheckCircleOutline" color="success" size="48" />
        <p class="text-body-1 mt-4">Dzięki! Zgłoszenie do nas dotarło.</p>
        <p v-if="screenshotsDropped" class="text-body-2 mt-2">
          Zrzutów ekranu nie zapisaliśmy — na dziś przyjęliśmy ich już tyle, ile
          możemy. Jeśli było na nich coś ważnego, opisz to w kolejnym
          zgłoszeniu.
        </p>
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

        <FeedbackScreenshotPicker
          :attached="screenshots.attached.value"
          :error="screenshots.error.value"
          :full="screenshots.full.value"
          @add="screenshots.add"
          @remove="screenshots.remove"
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
            podawaj w treści ani na zrzutach ekranu danych, których nie chcesz
            nam zostawiać.
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
          :disabled="!message.trim() || screenshots.preparing.value"
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
import {
  filesIn,
  useFeedbackScreenshots,
} from "~/composables/feedbackScreenshots";
import { useAuthState } from "~/composables/auth";
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
const screenshots = useFeedbackScreenshots();
/** The report went, but the images it came with were not kept. */
const screenshotsDropped = ref(false);

const onPaste = (event: ClipboardEvent) => {
  if (sent.value) return;
  const data = event.clipboardData;
  // Copying from a spreadsheet or a document puts a picture of the selection
  // on the clipboard beside its text, and pasting that is pasting text.
  if (data && Array.from(data.types).includes("text/plain")) return;
  const images = filesIn(data).filter((file) => file.type.startsWith("image/"));
  if (images.length === 0) return;
  event.preventDefault();
  screenshots.add(images);
};

// Only a drag carrying files is taken over: text dragged into the message
// still lands there.
const carriesFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");

const onDragOver = (event: DragEvent) => {
  if (!sent.value && carriesFiles(event)) event.preventDefault();
};

const onDrop = (event: DragEvent) => {
  if (sent.value || !carriesFiles(event)) return;
  // Otherwise the browser leaves the page to show the file.
  event.preventDefault();
  screenshots.add(filesIn(event.dataTransfer));
};

// Snapshot on open, so the report describes the page the reporter was looking
// at even if they navigate while the dialog is up.
watch(open, (isOpen) => {
  if (!isOpen) return;
  context.value = captureFeedbackContext(route);
  sent.value = false;
  screenshotsDropped.value = false;
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
    const result = await submitFeedback(
      {
        kind: kind.value,
        message: message.value,
        contact: trimmedContact || undefined,
        website: website.value || undefined,
        context: context.value,
        screenshots: screenshots.ready.value.map(({ dataUrl }) => dataUrl),
      },
      { attribute: signed.value },
    );

    sent.value = true;
    screenshotsDropped.value = Boolean(result.screenshotsDropped);
    message.value = "";
    screenshots.clear();
    // Left open when there is more to read than the thanks.
    if (!screenshotsDropped.value) {
      setTimeout(() => {
        if (sent.value) close();
      }, 1800);
    }
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
