<template>
  <div class="link-contracts" data-testid="powiazanie-umowy">
    <p v-if="error" class="text-body-2 text-ink-danger mb-0">
      Nie udało się wczytać umów. Spróbuj jeszcze raz za chwilę.
    </p>
    <v-progress-linear v-else-if="loading" indeterminate color="ink-info" />
    <template v-else>
      <ol v-if="contracts.length" class="link-contracts__list">
        <li v-for="row in shown" :key="row.contract.id">
          <div class="link-contracts__value">
            <template v-if="row.share">
              {{ plnExact(row.share.share) }}
              <span class="link-contracts__whole">
                z {{ plnExact(row.share.whole) }}
              </span>
            </template>
            <template v-else>
              {{
                contractValueLabel(
                  row.contract.value,
                  !!row.contract.valueRedaction,
                )
              }}
            </template>
          </div>
          <div class="link-contracts__text">
            <div class="text-body-2">
              {{ row.contract.subject || "Przedmiot utajniony" }}
            </div>
            <div class="text-caption text-ink-neutral">
              {{ row.contract.buyer.name }}
              <template v-if="row.contract.signedAt">
                · {{ longDate(row.contract.signedAt) }}</template
              >
              <!-- The institution's own number: four identical deliveries
                   signed the same day differ in nothing else. -->
              <template v-if="row.contract.number">
                · nr {{ row.contract.number }}</template
              >
              <template v-if="row.share">
                · umowa z {{ row.share.suppliers }} wykonawcami</template
              >
              <template v-if="registerUrl(row.contract)">
                ·
                <a
                  :href="registerUrl(row.contract)"
                  target="_blank"
                  rel="nofollow noopener"
                  >w rejestrze</a
                >
              </template>
            </div>
          </div>
        </li>
      </ol>
      <p v-else class="text-body-2 text-ink-neutral mb-0">
        Umów tego powiązania nie ma jeszcze w naszej kopii rejestru.
      </p>
      <v-btn
        v-if="rows.length > shown.length"
        variant="text"
        color="ink-strong"
        size="small"
        class="link-contracts__more mt-2"
        data-testid="powiazanie-umowy-wszystkie"
        @click="all = true"
      >
        Pokaż wszystkie ({{ rows.length }})
      </v-btn>
      <p
        v-if="deals > contracts.length && contracts.length"
        class="text-caption text-ink-neutral mt-2 mb-0"
      >
        Pokazujemy {{ contracts.length }} z {{ deals }} umów.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { fetchContractLink } from "~/composables/contractLinks";
import { contractShare } from "~/utils/contractLinks";
import { contractSourceUrl } from "~~/shared/contracts";
import { contractValueLabel, plnExact } from "~~/shared/money";
import { longDate } from "~~/shared/dates";
import type { ContractRow } from "~~/shared/contracts";

const { linkId, initial = undefined } = defineProps<{
  linkId: string;
  deals: number;
  /** The contracts, where the page already has them: a `?powiazanie=` link
   * is answered with the finding and its contracts in one request, on the
   * server. Shown as they are - no progress bar in the server's HTML, and no
   * second request for the same document once the browser takes over. A card
   * in the list has none and asks when it is opened. */
  initial?: ContractRow[];
}>();

/** Enough to read at a glance; the rest - a finding can have sixty - one
 * click away, rather than 3 800 px of card between the reader and the next
 * finding. */
const FIRST = 10;

const fetched = ref<ContractRow[] | null>(null);
const error = ref(false);
const all = ref(false);
const contracts = computed(() => initial ?? fetched.value ?? []);
const loading = computed(() => !initial && !fetched.value && !error.value);

/** Each contract with this firm's part of it, where it shares the contract
 * with other suppliers. The finding's totals and „Kto płacił" count the part,
 * so a row that printed the whole value would disagree with them on the same
 * card - half of a contract two suppliers share, beside a total that counts
 * that half. */
const rows = computed(() =>
  contracts.value.map((contract) => ({
    contract,
    share: contractShare(contract),
  })),
);
const shown = computed(() =>
  all.value ? rows.value : rows.value.slice(0, FIRST),
);

/** The register link, withheld on a contract that names a private person -
 * the rule `contract/Row.vue` keeps, for the reason given there. */
function registerUrl(contract: ContractRow) {
  return contract.hasIndividual ? undefined : contractSourceUrl(contract);
}

let requested = false;
async function load() {
  requested = true;
  try {
    fetched.value = (await fetchContractLink(linkId)).contracts;
  } catch {
    error.value = true;
  }
}

onMounted(() => {
  if (!initial) void load();
});
// The page's answer can go away under a mounted card (a refetch for a reader
// who has just signed in): ask for the contracts then rather than spin.
watch(
  () => initial,
  (value) => {
    if (!value && !requested) void load();
  },
);
</script>

<style scoped>
.link-contracts__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.link-contracts__list li {
  display: grid;
  gap: 12px;
  grid-template-columns: 7.5em 1fr;
}

.link-contracts__value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  text-align: right;
  white-space: nowrap;
}

/* The whole contract under the firm's part of it, small enough to stay in the
   value column. */
.link-contracts__whole {
  color: rgb(var(--v-theme-ink-neutral));
  display: block;
  font-size: 0.72rem;
  font-weight: 400;
}

.link-contracts__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 599px) {
  .link-contracts__more {
    min-height: 44px;
  }
}
</style>
