<template>
  <!-- `.k-card`, and deliberately never `.k-card--accent`. `app/app.vue`
       reserves the sage rail for „a card that carries a claim about somebody";
       a contract is a register entry we are mirroring, and painting it in the
       site's editorial colour because a NIP matched is exactly the false
       impression of causation this feature has to avoid. -->
  <article class="k-card contract-row pa-3 mb-2" data-testid="umowy-row">
    <!-- The 42 `zrodlo: "wynik"` rows: the register indexes them and will not
         serve their details. Kept and said out loud rather than dropped -
         dropping them is a silent edit of somebody else's register - and drawn
         as one line, because there is no party, no value and no subject to
         draw. -->
    <template v-if="contract.detailsUnavailable">
      <p class="text-body-2 text-ink-neutral mb-0">
        Rejestr nie udostępnił szczegółów tej umowy.
      </p>
      <p v-if="signedLabel" class="text-caption text-ink-neutral mt-1 mb-0">
        {{ signedLabel }}
      </p>
    </template>

    <template v-else>
      <!-- Two lines and an ellipsis, with the whole thing on `title`: the
           subject runs to 48 characters at the median and 155 at the 90th
           percentile, which is two lines at 375px, but the register allows
           1 500. -->
      <h3
        v-if="contract.subject"
        class="text-subtitle-2 font-weight-bold contract-row__subject"
        :title="contract.subject"
      >
        {{ contract.subject }}
      </h3>
      <p
        v-else-if="contract.subjectRedaction"
        class="text-subtitle-2 text-ink-neutral mb-0"
      >
        Przedmiot utajniony
      </p>
      <p
        v-if="contract.subjectRedaction?.basis"
        class="text-caption text-ink-neutral mb-0"
      >
        {{ contract.subjectRedaction.basis }}
      </p>

      <div class="d-flex flex-wrap ga-2 align-center mt-1">
        <ContractValue
          :value="contract.value"
          :redaction="contract.valueRedaction"
        />
        <span v-if="signedLabel" class="text-caption text-ink-neutral">
          {{ signedLabel }}
        </span>
        <!-- Nothing at all on the 75.5% of contracts with no end date. An
             „obecnie" or a dash there would assert a term the register never
             recorded. -->
        <span v-if="endLabel" class="text-caption text-ink-neutral">
          {{ endLabel }}
        </span>
        <!-- Only when the register says so. `active` is a tri-state here:
             undefined is „not stated", and 111 826 of 149 683 contracts are
             active, so a chip on those would be a chip on most rows. -->
        <v-chip
          v-if="contract.active === false"
          size="x-small"
          variant="outlined"
        >
          Nieaktywna
        </v-chip>
        <v-chip v-if="amendmentCount > 0" size="x-small" variant="outlined">
          aneksowana ({{ amendmentCount }})
        </v-chip>
      </div>

      <div class="mt-2 d-flex flex-column ga-1">
        <ContractPartyLine
          label="Zamawiający"
          :party="contract.buyer"
          :people="peopleFor(contract.buyer)"
        />
        <ContractPartyLine
          v-for="(supplier, index) in contract.suppliers"
          :key="`${supplier.nodeId ?? supplier.nip ?? supplier.name ?? index}`"
          :label="index === 0 ? supplierLabel : ''"
          :party="supplier"
          :people="peopleFor(supplier)"
        />
      </div>

      <div class="d-flex flex-wrap align-center ga-2 mt-1">
        <!-- A labelled 44px control rather than the whole card being one
             `<button>`: the card holds `NuxtLink`s to institutions, and a
             button may not contain a link - the parser closes the button at the
             first anchor and the rest of the card falls outside it. The tap
             area on a phone is the same either way. -->
        <v-btn
          v-if="expandable"
          class="contract-row__expand"
          variant="text"
          size="small"
          :prepend-icon="expanded ? mdiChevronUp : mdiChevronDown"
          :aria-expanded="expanded"
          :aria-controls="panelId"
          data-testid="umowy-row-expand"
          @click="toggle"
        >
          Szczegóły umowy
        </v-btn>

        <!-- Absent, with nothing marking the absence, on the 18 505 contracts
             (12.4%) where the register names a private individual. We store no
             such name, but this link is the one element on the row that turns an
             anonymised entry back into a one-click lookup of it - and a sentence
             explaining the omission would itself be the pointer. -->
        <a
          v-if="registerUrl && !contract.hasIndividual"
          class="text-caption text-ink-neutral"
          :href="registerUrl"
          target="_blank"
          rel="nofollow noopener"
        >
          Zobacz w rejestrze
        </a>
      </div>

      <v-expand-transition>
        <div v-if="expanded" :id="panelId" class="contract-row__panel mt-2">
          <v-skeleton-loader v-if="detailPending" type="paragraph" />
          <template v-else>
            <p class="text-caption text-ink-neutral mb-1">
              {{ contract.number ? `Numer: ${contract.number}` : "Bez numeru" }}
            </p>
            <p v-if="contract.subject" class="text-body-2 mb-1">
              {{ contract.subject }}
            </p>
            <p v-if="hasValue" class="text-body-2 mb-1">
              Wartość: {{ plnExact(contract.value) }}
            </p>
            <p
              v-for="(amendment, index) in contract.amendments"
              :key="index"
              class="text-caption text-ink-neutral mb-0"
            >
              {{ amendmentLabel(amendment) }}
            </p>
            <!-- The register's own prose about the value, quoted and never
                 interpreted: it is where an institution explains a maximum, a
                 unit price or a framework, and paraphrasing it here would be
                 this site making the claim instead of quoting one. -->
            <p
              v-if="contract.valueNote"
              class="text-caption text-ink-neutral mt-1 mb-0"
            >
              {{ contract.valueNote }}
            </p>
            <p v-if="detailError" class="text-caption text-ink-neutral mb-0">
              Nie udało się pobrać szczegółów tej umowy.
            </p>
          </template>
        </div>
      </v-expand-transition>
    </template>
  </article>
