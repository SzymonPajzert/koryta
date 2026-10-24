<template>
  <!-- Where a party chip would stand, the size of one, for a person whose
       party a logged out reader is not shown: the page knows there is one and
       says so, and the chip is the way to sign in for it. A link, so it takes
       the keyboard and a middle click like any other.

       The word under the blur is the same for everybody - never the party,
       which is not in the page at all (`/api/edges/successions` sends only
       that there is one). The blur draws a word that cannot be read; taking
       the filter off in the browser's tools gives „Partia”. -->
  <NuxtLink
    :to
    class="party-locked"
    :class="{ 'party-locked--label': label }"
    :aria-label="title"
    :title
    rel="nofollow"
    data-testid="party-locked"
    data-nosnippet
    @click="emit('click')"
  >
    <v-icon :icon="mdiLockOutline" size="13" class="party-locked__icon" />
    <span v-if="label" class="party-locked__text">partia po zalogowaniu</span>
    <span v-else class="party-locked__smudge" aria-hidden="true">Partia</span>
  </NuxtLink>
</template>

<script setup lang="ts">
import { mdiLockOutline } from "@mdi/js";
import type { RouteLocationRaw } from "vue-router";

/** The stand-in for a party chip (`PartyChip`) that a logged out reader is not
 * shown, leading to the sign in. `label` spells out what it is instead of
 * drawing a blurred word. */
defineProps<{
  to: RouteLocationRaw;
  label?: boolean;
}>();

const emit = defineEmits<{ click: [] }>();

const title = "Powiązanie polityczne widoczne po zalogowaniu";
</script>

<style scoped>
/* `PartyChip`'s box - its padding, radius and weight - so the stand-in takes
   the room a chip takes, in the muted pair `shared/colors.ts` gives inactive
   chips: ink.neutral on surface.muted, 5.75:1. */
.party-locked {
  align-items: center;
  align-self: center;
  background: rgb(var(--v-theme-surface-muted));
  border-radius: 0.3rem;
  color: rgb(var(--v-theme-ink-neutral));
  display: inline-flex;
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

/* Pointed at, the chip is ringed in its own ink and the lock goes dark: it is
   a way in, not a label. */
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

/* A word drawn as a smudge, in body ink so it reads as a word held back
   rather than as an empty pill: beside a party's coloured chip the neutral
   ink blurred to nothing. `user-select: none`, so a copy of the name and its
   chips does not carry „Partia” along as if it were one. */
.party-locked__smudge {
  color: rgb(var(--v-theme-ink-strong));
  filter: blur(3px);
  user-select: none;
}

/* Spelled out at the 12px of the card's meta line, so it reads as a note on
   the name rather than as a second name. */
.party-locked--label {
  font-size: 0.75rem;
}
</style>
