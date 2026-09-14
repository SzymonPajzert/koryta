<template>
  <!-- `v-if="stats"` on the shell itself, not on the rows inside it: five
       companies in six have no contracts at all (4 103 of 4 928), and a heading
       over a „nic nie znaleźliśmy" note on all of them would be eight lines of
       furniture on the page type that draws 42% of the site's search
       impressions. Nothing renders, and the endpoint spent one Firestore read
       finding that out. -->
  <PageSection
    v-if="stats"
    title="Umowy publiczne"
    :icon="mdiFileDocumentOutline"
    data-testid="company-contracts"
    info="Umowy przypisane w rejestrze do numeru NIP tej instytucji. Okres jest ograniczony do tego, co pobraliśmy - to nie jest pełna historia umów tej instytucji."
  >
    <template #actions>
      <span
        class="text-caption text-ink-neutral"
        data-testid="company-contracts-summary"
      >
        {{ summary }}
      </span>
    </template>

    <template #lead>
      <p class="k-lead" data-testid="company-contracts-coverage">
        Ta instytucja jest stroną <strong>{{ coverageCount }}</strong>
        {{ coverageTail }}
      </p>
      <!-- Only above n=10 and only when the handler recomputed the share from
           the very rows printed below, so the sentence cannot contradict
           them. -->
      <p
        v-if="concentration"
        class="k-lead"
        data-testid="company-contracts-concentration"
      >
        <strong>{{ concentration }}</strong>
      </p>
    </template>

    <!-- Only where the institution is on both sides of the register at all.
         On the 96% of companies that only ever buy, a toggle whose second
         option is „Jako wykonawca (0)" is a control that can only disappoint. -->
    <v-btn-toggle
      v-if="showRoleToggle"
      v-model="rola"
      density="compact"
      variant="outlined"
      divided
      mandatory
      class="mb-3"
      data-testid="company-contracts-role"
      :aria-label="`Umowy instytucji ${companyName} według roli`"
    >
      <!-- The „all" count is `totalCount` and deliberately not
           `buyerCount + supplierCount`: a contract this institution is on both
           ends of exists once, and the sum would promise a row that the
           `nodeIds array-contains` query behind this filter cannot produce. -->
      <v-btn value="all" size="small">
        Wszystkie ({{ polishNumber(stats.totalCount) }})
      </v-btn>
      <v-btn value="zamawiajacy" size="small">
        Jako zamawiający ({{ polishNumber(stats.buyerCount) }})
      </v-btn>
      <v-btn value="wykonawca" size="small">
        Jako wykonawca ({{ polishNumber(stats.supplierCount) }})
      </v-btn>
    </v-btn-toggle>

    <v-skeleton-loader v-if="pending && !rows.length" type="paragraph" />

    <template v-if="!showAll">
      <ContractRow
        v-for="row in rows"
        :key="row.id"
        :contract="row"
        :node-id="nodeId"
      />

      <!-- „Brak linku nie znaczy, że nie stoi za nią nikogo", said about this
           institution's own counterparties. What is deliberately NOT here is
           any sentence about a both-sides search coming back empty: we hold
           825 of the register's 12 858 contracting institutions, and on a page
           a stranger reads that null result would pass for a clearance. It
           exists on /eksploruj/umowy and nowhere else. -->
      <div
        v-if="noCounterpartyKnown"
        class="k-note text-body-2 mt-2"
        data-testid="company-contracts-no-counterparty"
      >
        Żadna z tych umów nie ma po drugiej stronie firmy, którą mamy w bazie.
      </div>

      <!-- One banner under the rows, never one per row: the withheld people
           are a property of the section, and five copies of the same prompt is
           what a reader reported about the table. -->
      <ExploreLoginBanner
        v-if="showLoginBanner"
        class="mt-3"
        :hidden-count="hiddenPeople"
        :forms="['powiązana osoba', 'powiązane osoby', 'powiązanych osób']"
        message="Zaloguj się, aby zobaczyć osoby, które łączymy z kontrahentami tej instytucji."
      />

      <v-btn
        v-if="hasMore"
        variant="outlined"
        block
        class="mt-3"
        data-testid="company-contracts-all"
        @click="showAll = true"
      >
        Pokaż wszystkie umowy ({{ polishNumber(stats.totalCount) }})
      </v-btn>
    </template>

    <!-- In place of the five rows rather than under them. The feed starts from
         the same query in the same order, so leaving both mounted would print
         the first five twice. -->
    <ContractFeed
      v-else
      :query="{ nodeId, rola, sort: 'kwota' }"
      empty-text="Żadna umowa tej instytucji nie pasuje do tego filtra."
      class="mt-3"
    />

    <!-- Collapsed, because the caveat has to be on the page and the page is an
         institution's, not the feature's. Eight lines of prose about the
         register on all 825 of them would be the longest thing on most. -->
    <v-expansion-panels v-if="coverage" variant="accordion" class="mt-4">
      <v-expansion-panel
        title="Skąd te dane"
        data-testid="company-contracts-source"
      >
        <v-expansion-panel-text>
          <ContractSourceNote :coverage="coverage" />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </PageSection>
</template>

