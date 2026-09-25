<template>
  <article
    class="k-card link-teaser"
    :class="`link-teaser--${teaser.strength.toLowerCase()}`"
    :data-rank="teaser.rank"
    data-testid="powiazanie-ukryte"
  >
    <div class="link-teaser__grid">
      <div class="link-teaser__side">
        <!-- A button, so a tap opens the explanation: a tooltip opens on hover
             and focus, and a phone has neither. -->
        <button
          type="button"
          class="link-teaser__letter"
          :class="`link-teaser__letter--${teaser.strength.toLowerCase()}`"
          :aria-label="`Klasa ${teaser.strength}: ${strength.short}`"
        >
          {{ teaser.strength }}
          <v-tooltip
            activator="parent"
            location="bottom"
            max-width="320"
            :open-on-hover="!touch"
            :open-on-click="touch"
          >
            <strong>{{ teaser.strength }} · {{ strength.short }}.</strong>
            {{ strength.long }}
          </v-tooltip>
        </button>
        <!-- A band and never the figure: an exact amount finds the contract
             in the public register, and the contract names the firm. -->
        <span class="link-teaser__amount">{{
          amountRangeLabel(teaser.totalRange)
        }}</span>
        <span class="link-teaser__status">
          {{ CONTRACT_LINK_STATUS_LABELS[teaser.status] }}
        </span>
      </div>

      <!-- Placeholder bars, never the withheld text: the server sent no name,
           and a blurred name would still be a published one. What is real here
           is only what a teaser carries - the kind of office (or that the
           office may be a namesake's), the count and the województwo. -->
      <div class="link-teaser__main">
        <div class="link-teaser__who">
          <span class="link-teaser__hook">{{ capitalize(teaser.hook) }}</span>
          <!-- Not beside „możliwa zbieżność nazwisk", for the reason the card
               drops it for a namesake. -->
          <span
            v-if="teaser.inOfficeNow && teaser.hook !== UNCONFIRMED"
            class="link-teaser__now"
          >
            dziś w urzędzie
          </span>
        </div>
        <dl class="link-teaser__facts">
          <dt>Osoba</dt>
          <dd>
            <span
              class="link-teaser__bar"
              :style="{ width: widths[0] }"
              aria-hidden="true"
            />
          </dd>
          <dt>Firma</dt>
          <dd>
            <span
              class="link-teaser__bar"
              :style="{ width: widths[1] }"
              aria-hidden="true"
            />
          </dd>
          <dt>Płaci</dt>
          <dd>
            <span
              class="link-teaser__bar"
              :style="{ width: widths[2] }"
              aria-hidden="true"
            />
            <span class="text-ink-neutral">
              {{ dealsRangeLabel(teaser.dealsRange)
              }}<template v-if="teaser.place.wojewodztwo">
                · woj. {{ teaser.place.wojewodztwo }}</template
              ></span
            >
          </dd>
        </dl>
        <span class="d-sr-only">
          Nazwisko, firmę i zamawiającego pokazujemy po zalogowaniu.
        </span>
      </div>
    </div>

    <div class="link-teaser__ask">
      <v-icon
        :icon="mdiLockOutline"
        size="20"
        class="link-teaser__lock"
        aria-hidden="true"
      />
      <v-btn
        color="primary"
        variant="flat"
        :to="loginLink"
        class="link-teaser__button"
        data-testid="powiazanie-odblokuj"
        @click="emit('gate', teaser)"
      >
        Załóż konto, żeby zobaczyć
      </v-btn>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiLockOutline } from "@mdi/js";
import { useMediaQuery } from "@vueuse/core";
import { amountRangeLabel, dealsRangeLabel } from "~/utils/contractLinks";
import {
  CONTRACT_LINK_STATUS_LABELS,
  CONTRACT_LINK_STRENGTH_LABELS,
  CONTRACT_LINK_UNCONFIRMED_HOOK as UNCONFIRMED,
  type ContractLinkTeaser,
} from "~~/shared/contractLinks";

/** A finding the reader may not see yet, drawn as the same row a visible one
 * is - so the list reads as one list with gaps in it, not as an advert - with
 * the ask under it. */
const { teaser, loginLink } = defineProps<{
  teaser: ContractLinkTeaser;
  loginLink: string;
}>();
/** The teaser rides along so the page can put its rank into the redirect,
 * and land the reader on this finding once they have an account. */
