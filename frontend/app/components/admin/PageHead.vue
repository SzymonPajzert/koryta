<template>
  <header class="apage-head">
    <div v-if="$slots.back" class="apage-head__back">
      <slot name="back" />
    </div>
    <div class="apage-head__row">
      <div class="apage-head__text">
        <div class="apage-head__title">
          <h1>{{ title }}</h1>
          <InfoBubble v-if="info || $slots.info" :label="title">
            <slot name="info">{{ info }}</slot>
          </InfoBubble>
        </div>
        <p v-if="lead || $slots.lead" class="k-page-lead apage-head__lead">
          <slot name="lead">{{ lead }}</slot>
        </p>
      </div>
      <div v-if="$slots.actions" class="apage-head__actions">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
// Imported rather than auto-imported, as in PageSection: a plain `mount` in a
// unit test has no resolver, and an unresolved bubble renders as nothing.
import InfoBubble from "../InfoBubble.vue";

/** The top of a working page: its title, the one sentence under it, the rest
 * of the explanation behind the „(i)”, and the page's own buttons on the
 * right.
 *
 * Each admin page used to write its own: an `h1` still carrying the Vuetify
 * size it was set in before type.css, a lead in 14px body text that ran to
 * four sentences on /qa, and a gap under it of whatever `mb-*` the page
 * happened to pass. The public pages' rule is one title, one sentence of lead
 * (`k-page-lead`), method behind the bubble - so it lives here once, and the
 * page passes words.
 *
 * Slots: `back` - a link up a level, above the title, and room at the end of
 * that line for a small tool that must not cost a phone a line of its own
 * (the notes queue's „Cofnij”); `info` - the bubble's text when it is more
 * than a string; `lead` - when the sentence holds a link; `actions` - the
 * page's buttons, which wrap under the title on a phone. */
defineProps<{
  title: string;
  /** The one sentence under the title. */
  lead?: string;
  /** The rest of the explanation, behind the „(i)” beside the title. Nothing
   * a reader needs in order to use the page goes here. */
  info?: string;
}>();
</script>

<style scoped>
.apage-head {
  margin-bottom: 24px;
}

.apage-head__back {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

/* A text button's label sits 8px inside its own padding; the way back is
 * pulled out by that much so its arrow starts on the title's edge, not in
 * from it. One rule here rather than an `ms-n2` each page has to remember. */
.apage-head__back > :deep(.v-btn--variant-text:first-child) {
  margin-inline-start: -8px;
}

.apage-head__row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px 24px;
}

.apage-head__text {
  flex: 1 1 320px;
  min-width: 0;
}

/* The title runs inline and the bubble follows its last word, wherever a
 * long title wraps: as a flex row's second item it stood at the far end of
 * the first line on a phone („QA – zmiany (i) / do sprawdzenia”). It stays
 * outside the h1, so the heading's name is the title alone. Balanced here,
 * on the block, since an inline h1 cannot balance its own lines. */
.apage-head__title {
  line-height: 1.1;
  text-wrap: balance;
}

.apage-head__title h1 {
  display: inline;
  margin: 0;
}

.apage-head__title :deep(.sec-head__info) {
  margin-inline-start: 8px;
  vertical-align: baseline;
}

.apage-head__lead {
  margin: 8px 0 0;
}

/* The buttons centre on the title's first line, 44px at 40/1.1. */
.apage-head__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}

@media (max-width: 599.98px) {
  .apage-head {
    margin-bottom: 16px;
  }

  /* 28/1.1 on a phone. */
  .apage-head__actions {
    min-height: 0;
  }
}
</style>
