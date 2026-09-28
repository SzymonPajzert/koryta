<template>
  <div class="mb-3">
    <div v-if="attached.length > 0" class="d-flex flex-wrap ga-2 mb-2">
      <div
        v-for="(item, index) in attached"
        :key="item.key"
        class="fb-shot"
        data-screenshot-preview
      >
        <img
          v-if="item.screenshot"
          :src="item.screenshot.dataUrl"
          :alt="`Zrzut ekranu ${index + 1}`"
          class="fb-shot__image"
        />
        <v-progress-circular
          v-else
          indeterminate
          size="24"
          width="2"
          aria-label="Przygotowuję obraz"
        />
        <!-- Dark, so it reads on any picture, and inside the corner rather
             than hanging off it. -->
        <v-btn
          class="fb-shot__remove"
          icon
          size="x-small"
          density="comfortable"
          variant="flat"
          color="grey-darken-4"
          :aria-label="`Usuń zrzut ekranu ${index + 1}`"
          @click="emit('remove', item.key)"
        >
          <v-icon :icon="mdiClose" size="14" />
        </v-btn>
      </div>
    </div>

    <div v-if="!full" class="d-flex align-center flex-wrap ga-2">
      <v-btn
        size="small"
        variant="tonal"
        :prepend-icon="mdiImagePlus"
        @click="input?.click()"
      >
        Dołącz zrzut ekranu
      </v-btn>
      <span class="fb-shot__paste text-caption text-medium-emphasis">
        albo wklej go tutaj ({{ pasteKeys }})
      </span>
    </div>

    <div v-if="error" class="text-caption text-error mt-1" role="alert">
      {{ error }}
    </div>
    <div
      v-else-if="attached.length > 0"
      class="text-caption text-medium-emphasis mt-1"
    >
      Wyślemy sam obraz, bez danych zapisanych w pliku, np. miejsca zrobienia
      zdjęcia.
    </div>

    <input
      ref="input"
      type="file"
      accept="image/*"
      multiple
      class="d-none"
      data-screenshot-input
      @change="onPicked"
    />
  </div>
</template>

<script setup lang="ts">
import { mdiClose, mdiImagePlus } from "@mdi/js";
import { onMounted, ref } from "vue";
import type { AttachedScreenshot } from "~/composables/feedbackScreenshots";

/** The images going with a report: a button to pick them, and previews to
 * take them off again. The list and what happens to a file are the dialog's -
 * see `useFeedbackScreenshots` - since pasting and dropping land on the whole
 * dialog, not on this. */
defineProps<{
  attached: AttachedScreenshot[];
  /** Why the last thing added was not. */
  error?: string;
  /** No room for another. */
  full?: boolean;
}>();

const emit = defineEmits<{
  add: [files: File[]];
  remove: [key: number];
}>();

const input = ref<HTMLInputElement>();
const pasteKeys = ref("Ctrl+V");

onMounted(() => {
  if (/Mac|iPhone|iPad/.test(navigator.userAgent)) pasteKeys.value = "⌘V";
});

function onPicked(event: Event) {
  const target = event.target as HTMLInputElement;
  emit("add", [...(target.files ?? [])]);
  // So that picking the same file again adds it again.
  target.value = "";
}
</script>

<style scoped>
.fb-shot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
}

.fb-shot__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 3px;
}

.fb-shot__remove {
  position: absolute;
  top: 3px;
  right: 3px;
  opacity: 0.85;
}

/* A phone has no keyboard shortcut to paste with. */
@media (pointer: coarse) {
  .fb-shot__paste {
    display: none;
  }
}
</style>