const emit = defineEmits<{ gate: [teaser: ContractLinkTeaser] }>();

const strength = computed(() => CONTRACT_LINK_STRENGTH_LABELS[teaser.strength]);
/** Tap to open where there is no hover to open it by. Not both everywhere: a
 * tap is also a synthetic mouseenter, and the two would open and close it in
 * one gesture. */
const touch = useMediaQuery("(hover: none)");

/** Bar lengths that differ from row to row but not from render to render, so
 * a list of teasers does not look stamped and the server and the browser draw
 * the same thing. In `em`, capped by the row, so a phone gets shorter ones. */
const widths = computed(() =>
  [11, 17, 23].map(
    (step, index) => `${7 + ((teaser.rank * step + index * 5) % 11)}em`,
  ),
);

function capitalize(text: string) {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}
</script>

<style scoped>
.link-teaser {
  padding: 14px 16px 14px 20px;
}

.link-teaser::before {
  background: rgba(var(--v-border-color), 0.3);
  bottom: 0;
  content: "";
  left: 0;
  position: absolute;
  top: 0;
  width: 4px;
}

.link-teaser__grid {
  display: grid;
  gap: 8px 20px;
  grid-template-areas: "side" "main";
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 720px) {
  .link-teaser__grid {
    grid-template-areas: "main side";
    grid-template-columns: minmax(0, 1fr) auto;
  }
}

.link-teaser__side {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  grid-area: side;
}

@media (min-width: 720px) {
  .link-teaser__side {
    align-items: flex-end;
    flex-direction: column;
  }
}

.link-teaser__letter {
  align-items: center;
  border: 0;
  border-radius: 4px;
  cursor: help;
  display: inline-flex;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  height: 22px;
  justify-content: center;
  padding: 0;
  position: relative;
  width: 22px;
}

/* A 44px target around a 22px letter, without drawing a bigger letter. */
.link-teaser__letter::after {
  content: "";
  inset: -11px;
  position: absolute;
}

.link-teaser__letter--a {
  background: rgb(var(--v-theme-surface-danger));
  color: rgb(var(--v-theme-ink-danger));
}
.link-teaser__letter--b {
  background: rgb(var(--v-theme-surface-warning));
  color: rgb(var(--v-theme-ink-warning));
}
.link-teaser__letter--c {
  background: rgb(var(--v-theme-surface-info));
  color: rgb(var(--v-theme-ink-info));
}
.link-teaser__letter--d {
  background: rgb(var(--v-theme-surface-muted));
  color: rgb(var(--v-theme-ink-neutral));
}

.link-teaser__amount {
  font-size: 1.45rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
}

.link-teaser__status {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8rem;
  white-space: nowrap;
}

.link-teaser__main {
  grid-area: main;
  min-width: 0;
}

.link-teaser__who {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
}

.link-teaser__hook {
  font-size: 1.08rem;
  font-weight: 600;
}

.link-teaser__now {
  background: rgb(var(--v-theme-surface-sage));
  border-radius: 4px;
  color: rgb(var(--v-theme-ink-sage));
  font-size: 0.75rem;
  font-weight: 600;
  padding: 1px 6px;
}

.link-teaser__facts {
  display: grid;
  font-size: 0.9rem;
  gap: 5px 10px;
  grid-template-columns: 3.4em minmax(0, 1fr);
  margin: 8px 0 0;
}

.link-teaser__facts dt {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding-top: 2px;
  text-transform: uppercase;
}

.link-teaser__facts dd {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  margin: 0;
}

.link-teaser__bar {
  background: rgba(var(--v-theme-on-surface), 0.13);
  border-radius: 3px;
  display: inline-block;
  filter: blur(1.5px);
  height: 12px;
  max-width: 100%;
}

.link-teaser__ask {
  align-items: center;
  border-top: 1px dashed rgba(var(--v-border-color), 0.25);
  display: flex;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
}

.link-teaser__lock {
  color: rgb(var(--v-theme-ink-neutral));
}

.link-teaser__button {
  flex: 1 1 auto;
  min-height: 44px;
}

@media (min-width: 600px) {
  .link-teaser__button {
    flex: 0 0 auto;
  }
}
</style>
