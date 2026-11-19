<template>
  <v-menu
    v-if="answer"
    location="bottom start"
    max-width="360"
    :close-on-content-click="false"
    :disabled="reasonParts.length === 0"
  >
    <template #activator="{ props: menuProps }">
      <v-chip
        v-bind="menuProps"
        :prepend-icon="answer.icon"
        size="x-small"
        variant="outlined"
        data-testid="company-paid-seats"
      >
        {{ answer.label }}
      </v-chip>
    </template>
    <v-card class="pa-4 text-body-2" data-testid="company-paid-seats-reason">
      <div class="text-caption text-medium-emphasis mb-1">Skąd to wiadomo</div>
      <p class="paid-seats-reason">
        <template v-for="(part, index) in reasonParts" :key="index">
          <a
            v-if="part.href"
            :href="part.href"
            target="_blank"
            rel="noopener"
            class="text-decoration-underline"
            >{{ part.text }}</a
          >
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
    </v-card>
  </v-menu>
</template>

<script lang="ts" setup>
import { mdiCashMultiple, mdiCashOff } from "@mdi/js";
import type { Company } from "~~/shared/model";

/** Whether a seat at this institution is paid, by its own statute, and the
 * reason somebody gave: `Company.paidSeats`, as a chip beside the ownership
 * one, the reason opening from it (picked on round platne-funkcje-r1,
 * decision on 2026-11-20). Nothing where nobody has said, which is nearly
 * every company: there the legal form's rule stands, and a chip saying
 * „nie wiadomo” on every card would be noise. */
const props = defineProps<{
  company: Pick<Company, "paidSeats" | "paidSeatsReason">;
}>();

const answer = computed(() => {
  if (props.company.paidSeats === false) {
    return { label: "Funkcje bez wynagrodzenia", icon: mdiCashOff };
  }
  if (props.company.paidSeats === true) {
    return { label: "Funkcje płatne", icon: mdiCashMultiple };
  }
  return undefined;
});

/** The reason as typed, with its links made clickable and shortened to the
 * address's host: a statute's full path would run off a phone's menu. */
const reasonParts = computed(() =>
  linkify(props.company.paidSeatsReason ?? "").map((part) =>
    part.href ? { ...part, text: hostOf(part.href) } : part,
  ),
);

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}
</script>

<style scoped>
.paid-seats-reason {
  overflow-wrap: anywhere;
}
</style>
