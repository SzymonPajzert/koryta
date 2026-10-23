<template>
  <!-- One seat changing hands, drawn the same on a person's page („Zmiany na
       stanowisku”) and on a company's („Kto kogo zastąpił”): who left it, the
       gap, who took it. The two pages used to draw this one fact two ways -
       other labels, avatars on one only, the gap as a sage pill on one and
       plain text on the other, and pink meaning an overlap here and a party
       change there - and Szymon picked one row for both (2026-10-23). Each
       page keeps the card around it: the company and the role on a person's,
       the day the seat changed hands on a company's. -->
  <div class="handover">
    <div class="handover__grid">
      <!-- Both sides from one template, with the gap between them in the
           markup as well as on screen, so a screen reader reads the row in
           the order the seat moved. -->
      <template v-for="(side, index) in sides" :key="side.key">
        <div class="handover__side" :data-testid="`handover-${side.key}`">
          <SuccessionInitials :name="side.who.name" :tone="side.tone" />
          <div class="handover__text">
            <!-- Inside each side rather than once over the column, so the
                 label is still beside the name once the sides stack. -->
            <div class="handover__label">{{ side.label }}</div>
            <div class="handover__names">
              <!-- No link for the person whose page this is: it would lead
                   back to where the reader already is. -->
              <NuxtLink
                v-if="side.who.url"
                :to="side.who.url"
                class="link-plain handover__name"
                >{{ side.who.name }}</NuxtLink
              >
              <span v-else class="handover__name">{{ side.who.name }}</span>
              <PartyChip v-for="party in side.parties" :key="party" :party />
            </div>
            <div class="handover__period">{{ side.period }}</div>
          </div>
        </div>

        <div v-if="index === 0" class="handover__mid">
          <v-icon :icon="mdiArrowRight" size="18" class="handover__arrow" />
          <span class="handover__gap" data-testid="handover-gap">{{
            gapLabel(gapDays)
          }}</span>
          <!-- The fact a reader scanning a board for politics is looking
               for, so it is the one thing in the middle with a colour. -->
          <span
            v-if="partyChanged"
            class="handover__flip"
            data-testid="handover-party-change"
          >
            zmiana afiliacji
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { mdiArrowRight } from "@mdi/js";
import { asArray } from "~~/shared/model";
import { gapLabel } from "~~/shared/succession";
import { ledgerPeriod, spellLength } from "~/utils/relationPeriod";
import {
  useSuccessionToday,
  type HandoverSide,
} from "~/composables/successions";

const props = defineProps<{
  /** Who left the seat. */
  left: HandoverSide;
  /** Who took it. */
  right: HandoverSide;
  /** Days between the two filings, negative where they overlap - read out by
   * `gapLabel` (shared/succession.ts), as everywhere the site states a gap. */
  gapDays: number;
}>();

const today = useSuccessionToday();

/** One side's whole spell in the seat, in the history's date format, and how
 * long it lasted: „12.06.2025 - 03.04.2026 · 9 mies.”, „od 14.05.2026 · 5
 * mies.” for a post still held, „do 28.05.2015” where the register never gave
 * the start. A row that only named the day the seat changed hands told a
 * reader nothing about who had sat in it for eight years and who for a week.
 * Every date in a row is dd.mm.yyyy (`ledgerPeriod`); long month names are for
 * heads and captions. */
function spellOf(side: HandoverSide): string {
  const period = ledgerPeriod(side.start ?? undefined, side.end ?? undefined, {
    today: today.value,
  });
  if (!period) return "brak dat kadencji";
  const length = spellLength(side.start, side.end, today.value);
  return length ? `${period.text} · ${length}` : period.text;
}

type DrawnSide = {
  key: "left" | "right";
  /** In the present tense, which Polish does not inflect for gender, so one
   * label fits anybody: „Ustępuje”, where „Ustąpił” would need an „Ustąpiła”
   * and a guess at which. */
  label: string;
  tone: "in" | "out";
  who: HandoverSide;
  parties: string[];
  period: string;
};