</template>

<script setup lang="ts">
import { mdiChevronDown, mdiChevronUp } from "@mdi/js";
import { longDate, shortDate } from "~~/shared/dates";
import { plnExact } from "~~/shared/money";
import { contractSourceUrl } from "~~/shared/contracts";
import type {
  ContractAmendment,
  ContractParty,
  ContractPartyPeople,
  ContractRow,
} from "~~/shared/contracts";
import { CONTRACT_PARAM, fetchContractDetail } from "~/composables/contracts";

/** One contract, on all three surfaces that show one.
 *
 * The only place the phone clamp, the money wording, the redaction wording and
 * the published-versus-ours split are written down. Three copies of this row -
 * one per surface - is how „Utajniona" becomes „brak danych" on one of them and
 * nobody notices for a month; `PageSection` and `relationPeriodLabel` were both
 * extracted after exactly that.
 */
const props = withDefaults(
  defineProps<{
    contract: ContractRow;
    /** The company whose page this row is on, where it is on one.
     *
     * Used for one thing: suppressing the people strip on *that* company's own
     * end of the contract. Its board is already on the page above, in
     * `CardEmploymentHistory`, and repeating it under every contract row would
     * print the same eight names twenty times. */
    nodeId?: string;
    expandable?: boolean;
  }>(),
  // `nodeId` has no meaningful default; spelled out because `withDefaults`
  // requires one for every optional prop.
  { nodeId: undefined, expandable: true },
);

const route = useRoute();
const router = useRouter();

const expanded = ref(false);
const detailPending = ref(false);
const detailError = ref(false);
/** Whether the detail request has already been answered for this row. The same
 * row collapsed and expanded again is the same contract, and `/api/contracts/…`
 * costs a document read plus an edges query every time it is asked. */
const detailLoaded = ref(false);
/** The people the detail request came back with, keyed by node id. Held here
 * rather than merged into `contract`, which is a prop and belongs to the feed. */
const detailPeople = ref<ContractPartyPeople[] | null>(null);

const panelId = computed(() => `umowa-panel-${props.contract.id}`);

const registerUrl = computed(() => contractSourceUrl(props.contract));

