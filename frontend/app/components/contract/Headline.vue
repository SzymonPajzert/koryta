<template>
  <!-- A tinted band, and that is the point of it rather than decoration.
       Before this the whole first screen was black-on-white text over white
       cards with a 16%-opacity hairline - `.k-card` is `background: surface` on
       a `surface` page - and the owner's word for it was „very blank ... it
       doesn't have any background color". The sibling surface they liked,
       /eksploruj/umowy, carries fourteen tinted or textured elements (k-note
       callouts, chip groups, toggles, the dashed draft rail) against this
       page's one.

       `surface.sage` rather than a new colour: it is `brand.primary` at 25%
       over white, so the band reads as the same green as the site's header
       band, and /eksploruj/tabela already tints its sticky column headers with
       exactly this token. Contrast on it is measured in `shared/colors.ts` -
       `ink.strong` 17.06:1, `ink.sage` 5.57:1 - so nothing here needs a
       judgement call about legibility. -->
  <section class="umowy-hero mb-4" data-testid="umowy-headline">
    <!-- Coverage, not money, and the difference is the whole point of this
         block. Two contracts - POLREGIO's 1,157 mld and PKO BP's 1,071 mld -
         are 18% of the register window's 12,33 mld total, so a sum in `text-h4`
         is a lie of composition and it is the first thing a stranger reads.
         „How much of the register can we say anything about" is the honest
         headline and the one the page is actually about. -->
    <p class="text-h4 font-weight-bold text-ink-strong mb-1">
      {{ linkedLine }}
    </p>
    <p class="text-body-2 text-ink-sage mb-0">{{ totalLine }}</p>
    <p class="text-caption text-ink-sage mb-0">{{ windowLine }}</p>

    <!-- The reach, as three figures rather than as the run-on sentence this
         used to be („825 instytucji · 558 osób, które możemy wymienić z
         nazwiska"). `StatTile` carries no surface of its own - it is a label,
         a number and a hint - so on the band it reads as three columns without
         boxing anything, which is what a hero wants and a card grid does not.

         Counts only: `StatTile` prints `formatCompact(value)` and has no way
         to render złoty, so a money tile would say „12,3 mln" of something the
         label has to name and the tile cannot. The same reasoning is written
         out on /eksploruj/umowy's tile row. -->
    <v-row class="umowy-hero__tiles mt-1" dense>
      <v-col cols="4">
        <StatsStatTile
          label="Instytucje"
          :value="coverage.companies"
          hint="które opisujemy"
        />
      </v-col>
      <v-col cols="4">
        <StatsStatTile
          label="Osoby"
          :value="coverage.namedPeople"
          hint="z nazwiska"
          tooltip="Osoby, które możemy wymienić publicznie: ich strona i powiązanie z instytucją są opublikowane. Zalogowani widzą więcej."
        />
      </v-col>
      <v-col cols="4">
        <StatsStatTile
          label="Obie strony"
          :value="coverage.bothLinked"
          hint="znamy obie firmy"
          tooltip="Umowy, w których i zamawiającego, i wykonawcę opisujemy na koryta.pl."
        />
      </v-col>
    </v-row>
  </section>
</template>

<script setup lang="ts">
import { longDate } from "~~/shared/dates";
import { contractForms } from "~~/shared/contracts";
import type { ContractCoverage } from "~~/shared/contracts";

/** How much of the register this site holds.
 *
 * Pure presentation and no fetch of its own, so it renders on the server with
 * the first response rather than popping in after hydration - the number is the
 * top of the page.
 *
 * **Every figure and both dates are read off `coverage`. Not one of them is a
 * literal**, and that is a rule rather than a preference: the window grows the
 * moment `CruUmowy` runs again, and a hardcoded „od 1 lipca do 10 sierpnia
 * 2026" would quietly become a false claim about what this site covers, with
 * nothing failing and no test able to notice.
 */
const props = defineProps<{ coverage: ContractCoverage }>();

const linkedLine = computed(() =>
  polishCountingGrouped(props.coverage.linked, ...contractForms),
);

const totalLine = computed(
  () =>
    `spośród ${polishNumber(props.coverage.total)} zarejestrowanych w Centralnym Rejestrze Umów`,
);

// Both years spelled out. „od 1 lipca do 10 sierpnia 2026" reads better and
// needs a day-and-month formatter `shared/dates.ts` does not have; inventing
// one here would be the sixth date format on the site, which is the mistake
// `shared/dates.ts` exists to have stopped.
const windowLine = computed(
  () => `od ${longDate(props.coverage.from)} do ${longDate(props.coverage.to)}`,
);
</script>

<style scoped>
/* `rgb(var(--v-theme-surface-sage))` and not the `bg-surface-sage` utility:
   the utility also sets `color` to that surface's `on-` ink, which would put
   `ink.sage` on the `text-h4` and drop it from 17.06:1 to 5.57:1. The tint is
   wanted, the ink override is not. /eksploruj/tabela tints its sticky headers
   the same way and for the same reason. */
.umowy-hero {
  background: rgb(var(--v-theme-surface-sage));
  border-radius: 10px;
  padding: 16px;
}

/* Three columns at every width, `cols="4"` rather than a breakpoint: the
   figures are at most four digits (825, 558, 154), and three short columns fit
   a 375px phone where a stacked hero would push the first contract off the
   first screen. Nothing here branches on `useDisplay()`, which under SSR
   reports mobile for everyone. */
.umowy-hero__tiles {
  margin-left: 0;
  margin-right: 0;
}
</style>
