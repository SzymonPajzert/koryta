<template>
  <div class="d-flex flex-wrap ga-2 mb-3" data-report-screenshots>
    <button
      v-for="(shot, index) in screenshots"
      :key="index"
      type="button"
      class="fb-shots__thumb"
      :style="{ aspectRatio: `${shot.width} / ${shot.height}` }"
      :title="`Zrzut ekranu ${index + 1}, ${shot.width}×${shot.height}`"
      :aria-label="`Powiększ zrzut ekranu ${index + 1}`"
      :disabled="!urls[index]"
      data-report-screenshot
      @click="shown = index"
    >
      <img
        v-if="urls[index]"
        :src="urls[index]!"
        :alt="`Zrzut ekranu ${index + 1}`"
        class="fb-shots__image"
      />
      <v-icon
        v-else-if="urls[index] === null"
        :icon="mdiImageBrokenVariant"
        color="ink-neutral"
        title="Nie udało się wczytać zrzutu ekranu"
      />
      <v-progress-circular v-else indeterminate size="20" width="2" />
    </button>

    <!-- As wide as the dialog allows, and scrolled rather than shrunk: a
         capture of a whole page is tall, and fitted to the window its text
         would be too small to read. -->
    <v-dialog
      :model-value="shownUrl !== undefined"
      max-width="min(1400px, 96vw)"
      scrollable
      @update:model-value="(open: boolean) => !open && (shown = undefined)"
    >
      <v-card v-if="shownUrl">
        <v-card-text class="pa-0">
          <img
            :src="shownUrl"
            :alt="`Zrzut ekranu ${shown! + 1}`"
            class="fb-shots__full"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn
            :href="shownUrl"
            target="_blank"
            variant="text"
            :prepend-icon="mdiOpenInNew"
          >
            Otwórz w nowej karcie
          </v-btn>
          <v-spacer />
          <v-btn variant="text" @click="shown = undefined">Zamknij</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { mdiImageBrokenVariant, mdiOpenInNew } from "@mdi/js";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { fetchFeedbackScreenshot } from "~/composables/feedbackAdmin";
import type { FeedbackScreenshot } from "~~/shared/model";

/** The images attached to a report, in the open row of the admin list: small
 * enough to sit beside the message, whole in a dialog on a click.
 *
 * Loaded when the row opens, which is when this is mounted - a list of a
 * hundred reports should not download every screenshot in it - and let go when
 * it closes. */
const props = defineProps<{
  reportId: string;
  screenshots: FeedbackScreenshot[];
}>();

/** An object url per image: undefined while loading, null if it failed. */
const urls = ref<(string | null | undefined)[]>([]);
const shown = ref<number>();
const shownUrl = computed(() =>
  shown.value === undefined
    ? undefined
    : (urls.value[shown.value] ?? undefined),
);

let unmounted = false;

onMounted(() => {
  props.screenshots.forEach(async (_, index) => {
    try {
      const blob = await fetchFeedbackScreenshot(props.reportId, index);
      const url = URL.createObjectURL(blob);
      if (unmounted) URL.revokeObjectURL(url);
      else urls.value[index] = url;
    } catch (error) {
      console.error("Failed to load a feedback screenshot", error);
      urls.value[index] = null;
    }
  });
});

onBeforeUnmount(() => {
  unmounted = true;
  for (const url of urls.value) if (url) URL.revokeObjectURL(url);
});
</script>

<style scoped>
.fb-shots__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96px;
  max-width: 240px;
  min-width: 48px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  cursor: zoom-in;
}

.fb-shots__thumb:disabled {
  cursor: default;
}

.fb-shots__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top left;
}

.fb-shots__full {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
</style>