const amendmentCount = computed(() => props.contract.amendments?.length ?? 0);

const hasValue = computed(() => Number.isFinite(props.contract.value));

const supplierLabel = computed(() =>
  // 1 237 contracts of 149 683 have more than one supplier, so the plural is
  // rare enough to be worth getting right and common enough to meet.
  props.contract.suppliers.length > 1 ? "Wykonawcy" : "Wykonawca",
);

const signedLabel = computed(() =>
  props.contract.signedAt ? `zawarta ${longDate(props.contract.signedAt)}` : "",
);

const endLabel = computed(() => {
  if (props.contract.endsAt) return `do ${longDate(props.contract.endsAt)}`;
  if (props.contract.openEnded) return "na czas nieoznaczony";
  return "";
});

function amendmentLabel(amendment: ContractAmendment): string {
  const kind = amendment.kind || "Zmiana umowy";
  return amendment.date ? `${kind} — ${shortDate(amendment.date)}` : kind;
}

/** The people at one end, as far as this reader may see them.
 *
 * Whatever the feed already had, then whatever the expanded row fetched. The
 * public list attaches none of this - a page of 20 rows would cost ~350 billed
 * reads instead of ~21 on the most crawled surface on the site - so on `/eksploruj/umowy`
 * this answers nothing until somebody taps „Szczegóły umowy".
 */
function peopleFor(party: ContractParty): ContractPartyPeople | undefined {
  if (!party.nodeId || party.nodeId === props.nodeId) return undefined;
  const people = detailPeople.value ?? props.contract.people;
  return people?.find((entry) => entry.nodeId === party.nodeId);
}

async function loadDetail() {
  if (detailLoaded.value) return;
  detailPending.value = true;
  detailError.value = false;
  try {
    const answer = await fetchContractDetail(props.contract.id);
    detailPeople.value = answer.contract.people ?? [];
    detailLoaded.value = true;
  } catch {
    // Said in the panel rather than thrown: the row above it is the register
    // record and is still true, and a failed lookup of who sits on a board must
    // not take the contract off the page.
    detailError.value = true;
  } finally {
    detailPending.value = false;
  }
}

/** Expanding writes `?umowa=<id>`, collapsing takes it away.
 *
 * `replace`, not `push`: a reader opening four rows on their way down the page
 * should not have to press back four times. The canonical stays the bare
 * `/eksploruj/umowy` whatever this says, so the parameter is a citable link rather than a
 * fifth crawl target for the same 149 683 rows.
 */
function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value) void loadDetail();
  // Rebuilt without the key rather than `delete`d out of a copy: the query is
  // handed straight to the router, and a key whose value is `undefined` is
  // serialised as a bare `?umowa` rather than dropped.
  const query = Object.fromEntries(
    Object.entries(route.query).filter(([key]) => key !== CONTRACT_PARAM),
  );
  if (expanded.value) query[CONTRACT_PARAM] = props.contract.id;
  void router.replace({ query });
}

// A shared `?umowa=` link has to open the row it names, or it is not a link to
// anything. `onMounted` and not setup: this is a client-side effect, and the
// panel's contents are fetched with the reader's token, which the server does
// not have.
onMounted(() => {
  if (props.expandable && route.query[CONTRACT_PARAM] === props.contract.id) {
    expanded.value = true;
    void loadDetail();
  }
});
</script>

<style scoped>
/* Everything inside a column that is allowed to shrink. Without `min-width: 0`
   a flex item refuses to go below the width of its widest unbreakable child,
   and one ALL-CAPS registry name then widens the card past the viewport. */
.contract-row {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}

.contract-row > * {
  min-width: 0;
}

.contract-row__subject {
  display: -webkit-box;
  line-height: 1.35;
  margin: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* 44px, the tap target this row is opened by on a phone. Vuetify's `small`
   button is 28px, which is under every touch guideline there is. */
.contract-row__expand {
  min-height: 44px;
}

.contract-row__panel {
  border-top: 1px solid rgba(var(--v-border-color), 0.16);
  padding-top: 8px;
}
</style>
