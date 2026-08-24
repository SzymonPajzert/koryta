<template>
  <div class="d-flex flex-column ga-1">
    <NuxtLink
      v-if="proposal.targetPath"
      :to="proposal.targetPath"
      class="link-plain text-body-2 font-weight-medium"
    >
      {{ name }}
    </NuxtLink>
    <span v-else class="text-body-2 font-weight-medium">{{ name }}</span>

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
      color: "error",
      icon: mdiTrashCanOutline,
    });
  } else {
    chips.push(
      proposal.published
        ? { label: "Opublikowana", color: "success", icon: mdiEarth }
        : {
            label: "Nieopublikowana",
            color: "grey",
            icon: mdiEyeOffOutline,
          },
    );
  }

  if (proposal.kind === "create") {
    chips.push({
      label: "Nowy wpis",
      color: "info",
      icon: mdiPlusCircleOutline,
    });
  }
  if (proposal.kind === "removal") {
    chips.push({
      label: "Wniosek o usunięcie",
      color: "error",
      icon: mdiDeleteOutline,
    });
  }
  if (proposal.targetCollection === "edges") {
    chips.push({
      label: "Powiązanie",
      color: "secondary",
      icon: mdiLinkVariant,
    });
  }

  return chips;
});
</script>
