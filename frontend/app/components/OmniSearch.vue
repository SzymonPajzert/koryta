<template>
  <div style="display: contents">
    <v-autocomplete
      id="omni-search"
      v-model="nodeGroupPicked"
      v-model:focused="autocompleteFocus"
      v-model:search="search"
      label="Szukaj osób, spółek, regionów..."
      :items="items"
      item-title="title"
      item-value="id"
      return-object
      autocomplete="off"
      class="ma-2 omni-search"
      bg-color="white"
      :rounded="true"
      :width
      density="comfortable"
      :hide-details="true"
      :menu-icon="mdiMagnify"
      :custom-filter="matchesTypedWords"
      clearable
      :loading="loading"
      single-line
      flat
      variant="solo-filled"
      :menu-props="menuProps"
      @click:clear="nodeGroupPicked = null"
    >
      <!-- The name is written as a child element rather than handed over as
           the `title` prop, because Vuetify clips `.v-list-item-title` to one
           line with an ellipsis and half the index is register names 90
           characters long - every hospital's row read „SAMODZIELNY PUBLICZNY
           ZAKŁAD OPIEKI ZDROWOTNEJ WOJEWÓDZKI SZPITAL…”, which tells two of
           them apart in no way at all. `itemProps` still carries `title`, so it
           is dropped here: left in, VListItem renders its own title element too
           and the name appears twice. The subtitle follows for the same reason
           - as a prop it would render above the name, not under it. -->
      <template #item="{ props: itemProps, item }">
        <v-list-item
          v-bind="itemProps"
          :title="undefined"
          :prepend-icon="item.raw.icon"
        >
          <v-list-item-title class="text-wrap">
            {{ item.raw.title }}
          </v-list-item-title>
          <v-list-item-subtitle v-if="item.raw?.subtitle" class="text-wrap">
            {{ item.raw.subtitle }}
          </v-list-item-subtitle>
        </v-list-item>
      </template>
      <template #no-data>
        <v-list-item v-if="!search">
          <v-list-item-title> Ładuję dane... </v-list-item-title>
        </v-list-item>
      </template>
      <!-- Rendered after the results and, when nothing matched, as the empty
         state. Adding a person is the main way new entries get created. -->
      <template #append-item>
        <template v-if="createName">
          <v-divider class="my-1" />
          <v-list-item
            v-for="option in createOptions"
            :key="option.type"
            :data-testid="`omni-search-add-${option.type}`"
            :prepend-icon="option.icon"
            @click="openCreate(option.type)"
          >
            <v-list-item-title>
              {{ option.label }} "{{ createName }}"
            </v-list-item-title>
          </v-list-item>
        </template>
      </template>
    </v-autocomplete>

    <DialogProposeEditNode
      ref="createDialog"
      :key="createType"
      :create-type="createType"
      :initial-name="pendingCreateName"
      hide-activator
      @created="onNodeCreated"
    />
  </div>
</template>

<script setup lang="ts">
import {
  mdiAccountOutline,
  mdiAccountPlusOutline,
  mdiDomain,
  mdiDomainPlus,
  mdiFilePlusOutline,
  mdiFlag,
  mdiFormatListBulletedType,
  mdiMagnify,
  mdiMapMarkerRadiusOutline,
} from "@mdi/js";
import { parties } from "~~/shared/misc";
import { nameMatchesTokens, searchTokens } from "~~/shared/search";
import { generateEntityUrl } from "~/composables/slugs";
import { omniSearchTarget } from "~/composables/omniSearch";
import { trackGoal } from "~/composables/analytics";
import {
  resultBucket,
  searchPickKind,
  unverifiedShare,
  type SearchPickKind,
} from "~~/shared/analytics";
import {
  SearchSession,
  settledSearchProps,
  type SettledSearch,
} from "~~/shared/searchSession";
import { noteSearchPick } from "~/composables/teaserJourney";
import type { NodeType } from "~~/shared/model";
import type { ProposableNodeType } from "~~/shared/api";
import { refDebounced } from "@vueuse/core";
import { useCurrentUser } from "vuefire";
import { authHeaders } from "~/composables/auth";

