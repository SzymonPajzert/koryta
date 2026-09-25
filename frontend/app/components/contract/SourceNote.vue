<template>
  <div class="k-note" data-testid="umowy-source-note">
    <h3 class="text-subtitle-2 mb-1">Skąd te dane</h3>
    <p class="text-body-2 mb-0">
      Centralny Rejestr Umów prowadzi administracja publiczna i publikuje w nim
      każdą umowę, którą instytucja zgłosi. Mamy z niego
      <strong>{{ storedLabel }}</strong> z okresu od
      <strong>{{ fromLabel }}</strong> do <strong>{{ toLabel }}</strong> — to
      nie jest cała historia zamówień publicznych, tylko ten wycinek rejestru.
      Stronę umowy rozpoznajemy po numerze NIP, więc do
      <strong>{{ linkedLabel }}</strong> z nich umiemy dopisać instytucję albo
      spółkę opisaną na koryta.pl.
      <strong
        >Brak linku znaczy, że nie mamy tej firmy w bazie — nie że nie stoi za
        nią nikogo.</strong
      >
      Nie publikujemy nazwisk osób prywatnych, które zawarły umowę z instytucją;
      dotyczy to <strong>{{ individualLabel }}</strong
      >. Część kwot i przedmiotów rejestr utajnia — piszemy wtedy o podstawie
      prawnej. Niczego tu nie oceniamy: to, że umowa jest na tej liście, nie
      znaczy, że jest z nią coś nie tak. Stan na
      <strong>{{ computedLabel }}</strong
      >.
    </p>
  </div>
</template>

<script setup lang="ts">
import { longDate } from "~~/shared/dates";
import { contractForms } from "~~/shared/contracts";
import type { ContractCoverage } from "~~/shared/contracts";

/** The caveat, written once for all three contract surfaces.
 *
 * One component and not one paragraph per page, because this is the one string
 * on the feature that must never drift. `app/app.vue`'s own docstring records
 * what happened the last time five components hand-copied a shared rule: the
 * copies diverged and a reader reported the result twice.
 *
 * Two sentences carry most of the weight and have to survive any edit:
 *
 * - „Brak linku znaczy, że nie mamy tej firmy w bazie — nie że nie stoi za nią
 *   nikogo." We hold 825 of the register's 12 858 contracting institutions, so
 *   an unlinked row is a gap in our coverage and never a clearance.
 * - „Niczego tu nie oceniamy: to, że umowa jest na tej liście, nie znaczy, że
 *   jest z nią coś nie tak." Half the rows are stationery and taxi fares.
 *
 * Every figure and every date comes from `coverage`, for `ContractHeadline`'s
 * reason: the window grows on the next pipeline run.
 */
const props = defineProps<{ coverage: ContractCoverage }>();

/** „149 683 umowy”, declined. Phrased as „z okresu od … do …” and not „zawarte
 * od …”: the participle would have to agree with the noun, and the noun changes
 * case with the count - „149 685 umów zawarte” is what the obvious wording
 * writes on the days the last digits land differently. */
const storedLabel = computed(() =>
  polishCountingGrouped(props.coverage.stored, ...contractForms),
);

const linkedLabel = computed(() => polishNumber(props.coverage.linked));

/** „dotyczy to” governs the genitive, which is a different table from the
 * nominative one `polishCountingGrouped` uses. */
const individualLabel = computed(() =>
  polishCountingGenitive(props.coverage.withIndividual, "umowy", "umów"),
);

const fromLabel = computed(() => longDate(props.coverage.from));
const toLabel = computed(() => longDate(props.coverage.to));

/** `computedAt` is an ISO *instant* and the rest of this document holds ISO
 * *days*. `isoDay` is strict on purpose - `new Date("2026")` answers 1 January,
 * a date nothing recorded - so the timestamp has to be cut down to its day
 * before `longDate` will take it, or the footer reads „brak daty”. */
const computedLabel = computed(() =>
  longDate(props.coverage.computedAt.slice(0, 10)),
);
</script>
