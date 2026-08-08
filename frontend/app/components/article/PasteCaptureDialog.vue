<template>
  <v-dialog v-model="open" max-width="640">
    <v-card>
      <v-card-title class="text-subtitle-1">Wklej treść artykułu</v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          Dla artykułów za paywallem, których nasz crawler nie przeczyta. W
          przeglądarce otwórz artykuł, naciśnij Ctrl+U (lub zapisz stronę),
          skopiuj kod źródłowy i wklej go poniżej. Wygodniej robi to
          <NuxtLink to="/rozszerzenie">rozszerzenie do przeglądarki</NuxtLink>.
        </p>

        <v-text-field
          v-model="url"
          label="Adres URL artykułu"
          variant="outlined"
          density="compact"
          autocomplete="off"
          class="mb-3"
        />
        <v-textarea
          v-model="html"
          label="Kod źródłowy strony (HTML)"
          variant="outlined"
          rows="8"
          :hint="sizeHint"
          persistent-hint
        />

        <v-alert v-if="error" type="error" variant="tonal" class="mt-4">
          {{ error }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Anuluj</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="sending"
          :disabled="!url || !html"
          @click="submit"
        >
          Wyślij
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/** The extension-free way in.
 *
 * Worth keeping even once the extension is published: it is the path that works
 * on a browser nobody has installed anything into, and the only one an
 * end-to-end test can drive without a packed extension.
 */
import { computed, ref } from "vue";
import { submitCapturedHtml } from "~/composables/captures";
import { MAX_CAPTURE_HTML_BYTES } from "~~/shared/capture";

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ submitted: [pageId: string] }>();

const url = ref("");
const html = ref("");
const sending = ref(false);
const error = ref("");

const sizeHint = computed(() => {
  if (!html.value) return "Cały dokument, razem ze znacznikami <head>.";
  const kb = Math.round(new Blob([html.value]).size / 1024);
  return `${kb} kB`;
});

async function submit() {
  error.value = "";
  if (new Blob([html.value]).size > MAX_CAPTURE_HTML_BYTES) {
    error.value = "Ta strona jest za duża.";
    return;
  }

  sending.value = true;
  try {
    const result = await submitCapturedHtml({
      url: url.value.trim(),
      html: html.value,
    });
    emit("submitted", result.pageId);
    url.value = "";
    html.value = "";
    open.value = false;
  } catch (err) {
    error.value =
      (err as { data?: { message?: string } }).data?.message ||
      (err as Error).message;
  } finally {
    sending.value = false;
  }
}
</script>