const router = useRouter();
const { push, currentRoute } = router;
const user = useCurrentUser();

const props = defineProps<{
  width?: string;
}>();
const { width = "300px" } = props;

/** How wide the results menu may get.
 *
 * The menu is at least as wide as the field, and with the rows wrapping rather
 * than clipped it would otherwise stretch to whatever the viewport allows - a
 * full-width sheet hanging off a 300px field. 520px is a 90-character register
 * name in two lines, and on a phone the overlay clamps to the viewport anyway. */
const menuProps = { maxWidth: 520 };

const loading = ref(false);
const search = ref();
const nodeGroupPicked = ref<ListItem | null>(null);
const autocompleteFocus = ref(false);
const debouncedSearch = refDebounced(search, 300);
const createDialog = ref<{ open: () => void } | null>(null);

/** The query to offer as a new person, empty when there is nothing to add.
 *
 * Only offered once the results for the current query have actually arrived.
 * Otherwise "dodaj nową osobę" would flash up as the only option during the
 * debounce, tempting people to add someone who is already in the database. */
const createName = computed(() => {
  if (loading.value) return "";
  const settled = (debouncedSearch.value || "").trim();
  if (!settled || settled !== (search.value || "").trim()) return "";
  return settled;
});

/** What a search that found nothing can be turned into.
 *
 * A person is first because it is what most searches are for, but a claim
 * usually needs the institution and the source as well, and neither of those
 * could be entered from anywhere in the site before. */
const createOptions = [
  {
    type: "person" as const,
    label: "Dodaj nową osobę",
    icon: mdiAccountPlusOutline,
  },
  {
    type: "place" as const,
    label: "Dodaj instytucję lub spółkę",
    icon: mdiDomainPlus,
  },
  { type: "article" as const, label: "Dodaj źródło", icon: mdiFilePlusOutline },
];

/** The subset of ProposableNodeType the search box actually offers. Narrower
 * than the dialog's own type on purpose: a goal exists for each of these three,
 * and a fourth added to `createOptions` should not compile until it has one. */
type CreatableFromSearch = (typeof createOptions)[number]["type"];

// Captured on click, because opening the dialog blurs the autocomplete, which
// can reset `search` before the dialog reads the name to prefill.
const pendingCreateName = ref("");
const createType = ref<ProposableNodeType>("person");

const openCreate = async (type: CreatableFromSearch) => {
  // Recorded before the dialog opens, because this is the interesting event on
  // its own: it says the search could not answer, and what the reader was
  // willing to add instead. The typed name is not part of it - `kind` is the
  // part that is about the site - and goes once, on search:settled, below.
  trackGoal("search:propose", { kind: type });
  report(searchSession.propose());
  pendingCreateName.value = createName.value;
  createType.value = type;
  // The dialog is keyed by type, so it is a different component instance once
  // the type changes - open it after Vue has swapped it in.
  await nextTick();
  createDialog.value?.open();
};

const onNodeCreated = () => {
  // The dialog redirects to the new page, just reset the search box behind it
  search.value = null;
  nodeGroupPicked.value = null;
  autocompleteFocus.value = false;
};

/** Which of the items on the menu survive what has been typed.
 *
 * Vuetify filters the list again on the client, and its own filter wants the
 * query to appear in the title as one substring - which threw away every hit
 * `/api/search` had just gone out of its way to find, "Andrzej Namysło" being
 * nowhere inside "Andrzej Józef Namysło". Matching each typed word against a
 * different word of the title is the rule the server now searches by, so the
 * two agree on what a hit is.
 *
 * The substring test stays as the first branch: the parties and „Lista
 * wszystkich osób” are client-side entries that never go near the server, and
 * they were being narrowed by exactly that rule.
 */
const matchesTypedWords = (title: string, query: string) => {
  const typed = query.trim();
  if (!typed) return true;
  if (title.toLowerCase().includes(typed.toLowerCase())) return true;
  return nameMatchesTokens(title, searchTokens(typed));
};