const sides = computed<DrawnSide[]>(() => [
  {
    key: "left",
    label: "Ustępuje",
    tone: "out",
    who: props.left,
    // Through `asArray`: a person written before 2026-07-28 stores its
    // parties as `{"0": "PiS"}`, and the endpoint passes them on as stored.
    parties: asArray(props.left.parties),
    period: spellOf(props.left),
  },
  {
    key: "right",
    label: "Obejmuje stanowisko",
    tone: "in",
    who: props.right,
    parties: asArray(props.right.parties),
    period: spellOf(props.right),
  },
]);

/** Whether the seat changed party with its holder. Only claimed when both
 * sides are known: no parties means "not recorded", not "bezpartyjny", and
 * reading it as a swing would invent one. And only when they share none: a
 * person listed under two parties hands over to one of them without any
 * swing, whatever order the parties happen to be stored in. Worked out here,
 * so a person's page flags the same handovers a company's does - it used to
 * flag none. */
const partyChanged = computed(() => {
  const before = asArray(props.left.parties);
  const after = asArray(props.right.parties);
  return (
    before.length > 0 &&
    after.length > 0 &&
    !before.some((party) => after.includes(party))
  );
});
</script>

<style scoped>
/* Laid out by its own width, not the screen's: the same row is a person's
   card and one line of a company's batch, and the two sides stand apart only
   where both people and the gap fit across it. Narrower, the sides stack -
   who left, the gap, who took over - and the arrow turns down with them. */
.handover {
  container: handover / inline-size;
}

/* Two equal columns either side of a gap column of one fixed width, so on a
   company's batch every arrow sits on one line down the card, and every
   person taking a seat starts at the same place whatever the gap says - an
   auto column moved the right side with the chip's words. 192px holds the
   longest chip („wpisy nachodzą na siebie o 19 dni”) on one line. */
.handover__grid {
  align-items: center;
  column-gap: 16px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 192px minmax(0, 1fr);
}

.handover__side {
  align-items: center;
  display: flex;
  gap: 10px;
  min-width: 0;
}

/* Without this the text is free to size to its longest word, and an
   unbroken surname widens the row past its card. */
.handover__text {
  min-width: 0;
}

/* What the name under it is: 12/600, quiet, sentence case. */
.handover__label {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  font-weight: 600;
  line-height: 1.4;
}

.handover__names {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  line-height: 1.25;
  margin-top: 2px;
}

/* A person's name in a list: 16/700, the one weight below the page title. */
.handover__name {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: var(--k-body-size);
  font-weight: 700;
  letter-spacing: -0.01em;
}

.handover__period {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  line-height: 1.4;
  margin-top: 2px;
}

.handover__mid {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: center;
}

.handover__arrow {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

/* The gap between the two holders: the grey chip of the history's
   „Wcześniej:” line (card/EmploymentHistory.vue), so a gap reads the same in
   every place the site states one - and the commonest one, „tego samego
   dnia”, no longer looks like the thing to notice. */
.handover__gap {
  background: var(--k-tonal);
  border-radius: var(--k-r-control);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: var(--k-meta-size);
  line-height: 1.5;
  padding: 0 6px;
  text-wrap: balance;
}

/* Pink means a party change and nothing else, on both pages. */
.handover__flip {
  background: rgb(var(--v-theme-secondary));
  border-radius: var(--k-r-pill);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: var(--k-meta-size);
  font-weight: 700;
  line-height: 1.5;
  padding: 0 8px;
  white-space: nowrap;
}

/* Two sides of about 200px and the gap's 168: below that the names wrap a
   word to a line, so the sides stack instead. The arrow sits under the
   avatar it leads away from, with the gap and the flag beside it. */
@container handover (max-width: 599.98px) {
  .handover__grid {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 8px;
  }

  .handover__mid {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 8px;
    max-width: none;
    padding-left: 8px;
    text-align: left;
  }

  .handover__arrow {
    transform: rotate(90deg);
  }
}
</style>
