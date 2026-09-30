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
          :data-testid="item.raw.testid"
        >
          <v-list-item-title class="text-wrap">
            {{ item.raw.title }}
          </v-list-item-title>
          <v-list-item-subtitle v-if="item.raw?.subtitle" class="text-wrap">
            {{ item.raw.subtitle }}
          </v-list-item-subtitle>
        </v-list-item>
      </template>
      <!-- The heading over the names found only in the article facts. An
           entry of type `subheader` in `items`, so Vuetify's own filter drops
           it together with the last row under it rather than leaving a heading
           over nothing. -->
      <template #subheader="{ props: heading }">
        <v-list-subheader :data-testid="heading.testid">
          {{ heading.title }}
        </v-list-subheader>
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
  mdiTextSearchVariant,
} from "@mdi/js";
import { parties } from "~~/shared/misc";
import { nameMatchesTokens, searchTokens } from "~~/shared/search";
import { normalizePersonName } from "~~/shared/names";
import { factNameKey, type FactNameHit } from "~~/shared/factNames";
import { generateEntityUrl } from "~/composables/slugs";
import {
  factNameCaption,
  factNamePick,
  factNamesBesides,
  omniSearchTarget,
} from "~/composables/omniSearch";
import { trackGoal } from "~/composables/analytics";
import { authRequest, useAuthState } from "~/composables/auth";
import {
  resultBucket,
  searchPickKind,
  type SearchPickKind,
} from "~~/shared/analytics";
import type { NodeType } from "~~/shared/model";
import type { ProposableNodeType } from "~~/shared/api";
import { refDebounced } from "@vueuse/core";

const { push, currentRoute } = useRouter();

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
  // willing to add instead. The typed name is not recorded - it is somebody's
  // name, and `kind` is the part that is about the site.
  trackGoal("search:propose", { kind: type });
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
 *
 * The last branch folds diacritics, which is how /api/search/facts matches:
 * „zmudzka” finds Żmudzka there, and without it the hit would be thrown away
 * here on arrival.
 */
const matchesTypedWords = (title: string, query: string) => {
  const typed = query.trim();
  if (!typed) return true;
  if (title.toLowerCase().includes(typed.toLowerCase())) return true;
  if (nameMatchesTokens(title, searchTokens(typed))) return true;
  // Folded to nothing - punctuation alone - is not a query every row answers.
  const folded = searchTokens(normalizePersonName(typed));
  return (
    folded.length > 0 && nameMatchesTokens(normalizePersonName(title), folded)
  );
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
  path?: string;
  query?: Record<string, string>;
  hash?: string;
  /** `subheader` for a group's heading, which Vuetify draws as a heading
   * rather than as a row to pick; absent for everything else. */
  type?: "subheader";
  testid?: string;
};

const { user } = useAuthState();

/** Names that only the article facts carry, for a signed in reader - see
 * /api/search/facts. Empty for everybody else, who is not shown the facts. */
const factNames = ref<FactNameHit[]>([]);

/** The query the latest request for `factNames` was for, so that a slow
 * answer to an earlier one - or to one since cleared - does not replace it. */
let factNamesQuery = "";

watch(debouncedSearch, async (val) => {
  if (!val) {
    setTimeout(() => (nodeGroupPicked.value = null), 300);
    // Forgotten as well as emptied, so an answer still on its way for what
    // was typed before cannot put its names back under an empty box.
    factNamesQuery = "";
    factNames.value = [];
  } else {
    if (val !== nodeGroupPicked.value?.title) {
      // Not awaited: the people are what most searches are for, and they
      // should not wait for the names in the facts.
      void searchFactNames(val);
      await performSearch(val);
    }
  }
});

// Signing out takes the facts away, and the names found in them with them.
// Signing in - or the session being restored a moment after the page loads,
// which is when somebody quick is already typing - brings them for what is in
// the box.
watch(user, (current) => {
  if (!current) {
    factNamesQuery = "";
    factNames.value = [];
  } else if (debouncedSearch.value) void searchFactNames(debouncedSearch.value);
});

async function searchFactNames(searchTerm: string) {
  factNamesQuery = searchTerm;
  if (!user.value) {
    factNames.value = [];
    return;
  }
  try {
    const response = await authRequest<{ names: FactNameHit[] }>(
      "/api/search/facts",
      { method: "GET", query: { q: searchTerm } },
    );
    if (factNamesQuery === searchTerm) factNames.value = response.names;
  } catch (error) {
    // The people search above does not depend on it; a failure here leaves
    // the menu as it was before the facts had anything to add.
    console.error("Fact name search failed", error);
    if (factNamesQuery === searchTerm) factNames.value = [];
  }
}

const searchData = ref<
  Array<{
    id: string;
    name: string;
    type: string;
    query?: Record<string, string>;
  }>
>([]);

async function performSearch(searchTerm: string) {
  loading.value = true;
  try {
    const response = await $fetch("/api/search", {
      query: {
        q: searchTerm,
        latest: true,
      },
    });
    searchData.value = response;
    // Counted here rather than on every keystroke: `debouncedSearch` is what
    // reaches the server, so this is one event per query a reader actually
    // waited for. The count is bucketed and the query itself is not sent -
    // `results: none` against the total is the share of searches the index
    // cannot answer, which is the whole question.
    trackGoal("search:performed", { results: resultBucket(response.length) });
  } catch (error) {
    // A search that fails should offer nothing rather than spin forever.
    console.error("Search failed", error);
    searchData.value = [];
  } finally {
    loading.value = false;
  }
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

      result.push({
        id: `entity-${item.id}`,
        title: item.name,
        icon,
        // The type /api/search returned, not the url it produced: a company
        // with a krs filter and a company page both mean "place".
        analyticsKind: searchPickKind(itemType),
        ...routing,
      });
    });
  }

  // Under the people, and under a heading of their own: these have no page,
  // and a row that looks like the ones above would promise one. Each says
  // whose facts name them, which is also where picking it goes.
  const mentioned = factNamesBesides(
    factNames.value,
    searchData.value
      .filter((item) => item.type === "person")
      .map((item) => item.name),
  );
  if (mentioned.length > 0) {
    result.push({
      id: "fact-names-heading",
      type: "subheader",
      title: "Wspomniani w faktach",
      testid: "omni-search-fact-names",
      // A heading is never picked; these two only satisfy the row's type.
      icon: mdiTextSearchVariant,
      analyticsKind: "fact",
    });
    for (const hit of mentioned) {
      result.push({
        id: `fact-name-${factNameKey(hit.name)}`,
        title: hit.name,
        subtitle: factNameCaption(hit),
        // The icon „Fakty z artykułów” carries on a person's page, which is
        // where most of these lead.
        icon: mdiTextSearchVariant,
        analyticsKind: "fact",
        testid: "omni-search-fact-name",
        ...factNamePick(hit),
      });
    }
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
  push(omniSearchTarget(currentRoute.value, value));
  autocompleteFocus.value = false;
});
</script>

<style scoped>
.omni-search.v-autocomplete--active-menu :deep(.v-autocomplete__menu-icon) {
  transform: rotate(0deg) !important;
}
</style>
