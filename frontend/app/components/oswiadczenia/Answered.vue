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
    <template v-if="link">
      <span class="ow-answered__sep" aria-hidden="true">·</span>
      <a
        :href="link"
        target="_blank"
        rel="noopener"
        class="ow-answered__link"
        data-testid="declaration-document-link"
      >
        Zobacz całe oświadczenie
        <v-icon :icon="mdiOpenInNew" size="14" />
      </a>
      <span v-if="host" class="ow-answered__host">{{ host }}</span>
    </template>
    <span v-if="crop.settled" class="ow-answered__settled">
      <span class="ow-answered__sep" aria-hidden="true">·</span>
      ten wycinek ma już komplet odczytów
    </span>
  </p>
</template>

<script setup lang="ts">
import { mdiArrowRight, mdiCheck, mdiOpenInNew } from "@mdi/js";
import type { AnsweredCrop } from "~/composables/declarationQueue";
import { answerWords, documentHost } from "~/utils/declarationReading";

/** The quiet line about the crop just answered, and the only place its
 * declaration is linked: until the reader has answered, the form - which names
 * the person - would be a way to look the date up rather than read it. */
const props = defineProps<{ crop: AnsweredCrop }>();

const words = computed(() => answerWords(props.crop.verdict, props.crop.value));

/** An http(s) address only: the server checks it at upload, and a page that
 * puts a link in front of a reader checks it again. */
const link = computed(() =>
  /^https?:\/\//i.test(props.crop.documentUrl) ? props.crop.documentUrl : null,
);

const host = computed(() =>
  link.value ? documentHost(link.value, props.crop.host) : null,
);
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

.ow-answered__link {
  align-items: center;
  color: rgb(var(--v-theme-ink-info));
  display: inline-flex;
  gap: 2px;
  font-weight: 500;
  text-decoration: none;
}

.ow-answered__link:hover,
.ow-answered__link:focus-visible {
  text-decoration: underline;
}

.ow-answered__host {
  font-size: 0.75rem;
}

.ow-answered__sep {
  opacity: 0.6;
}
</style>
