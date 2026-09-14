<template>
  <div class="mb-3" data-testid="umowy-headline">
    <!-- Coverage, not money, and the difference is the whole point of this
         block. Two contracts - POLREGIO's 1,157 mld and PKO BP's 1,071 mld -
         are 18% of the register window's 12,33 mld total, so a sum in `text-h4`
         is a lie of composition and it is the first thing a stranger reads.
         „How much of the register can we say anything about" is the honest
         headline and the one the page is actually about. -->
    <p class="text-h4 font-weight-bold text-ink-strong mb-0">
      {{ linkedLine }}
    </p>
    <p class="text-body-2 text-ink-neutral mb-0">{{ totalLine }}</p>
    <p class="text-caption text-ink-neutral mb-0">{{ windowLine }}</p>
    <p class="text-body-2 mb-0 mt-1">{{ reachLine }}</p>
  </div>
</template>

<script setup lang="ts">
import { longDate } from "~~/shared/dates";
import { contractForms } from "~~/shared/contracts";
import type { ContractCoverage } from "~~/shared/contracts";

/** How much of the register this site holds, in four lines.
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

const reachLine = computed(() => {
  const companies = polishCountingGrouped(
    props.coverage.companies,
    "instytucja",
    "instytucje",
    "instytucji",
  );
  const people = polishCountingGrouped(
    props.coverage.namedPeople,
    "osoba",
    "osoby",
    "osób",
  );
  return `${companies} · ${people}, które możemy wymienić z nazwiska`;
});
</script>
