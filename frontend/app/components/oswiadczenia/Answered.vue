<template>
  <p class="ow-answered" data-testid="declaration-answered">
    <v-icon
      :icon="crop.verdict === 'skip' ? mdiArrowRight : mdiCheck"
      size="16"
      class="ow-answered__icon"
      :class="{ 'ow-answered__icon--kept': crop.verdict !== 'skip' }"
    />
    <span>
      <template v-if="crop.verdict === 'skip'">Pominięte</template>
      <template v-else>
        Zapisane: <strong class="ow-answered__what">{{ words }}</strong>
      </template>
    </span>
    <span v-if="crop.settled" class="ow-answered__settled">
      <span class="ow-answered__sep" aria-hidden="true">·</span>
      ten wycinek ma już komplet odczytów
    </span>
  </p>
</template>

<script setup lang="ts">
import { mdiArrowRight, mdiCheck } from "@mdi/js";
import type { AnsweredCrop } from "~/composables/declarationQueue";
import { answerWords } from "~/utils/declarationReading";

/** The quiet line under the next crop about the one just answered. Its
 * declaration is not linked here: a link under the next crop reads as that
 * crop's, so each crop's own is on its card (`TaskCard`). */
const props = defineProps<{ crop: AnsweredCrop }>();

const words = computed(() => answerWords(props.crop.verdict, props.crop.value));
</script>

<style scoped>
.ow-answered {
  align-items: center;
  color: rgb(var(--v-theme-ink-neutral));
  column-gap: 6px;
  display: flex;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  line-height: 1.25rem;
  margin: 0;
  row-gap: 2px;
}

.ow-answered__icon--kept {
  color: rgb(var(--v-theme-ink-success));
}

.ow-answered__what {
  color: rgb(var(--v-theme-ink-strong));
  font-weight: 500;
}

.ow-answered__sep {
  opacity: 0.6;
}
</style>