<script setup lang="ts">
/** „Umowy publiczne" on an institution's page: what this body spends, right
 * under the board that spends it.
 *
 * It sits directly after `CardEmploymentHistory` in `place/DetailView.vue`
 * rather than at the foot of the page, because „and here is what that board
 * spends" only reads as a sentence next to the board. Six sections lower - past
 * the proposals, the succession changes, two owner lists and the graph - a
 * phone reader arriving cold never reaches it.
 *
 * Nothing here is a claim this site makes. A contract is a register record, so
 * no row takes the sage rail (`k-card--accent`), and the section never says
 * that an institution did anything wrong by being on the list. The one thing
 * that IS ours is the people half, and that is decided by the endpoint from a
 * verified token - see `attachPeople` in `server/utils/contracts.ts`.
 */
import { mdiFileDocumentOutline } from "@mdi/js";
import { computed, ref } from "vue";
import { useAuthState } from "~/composables/auth";
import { useContractCompany } from "~/composables/contracts";
import {
  polishCountingGenitive,
  polishCountingGrouped,
  polishNumber,
} from "~/composables/polish";
import { longDate } from "~~/shared/dates";
import { plnCompact, plnExact } from "~~/shared/money";
import { contractCounterparty, contractForms } from "~~/shared/contracts";

const props = defineProps<{
  nodeId: string;
  /** What this page calls the institution. Passed rather than refetched: the
   * page already has the node, and the section must not cost a second read of
   * it. */
  companyName: string;
}>();

const { user } = useAuthState();

/** Which side of the register to show. Rewrites the endpoint's `rola`
 * parameter rather than filtering in the browser - the five rows are the five
 * largest *of that role*, and a client-side filter over five rows would show
 * two. */
const rola = ref<"all" | "zamawiajacy" | "wykonawca">("all");

/** Set by „Pokaż wszystkie umowy", which swaps the five rows for the paging
 * feed. Never restored: a reader who asked for the full list did not ask to be
 * taken back to five. */
const showAll = ref(false);

const { data, pending } = useContractCompany(props.nodeId, { rola });

const stats = computed(() => data.value?.stats ?? null);
const rows = computed(() => data.value?.rows ?? []);
const coverage = computed(() => data.value?.coverage ?? null);
const hiddenPeople = computed(() => data.value?.hiddenPeople ?? 0);

/** „728 umów · 46,9 mln zł · mediana 1 436 zł".
 *
 * The median travels with the sum and is dropped only at n=1, where the two are
 * the same figure. The distribution is p25 384 zł, median 1 436 zł, p90 38 490
 * zł, max 1 105 491 462 zł: POLREGIO's „5 umów · 1,16 mld zł" is one contract
 * and four rounding errors, and a bare sum on 825 institution pages would read
 * as what this body typically spends.
 */
const summary = computed(() => {
  const s = stats.value;
  if (!s) return "";
  const parts = [
    polishCountingGrouped(s.totalCount, ...contractForms),
    plnCompact(s.totalValue),
  ];
  if (s.totalCount > 1) parts.push(`mediana ${plnExact(s.medianValue)}`);
  return parts.join(" · ");
});

/** The counted half of the coverage sentence, in the genitive „jest stroną …"
 * puts it in. `polishCountingGrouped` would write „stroną 2 umowy”; a bare one
 * is spelled out because „stroną 1 umowy" is how a form reads, not a sentence. */
const coverageCount = computed(() => {
  const total = stats.value?.totalCount ?? 0;
  return total === 1
    ? "jednej umowy"
    : polishCountingGenitive(total, "umowy", "umów");
});

/** The rest of it, agreeing with the count, and with both dates read off the
 * served coverage document. No literal date anywhere: the window grows the next
 * time the pipeline runs, and a hardcoded „do 10 sierpnia 2026" would become a
 * false claim about coverage with nothing failing. */
const coverageTail = computed(() => {
  const total = stats.value?.totalCount ?? 0;
  const agreed = total === 1 ? "zarejestrowanej" : "zarejestrowanych";
  const cov = coverage.value;
  const window = cov
    ? ` od ${longDate(cov.from)} do ${longDate(cov.to)}`
    : " w okresie, który pobraliśmy";
  return `${agreed} w Centralnym Rejestrze Umów${window}.`;
});

/** „Pięć największych to 81% tej kwoty."
 *
 * `topFiveShare` is recomputed by the handler from the rows it is about to
 * serve, and is null below ten contracts or below half the total - so this
 * sentence is either true of what is printed under it or absent.
 */
const concentration = computed(() => {
  const share = data.value?.topFiveShare;
  const total = stats.value?.totalCount ?? 0;
  if (total < 10 || share === null || share === undefined) return "";
  return `Pięć największych to ${Math.round(share * 100)}% tej kwoty.`;
});

const showRoleToggle = computed(
  () =>
    !!stats.value &&
    stats.value.buyerCount > 0 &&
    stats.value.supplierCount > 0,
);

const hasMore = computed(
  () => !!stats.value && stats.value.totalCount > rows.value.length,
);

const showLoginBanner = computed(() => !user.value && hiddenPeople.value > 0);

/** True when not one of the printed rows has a counterparty with a page here.
 *
 * Said out loud rather than left as an absence of links, because the absence is
 * ambiguous: it means „we do not have that company", never „nobody is behind
 * it". `companyName` is not used in the sentence - the note is about the rows,
 * not about this institution - but the prop is what lets a future wording name
 * it without another fetch.
 */
const noCounterpartyKnown = computed(
  () =>
    rows.value.length > 0 &&
    rows.value.every((row) => !contractCounterparty(row, props.nodeId)?.nodeId),
);
</script>
