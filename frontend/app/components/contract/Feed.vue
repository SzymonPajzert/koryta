<template>
  <component :is="wrapper" v-if="visible" v-bind="wrapperProps">
    <!-- One banner over the list, never one per row. Twenty rows each offering
         to show four more people is not twenty offers, it is noise that makes
         the one real offer invisible. The counted noun is spelled out because
         Polish declines it three ways and `ExploreLoginBanner` already takes
         all three - reused byte for byte rather than restyled here. -->
    <ExploreLoginBanner
      v-if="showLoginBanner"
      :hidden-count="hiddenPeople"
      :forms="[
        'osoba powiązana z tymi umowami',
        'osoby powiązane z tymi umowami',
        'osób powiązanych z tymi umowami',
      ]"
      message="Zaloguj się, żeby zobaczyć, kogo naszym zdaniem łączy stanowisko z instytucjami z tych umów."
    />

    <!-- Manual, never an intersect sentinel, for `home/EventFeed.vue`'s reason:
         a feed that loads on scroll pushes the footer - where the contact
         address and the source links live - further away every time a reader
         scrolls towards it, so it can never be reached at all. -->
    <v-infinite-scroll
      v-if="rows.length > 0"
      class="contract-feed"
      empty-text="To już wszystkie umowy, które mamy."
      load-more-text="Pokaż więcej"
      mode="manual"
      @load="loadMore"
    >
      <ContractRow
        v-for="row in rows"
        :key="row.id"
        :contract="row"
        :node-id="query.nodeId"
      />

      <!-- Vuetify shows its load-more button until a load answers „empty",
           so with nothing left to fetch the first click does nothing and the
           button only then turns into the empty text. That is most of this
           feature: the median company has two contracts against a page size of
           twenty, so on a company page the button would almost always be dead.
           `nextCursor` already says whether there is another page, so say it
           before the click rather than after. -->
      <template #load-more="{ props: loadMoreProps }">
        <v-btn
          v-if="cursor"
          variant="outlined"
          class="mt-2"
          data-testid="umowy-more"
          v-bind="loadMoreProps"
        >
          Pokaż więcej
        </v-btn>
        <p v-else class="text-caption text-ink-neutral mt-2 mb-0">
          To już wszystkie umowy, które mamy.
        </p>
      </template>
    </v-infinite-scroll>

    <!-- Only ever seen on a client-side navigation: under SSR Nuxt settles the
         fetch before it serialises the page, so the first rows arrive with the
         document. -->
    <div v-else-if="status === 'pending'" class="text-center py-8">
      <v-progress-circular indeterminate />
    </div>

    <div v-else class="k-note" data-testid="umowy-empty">
      <p class="text-body-2 mb-0">{{ emptyText }}</p>
      <v-btn
        variant="text"
        size="small"
        class="mt-1 px-0"
        @click="emit('reset')"
      >
        Pokaż wszystkie umowy
      </v-btn>
    </div>
  </component>
</template>

<script setup lang="ts">
import { useCurrentUser } from "vuefire";
import PageSection from "~/components/PageSection.vue";
import type { ContractQuery } from "~/composables/contracts";
import { fetchContractPage, useContractList } from "~/composables/contracts";
import type { ContractRow as ContractRowType } from "~~/shared/contracts";

/** A paged list of contracts, wherever one appears.
 *
 * DOCSTRING GUARDRAIL, and it is here because this component is the obvious
 * place to put the next thing: **a prop that only one caller ever sets and that
 * changes the layout is the signal to split this component, not to add a sixth
 * prop.** The four below are all read by every caller. `sectionTitle` is the
 * one that comes close, and it earns its place by keeping „a section with
 * nothing to show renders nothing at all" in one file rather than at three call
 * sites, which is the rule this repo has broken most often.
 */
const props = withDefaults(
  defineProps<{
    query: ContractQuery;
    /** Renders the list inside a `PageSection` rather than bare. A titled feed
     * with no rows renders nothing at all - no heading over empty space. */
    sectionTitle?: string;
    sectionInfo?: string;
    emptyText?: string;
  }>(),
  {
    sectionTitle: undefined,
    sectionInfo: undefined,
    emptyText: "Żadna umowa nie pasuje do tych filtrów.",
  },
);

const emit = defineEmits<{ reset: [] }>();

const user = useCurrentUser();

const { data, status } = useContractList(() => props.query);

/** The pages after the first. The first one stays in `data` so that a refetch -
 * which is what changing a filter triggers - replaces it rather than being
 * appended to what is already on screen. */
const more = ref<ContractRowType[]>([]);
const cursor = ref<string | null>(null);

watch(
  data,
  () => {
    more.value = [];
    cursor.value = data.value?.nextCursor ?? null;
  },
  { immediate: true },
);

const rows = computed<ContractRowType[]>(() => [
  ...(data.value?.rows ?? []),
  ...more.value,
]);

/** How many people this reader is not being shown, across everything loaded.
 *
 * Zero on `/umowy` today, because `/api/contracts` attaches no person data to
 * anybody - which is what keeps a page of 20 rows at ~21 billed reads. The sum
 * is computed anyway rather than hardcoded to zero: the day any list route
 * starts attaching people, the banner is already right, and a zero written in
 * by hand would be a gate that silently stopped existing.
 */
const hiddenPeople = computed(() =>
  rows.value.reduce(
    (total, row) =>
      total +
      (row.people ?? []).reduce((sum, party) => sum + party.hiddenPeople, 0),
    0,
  ),
);

const showLoginBanner = computed(() => !user.value && hiddenPeople.value > 0);

/** A titled feed with nothing in it draws nothing - not the heading, not the
 * note. The untitled one on `/umowy` still shows its empty state, because there
 * the empty state is the answer to a filter the reader just set and has to be
 * able to undo. */
const visible = computed(
  () =>
    !props.sectionTitle || rows.value.length > 0 || status.value === "pending",
);

const wrapper = computed(() => (props.sectionTitle ? PageSection : "div"));
const wrapperProps = computed(() =>
  props.sectionTitle
    ? { title: props.sectionTitle, info: props.sectionInfo }
    : {},
);

/** Requests one click is allowed to make before it gives up and returns.
 *
 * Copied from `home/EventFeed.vue` along with the widget, and for its reason: a
 * page can come back short and still carry a cursor, and a „Pokaż więcej" that
 * loads nothing looks broken. Bounded, because an unbounded retry is what an
 * auto-loading feed used to do on its own, once per animation frame.
 */
const MAX_REQUESTS_PER_LOAD = 3;

type LoadOptions = { done: (state: "ok" | "empty" | "error") => void };

async function loadMore({ done }: LoadOptions) {
  if (!cursor.value) {
    done("empty");
    return;
  }
  try {
    for (let request = 0; request < MAX_REQUESTS_PER_LOAD; request++) {
      const next = await fetchContractPage({
        ...props.query,
        cursor: cursor.value ?? undefined,
      });
      more.value.push(...next.rows);
      cursor.value = next.nextCursor;
      if (!next.nextCursor) {
        done("empty");
        return;
      }
      if (next.rows.length > 0) break;
    }
    done("ok");
  } catch {
    done("error");
  }
}
</script>

<style scoped>
/* The infinite scroll makes its root a scroll container, so anything with a
   negative margin inside it - a `v-row`, say - hangs past the edge and raises a
   horizontal scrollbar. The rows carry their own `mb-2` and owe nothing to the
   edges. */
.contract-feed {
  overflow-x: hidden;
}
</style>