type ListItem = {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  /** Which search:pick-* goal this entry converts, set where the entry is
   * built. It replaces a `logEventKey` that carried content_id/content_type for
   * an analytics call that no longer existed - nothing read it, so every hit
   * was describing itself to nobody. */
  analyticsKind: SearchPickKind;
  /** The node a search hit opens, for telling its page that the search box
   * sent the reader there (`noteSearchPick`). */
  nodeId?: string;
  /** Whether the hit is a person nobody has published - a teaser rather than a
   * page, for a logged out reader. Not drawn, only kept with the search that
   * opened it. */
  unverified?: boolean;
  path?: string;
  query?: Record<string, string>;
};

/** The searches typed into the box, each reported once it is settled - see
 * `shared/searchSession.ts`, which also says why the query is kept at all. */
const searchSession = new SearchSession();

/** Reports a settled search, if one was, to both places that keep them. The
 * site's own log gets everybody's, and works out itself whether somebody was
 * signed in. Plausible gets a logged out reader's only: they are who the
 * question is about; a signed in reader's searches are their research, and
 * the owner's alone would outnumber everybody else's. */
function report(search: SettledSearch | undefined) {
  if (!search) return;
  record(search);
  if (!user.value) trackGoal("search:settled", settledSearchProps(search));
}

/** Sends a settled search to the site's own log (`shared/searchLog.ts`). Fire
 * and forget: losing a record is better than a search box that waits on its
 * own bookkeeping. `keepalive`, so the record of a reader leaving the page
 * still goes out as the page goes. */
function record(search: SettledSearch) {
  authHeaders(user.value)
    .then((headers) =>
      $fetch("/api/search/log", {
        method: "POST",
        body: search,
        headers,
        keepalive: true,
      }),
    )
    .catch((error) => console.error("Search log failed", error));
}

// A search nobody took anything from is still a search - and the one that
// found nothing is the one most worth knowing about. Settled when the reader
// hides the page, or leaves it some way other than through the box: before the
// navigation, so it is counted on the page it was typed on. Both go out with
// `keepalive`, so the one from a closing tab still arrives.
const leaveBox = () => report(searchSession.abandon());
const onVisibility = () => {
  if (document.visibilityState === "hidden") leaveBox();
};
let stopRouteWatch: (() => void) | undefined;
onMounted(() => {
  document.addEventListener("visibilitychange", onVisibility);
  stopRouteWatch = router.beforeEach(() => {
    leaveBox();
  });
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibility);
  stopRouteWatch?.();
});

watch(debouncedSearch, async (val) => {
  if (!val) {
    leaveBox();
    setTimeout(() => (nodeGroupPicked.value = null), 300);
  } else {
    if (val !== nodeGroupPicked.value?.title) {
      await performSearch(val);
    }
  }
});

const searchData = ref<
  Array<{
    id: string;
    name: string;
    type: string;
    /** False for a page nobody has published. */
    published?: boolean;
    query?: Record<string, string>;
  }>
>([]);

async function performSearch(searchTerm: string) {
  loading.value = true;
  try {
    // Drafts for a signed in reader, beside the token that allows them. The
    // flag went out for everybody, so the search box offered every name in
    // the base - nine in ten of the people among them unpublished - and could
    // never be answered from the cache. Without it a logged out reader's
    // search is, and finds the pages they can open.
    const response = await $fetch("/api/search", {
      query: {
        q: searchTerm,
        ...(user.value ? { latest: true } : {}),
      },
      headers: await authHeaders(user.value),
    });
    searchData.value = response;
    const unverified = response.filter(isUnverifiedPerson).length;
    // Counted here rather than on every keystroke: `debouncedSearch` is what
    // reaches the server, so this is one event per query a reader actually
    // waited for. The count is bucketed and the query itself is not sent -
    // `results: none` against the total is the share of searches the index
    // cannot answer, which is the whole question.
    trackGoal("search:performed", {
      results: resultBucket(response.length),
      unverified: unverifiedShare(response.length, unverified),
    });
    report(searchSession.results(searchTerm, response.length, unverified));
  } catch (error) {
    // A search that fails should offer nothing rather than spin forever.
    console.error("Search failed", error);
    searchData.value = [];
  } finally {
    loading.value = false;
  }
}

