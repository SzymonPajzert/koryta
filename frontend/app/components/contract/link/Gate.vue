<template>
  <div class="link-gate" data-testid="powiazania-brama">
    <div class="link-gate__figure">
      <span class="link-gate__number">{{ polishNumber(gated) }}</span>
      <span class="link-gate__caption" data-testid="powiazania-brama-liczba">
        <template v-if="region">
          z {{ polishCountingGenitive(region.links, "powiązania", "powiązań") }}
          w tym województwie widzą tylko zalogowani
        </template>
        <template v-else>
          {{ nominativeNoun(gated, "powiązanie", "powiązania", "powiązań") }}
          widzą tylko zalogowani
        </template>
      </span>
    </div>
    <div class="link-gate__body">
      <p class="text-body-1 font-weight-medium mb-1">
        Załóż konto, żeby zobaczyć nazwiska, firmy i umowy.
      </p>
      <!-- Filtered to a województwo, the body speaks for that region as the
           figure beside it does: the national „36 public, 376 more, 224 mln"
           under a regional „13 z 13" read as the region's numbers, in a
           region with no public finding at all. The summary has no gated
           money or checked count per region, so the regional line gives
           none. -->
      <p v-if="region" class="text-body-2 text-ink-neutral mb-2">
        <template v-if="regionPublic > 0">
          {{ regionPublic === 1 ? "Jedno" : polishNumber(regionPublic) }} z nich
          pokazujemy wszystkim, z nazwiskami.
        </template>
        Po zalogowaniu zobaczysz wszystkie powiązania z tego województwa. Konto
        jest bezpłatne i zakładasz je w minutę.
      </p>
      <p v-else class="text-body-2 text-ink-neutral mb-2">
        Najmocniejsze sprawdzone powiązania ({{ polishNumber(summary.public) }})
        pokazujemy wszystkim, z nazwiskami. Pozostałe
        {{ polishNumber(summary.gated)
        }}<template v-if="summary.gatedVerified">
          — w tym {{ polishNumber(summary.gatedVerified) }}
          {{
            nominativeNoun(
              summary.gatedVerified,
              "sprawdzone",
              "sprawdzone",
              "sprawdzonych",
            )
          }}
          —</template
        >
        widzą zalogowani.<template v-if="summary.totalGated">
          Razem to {{ plnCompact(summary.totalGated)
          }}<template v-if="mostlyWeak"
            >, w większości w słabszych powiązaniach klasy D</template
          >.</template
        >
        Konto jest bezpłatne i zakładasz je w minutę.
      </p>
      <!-- What „Sprawdzone" on a card promises, said once, where the reader
           decides whether the rest is worth an account. -->
      <p
        class="text-caption text-ink-neutral mb-3"
        data-testid="powiazania-brama-statusy"
      >
        <strong>Sprawdzone</strong>: dopasowanie osoby do firmy przeszło nasz
        przegląd i próbę podważenia albo potwierdziły je źródła.
        <strong>Do sprawdzenia</strong>: został jeden otwarty punkt.
        <strong>Niesprawdzone</strong>: wynik automatycznego dopasowania
        rejestrów, bez przeglądu.
      </p>
      <div class="d-flex flex-wrap ga-2">
        <v-btn
          color="primary"
          variant="flat"
          :to="loginLink"
          class="link-gate__button"
          data-testid="powiazania-brama-rejestracja"
          @click="emit('gate', 'koniec-listy')"
        >
          Załóż konto
        </v-btn>
        <v-btn
          variant="text"
          color="ink-strong"
          :to="signInLink"
          class="link-gate__button"
          data-testid="powiazania-brama-logowanie"
          @click="emit('gate', 'koniec-listy-logowanie')"
        >
          Mam konto — zaloguj się
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  nominativeNoun,
  polishCountingGenitive,
  polishNumber,
} from "~/composables/polish";
import { contractLinkGatedMostlyWeak } from "~/composables/contractLinks";
import { plnCompact } from "~~/shared/money";
import type { ContractLinkSummary } from "~~/shared/contractLinks";

const {
  summary,
  loginLink,
  woj = null,
} = defineProps<{
  summary: ContractLinkSummary;
  /** Opens /login in its register mode. */
  loginLink: string;
  /** The województwo the list is filtered to: the figure is then that
   * region's, since a reader looking at 13 teasers from podlaskie is not asked
   * about 384. */
  woj?: string | null;
}>();
/** Which button: a new account and a returning reader are different
 * conversions, and counting both as one inflated this ask's click-through. */
const emit = defineEmits<{
  gate: [surface: "koniec-listy" | "koniec-listy-logowanie"];
}>();

const region = computed(() =>
  woj ? (summary.byWojewodztwo[woj] ?? null) : null,
);
const gated = computed(() => region.value?.gated ?? summary.gated);
/** The region's findings everybody sees, named. */
const regionPublic = computed(() =>
  region.value ? Math.max(0, region.value.links - region.value.gated) : 0,
);
const mostlyWeak = computed(() => contractLinkGatedMostlyWeak(summary));

const signInLink = computed(() =>
  loginLink.replace("konto=nowe&", "").replace("?konto=nowe", "?"),
);
</script>

<style scoped>
.link-gate {
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 12px;
  display: grid;
  grid-template-columns: 1fr;
  overflow: hidden;
}

@media (min-width: 720px) {
  .link-gate {
    grid-template-columns: minmax(180px, 32%) 1fr;
  }
}

.link-gate__figure {
  background: rgb(var(--v-theme-ink-strong));
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 20px 24px;
}

.link-gate__number {
  font-size: 2.75rem;
  font-weight: 700;
  line-height: 1;
}

.link-gate__caption {
  font-size: 0.95rem;
  margin-top: 6px;
  opacity: 0.9;
}

.link-gate__body {
  background: rgb(var(--v-theme-surface));
  padding: 20px 24px;
}

@media (max-width: 599.98px) {
  .link-gate__button {
    min-height: 44px;
  }
}
</style>
