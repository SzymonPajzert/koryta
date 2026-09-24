<template>
  <div class="d-flex flex-column ga-1 target-cell">
    <NuxtLink
      v-if="proposal.targetPath"
      :to="proposal.targetPath"
      class="link-plain text-body-2 font-weight-medium target-cell__name"
      :title="name"
    >
      {{ name }}
    </NuxtLink>
    <span
      v-else
      class="text-body-2 font-weight-medium target-cell__name"
      :title="name"
      >{{ name }}</span
    >

    <div class="d-flex flex-wrap align-center ga-1">
      <v-chip
        v-for="chip in chips"
        :key="chip.label"
        :color="chip.color"
        :prepend-icon="chip.icon"
        size="x-small"
        variant="tonal"
      >
        {{ chip.label }}
      </v-chip>
    </div>
  </div>
</template>

<script setup lang="ts">
/** What a proposal is filed against, and how much a wrong answer would cost.
 *
 * The chips are the part a reviewer reads first: approving a change to a page
 * nobody can see is cheap, and approving one to a live page is not. A relation
 * and a deleted entry are called out because neither has a page to click
 * through to, so the missing link is the state of the data rather than a bug.
 *
 * Tonal chips paint their colour as the text, so the colours are the ink
 * tokens: Vuetify's `success`, `grey` and `info` read at 2.4-2.7:1 there, and
 * `secondary` - a pale pink - at barely more than 1.
 */
import { computed } from "vue";
import {
  mdiDeleteOutline,
  mdiEarth,
  mdiEyeOffOutline,
  mdiLinkVariant,
  mdiPlusCircleOutline,
  mdiTrashCanOutline,
} from "@mdi/js";
import type { Proposal } from "~~/shared/proposals";

const props = defineProps<{ proposal: Proposal }>();

const name = computed(
  () =>
    props.proposal.targetName ??
    (props.proposal.targetExists ? props.proposal.targetId : "Usunięty wpis"),
);

const chips = computed(() => {
  const proposal = props.proposal;
  const chips: { label: string; color: string; icon: string }[] = [];

  if (!proposal.targetExists) {
    // Nothing to approve this onto. Said first, because it makes every other
    // chip beside it moot.
    chips.push({
      label: "Wpis nie istnieje",
      color: "ink-danger",
      icon: mdiTrashCanOutline,
    });
  } else {
    chips.push(
      proposal.published
        ? { label: "Opublikowana", color: "ink-success", icon: mdiEarth }
        : {
            label: "Nieopublikowana",
            color: "ink-neutral",
            icon: mdiEyeOffOutline,
          },
    );
  }

  if (proposal.kind === "create") {
    chips.push({
      label: "Nowy wpis",
      color: "ink-sage",
      icon: mdiPlusCircleOutline,
    });
  }
  if (proposal.kind === "removal") {
    chips.push({
      label: "Wniosek o usunięcie",
      color: "ink-danger",
      icon: mdiDeleteOutline,
    });
  }
  if (proposal.targetCollection === "edges") {
    chips.push({
      label: "Powiązanie",
      color: "ink-info",
      icon: mdiLinkVariant,
    });
  }

  return chips;
});
</script>

<style scoped>
/* A table column is as wide as its widest cell, and an article's title is the
 * widest thing a proposal can be filed against - one of them pushed every
 * other column of the review queue off the useful part of the screen. A
 * max-width on the td would be ignored under the table's auto layout, so the
 * cap lives on this div, which is the cell's only child. The title attribute
 * keeps the part that no longer fits readable. */
.target-cell {
  max-width: 320px;
}

.target-cell__name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  /* Names are not always prose: an id or a url has no space to break at. */
  overflow-wrap: anywhere;
}
</style>
