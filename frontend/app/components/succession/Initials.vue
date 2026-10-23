<template>
  <!-- Hidden from a screen reader: the name it stands for is read out right
       beside it, and „MP Marcin Protas” says the name twice. -->
  <span class="initials" :class="`initials--${tone}`" aria-hidden="true">{{
    letters
  }}</span>
</template>

<script lang="ts" setup>
/** Stands in for a photograph nobody has, as on `card/Employment.vue`: the
 * first letters of the first two words of a name, on a 34px disc.
 *
 * One component because the current board's cards and the handover rows of
 * both pages draw it, and the tone is what it says: `out` is grey, for whoever
 * left the post; `in` is the sage of the accent rail, for whoever holds it. */
const props = defineProps<{
  name: string;
  tone: "in" | "out";
}>();

const letters = computed(() =>
  (props.name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join(""),
);
</script>

<style scoped>
.initials {
  border-radius: 50%;
  display: grid;
  flex: 0 0 auto;
  font-size: var(--k-meta-size);
  font-weight: 700;
  height: 34px;
  place-items: center;
  width: 34px;
}

/* The control tint: the post was left. */
.initials--out {
  background: var(--k-tonal);
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
}

/* Sage as a fill behind ink, never as ink: the post is theirs now. */
.initials--in {
  background: rgb(var(--v-theme-primary));
  color: rgba(var(--v-theme-on-surface), 0.87);
}
</style>
