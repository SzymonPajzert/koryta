<template>
  <article class="k-card k-card--accent succ" :data-testid="change.testid">
    <div class="succ__head">
      <v-icon
        :icon="mdiOfficeBuildingOutline"
        size="15"
        class="succ__head-icon"
      />
      <!-- Text where the caller withheld a url. The person's page renders the
           company as a link; the "Kiedy?" daily does not, because the company
           page lists the very dates the player is being asked for. -->
      <NuxtLink
        v-if="change.companyUrl"
        :to="change.companyUrl"
        class="link-plain succ__company"
      >
        {{ change.companyName }}
      </NuxtLink>
      <span v-else class="succ__company">{{ change.companyName }}</span>
      <span class="succ__role">{{ change.role }}</span>
    </div>

    <div class="succ__flow">
      <div class="succ__side" :class="{ 'succ__side--self': change.from.self }">
        <div class="succ__label">{{ change.from.label }}</div>
        <div class="succ__name">
          <NuxtLink
            v-if="change.from.url"
            :to="change.from.url"
            class="link-plain"
          >
            {{ change.from.name }}
          </NuxtLink>
          <span v-else>{{ change.from.name }}</span>
          <PartyChip v-for="party in change.from.parties" :key="party" :party />
        </div>
        <div class="succ__when">{{ change.from.when }}</div>
      </div>

      <div class="succ__mid">
        <v-icon :icon="mdiArrowRight" size="18" class="succ__arrow" />
        <span class="succ__gap" :class="gapClass">
          {{ gapLabel(change.gapDays) }}
        </span>
        <!-- A whole board changed that day, so the card names one of the
             people who left rather than the one this person followed - which
             is not something the register records. -->
        <span
          v-if="change.batchNote"
          class="succ__hedge"
          data-testid="succession-batch-note"
        >
          {{ change.batchNote }}
        </span>
      </div>

      <div class="succ__side" :class="{ 'succ__side--self': change.to.self }">
        <div class="succ__label">{{ change.to.label }}</div>
        <div class="succ__name">
          <NuxtLink v-if="change.to.url" :to="change.to.url" class="link-plain">
            {{ change.to.name }}
          </NuxtLink>
          <span v-else>{{ change.to.name }}</span>
          <PartyChip v-for="party in change.to.parties" :key="party" :party />
        </div>
        <div class="succ__when">{{ change.to.when }}</div>
      </div>
    </div>
  </article>
</template>

<script lang="ts" setup>
import { mdiArrowRight, mdiOfficeBuildingOutline } from "@mdi/js";
import { gapLabel } from "~~/shared/succession";
import type { SuccessionChangeView } from "~/utils/succession";

/** One seat changing hands: who left, who arrived, and how the two filings sit
 * against each other.
 *
 * Purely presentational, and that is the point of it existing separately from
 * `PersonChanges.vue`, which owns the fetch and the coverage line. The "Kiedy?"
 * daily shows a real handover and asks the player when it happened, so it
 * builds the same view-model with the terms blanked and the links withheld -
 * which means the game is drawing the register's own card rather than an
 * imitation of it that would drift the first time this one changed.
 */
const props = defineProps<{ change: SuccessionChangeView }>();

/** Three different facts, not one number with a sign - so the pill that says
 * "tego samego dnia" and the one that says the two filings overlap cannot be
 * mistaken for each other. */
const gapClass = computed(() => {
  if (props.change.gapDays === 0) return "succ__gap--same";
  return props.change.gapDays < 0 ? "succ__gap--overlap" : "";
});
</script>

<style scoped>
/* The card, the heading and the lead are global (`app.vue`) - a section draws
   its own chrome but its entries are somebody else's component, so a scoped
   rule cannot reach them and every component that tried ended up with a
   slightly different card. What is left here is this card's own idiom. */

.succ {
  margin-bottom: 8px;
  padding: 11px 12px 12px 14px;
}

.succ__head {
  line-height: 1.4;
}

.succ__head-icon {
  color: rgba(var(--v-theme-on-surface), 0.38);
  margin-right: 5px;
  vertical-align: baseline;
}

.succ__company {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 0.8125rem;
  font-weight: 700;
}

.succ__role {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.75rem;
  margin-left: 6px;
}

.succ__flow {
  align-items: stretch;
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.succ__side {
  flex: 1 1 0;
  min-width: 0;
}

/* Which of the two is the person whose page this is. Sage as a border, so the
   marker costs no contrast. */
.succ__side--self {
  border-left: 2px solid rgba(var(--v-theme-primary), 0.9);
  padding-left: 10px;
}

.succ__label {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.625rem;
  letter-spacing: 0.07em;
  line-height: 1.6;
  text-transform: uppercase;
}

.succ__name {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.87);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  font-weight: 600;
  gap: 5px;
  line-height: 1.4;
  margin-top: 2px;
}

.succ__when {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.6875rem;
  margin-top: 3px;
}

.succ__mid {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 5px;
  justify-content: center;
  max-width: 15ch;
}

.succ__arrow {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

/* Deliberately plain: it is a caveat, not a warning, and a coloured box round
   it would make the commonest case on the site look like an error. */
.succ__hedge {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.7rem;
  line-height: 1.35;
  max-width: 22ch;
  text-align: center;
}

.succ__gap {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.6875rem;
  line-height: 1.5;
  padding: 1px 6px;
  text-align: center;
}

/* The common case, and the one worth seeing from across the page: the register
   recorded the handover as a handover. */
.succ__gap--same {
  background: rgba(var(--v-theme-primary), 0.38);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 600;
  white-space: nowrap;
}

/* Two filings that disagree, which is worth saying out loud rather than
   rendering as a negative number of days. */
.succ__gap--overlap {
  background: rgba(var(--v-theme-secondary), 0.75);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 600;
}

/* ---- phone: the two sides stack and the arrow turns with them ---- */
@media (max-width: 600px) {
  .succ__flow {
    flex-direction: column;
    gap: 6px;
  }

  .succ__mid {
    align-items: center;
    flex-direction: row;
    gap: 8px;
    justify-content: flex-start;
    max-width: none;
    padding-left: 2px;
  }

  .succ__arrow {
    transform: rotate(90deg);
  }
}
</style>