/** A hit that is a person nobody has published. */
function isUnverifiedPerson(hit: { type: string; published?: boolean }) {
  return hit.type === "person" && hit.published === false;
}

// Not sure what it does
// watch(autocompleteFocus, (focused) => {
//   if (focused) {
//     refresh();
//   }
// });

const items = computed<ListItem[]>(() => {
  const result: ListItem[] = [];
  result.push({
    id: "all-persons",
    title: "Lista wszystkich osób",
    icon: mdiFormatListBulletedType,
    path: "/eksploruj/tabela",
    analyticsKind: "list",
  });

  parties.forEach((item) => {
    result.push({
      id: `party-${item}`,
      title: item,
      icon: mdiFlag,
      subtitle: "Partia",
      path: "/eksploruj/tabela",
      query: {
        party: item,
      },
      analyticsKind: "party",
    });
  });

  if (searchData.value) {
    searchData.value.forEach((item) => {
      const itemType = (item.type || "place") as NodeType;

      // Choose icon based on type
      let icon = mdiDomain;
      if (itemType === "person") icon = mdiAccountOutline;
      else if (itemType === "region") icon = mdiMapMarkerRadiusOutline;

      // If the /api/search returns query - use it
      const hasQuery =
        item?.query && Object.values(item.query).filter(Boolean).length > 0;
      const routing: Record<string, unknown> = hasQuery
        ? { path: "/eksploruj/tabela", query: item.query }
        : { path: generateEntityUrl(itemType, item.id!, item.name) };

      // An unpublished person is drawn like any other hit. Whose page is a
      // teaser is the page's to explain, not the search box's to label.
      result.push({
        id: `entity-${item.id}`,
        title: item.name,
        icon,
        // The type /api/search returned, not the url it produced: a company
        // with a krs filter and a company page both mean "place".
        analyticsKind: searchPickKind(itemType),
        nodeId: item.id,
        unverified: isUnverifiedPerson(item),
        ...routing,
      });
    });
  }

  return result;
});

watch(nodeGroupPicked, (value) => {
  if (!value) {
    return;
  }

  // `analyticsKind` rather than the destination, because several entries lead
  // to the same place: a party and „Lista wszystkich osób” both open
  // /eksploruj/tabela, and telling those apart is most of the point - one is a
  // reader with something in mind, the other is a reader giving up on typing.
  // Defaulted, because the value arrives from VAutocomplete's model and a test
  // may hand over a partial entry.
  trackGoal("search:pick", { kind: value.analyticsKind ?? "place" });
  report(
    searchSession.pick(
      value.analyticsKind ?? "place",
      value.unverified === true,
    ),
  );
  // Before navigating, so the page it opens can tell it was searched for.
  noteSearchPick(value.nodeId);
  push(omniSearchTarget(currentRoute.value, value));
  autocompleteFocus.value = false;
});
</script>

<style scoped>
.omni-search.v-autocomplete--active-menu :deep(.v-autocomplete__menu-icon) {
  transform: rotate(0deg) !important;
}

/* One edge, white, still a pill - search is the one field that is. Vuetify's
   solo-filled draws a grey overlay and a shadow; `flat` takes the shadow, and
   the overlay goes here, so what is left is the hairline. */
.omni-search :deep(.v-field) {
  border: 1px solid var(--k-line);
  transition: border-color 0.15s ease;
}

.omni-search :deep(.v-field__overlay) {
  opacity: 0;
}

.omni-search :deep(.v-field--focused) {
  border-color: var(--k-line-strong);
}

@media (hover: hover) {
  .omni-search :deep(.v-field:hover) {
    border-color: var(--k-line-strong);
  }
}
</style>
