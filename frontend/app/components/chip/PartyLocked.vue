<template>
  <!-- Where a party chip would stand, for a person whose party a logged out
       reader is not shown: the page knows there is one and says so, and the
       chip is the way to sign in for it. A link, so it takes the keyboard and
       a middle click like any other. Never the party itself, which is not in
       the page at all - `/api/edges/successions` sends only that there is
       one. „możliwe powiązania”, Szymon's words (2026-10-24): what is on
       record is a match nobody has checked yet. -->
  <NuxtLink
    :to
    class="party-locked"
    :aria-label="title"
    :title
    rel="nofollow"
    data-testid="party-locked"
    data-nosnippet
    @click="emit('click')"
  >
    <v-icon :icon="mdiLockOutline" size="13" class="party-locked__icon" />
    <span class="party-locked__text">możliwe powiązania</span>
  </NuxtLink>
</template>

<script setup lang="ts">
import { mdiLockOutline } from "@mdi/js";
import type { RouteLocationRaw } from "vue-router";

/** The stand-in for a party chip (`PartyChip`) that a logged out reader is not
 * shown, leading to the sign in. */
defineProps<{ to: RouteLocationRaw }>();

const emit = defineEmits<{ click: [] }>();

const title = "Możliwe powiązania polityczne, widoczne po zalogowaniu";
</script>

<style scoped>
/* `PartyChip`'s box - its padding and radius - so the stand-in takes the
   room a chip takes, in the muted pair `shared/colors.ts` gives inactive
   chips: ink.neutral on surface.muted, 5.75:1. At the 12px of the card's
   meta line, so it reads as a note on the name rather than a second name. */
.party-locked {
  align-items: center;
  align-self: center;
  background: rgb(var(--v-theme-surface-muted));
  border-radius: 0.3rem;
  color: rgb(var(--v-theme-ink-neutral));
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 550;
  gap: 4px;
  padding: 0.1rem 0.4rem;
  position: relative;
  text-decoration: none;
  white-space: nowrap;
}

/* A finger's worth of target round a chip 22px tall: 40px high, the box as
   drawn unchanged. */
.party-locked::before {
  content: "";
  inset: -9px -4px;
  position: absolute;
}

/* Pointed at, the chip is ringed in its own ink, the lock goes dark and the
   words are underlined: it is a way in, not a label. */
.party-locked:hover,
.party-locked:focus-visible {
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-ink-neutral));
}

.party-locked:hover .party-locked__icon,
.party-locked:focus-visible .party-locked__icon {
  color: rgb(var(--v-theme-ink-strong));
}

.party-locked:hover .party-locked__text,
.party-locked:focus-visible .party-locked__text {
  text-decoration: underline;
}

.party-locked:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-neutral));
  outline-offset: 2px;
}

.party-locked__icon {
  flex: none;
}
</style>
