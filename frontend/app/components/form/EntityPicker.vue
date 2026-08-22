<template>
  <div style="display: contents">
    <v-autocomplete
      v-model="model"
      v-model:search="search"
      :label="props.label"
      :hint="props.hint"
      :items="items"
      :loading="loading"
      item-title="name"
      item-value="id"
      autocomplete="off"
      no-filter
      v-bind="$attrs"
      return-object
      required
      @update:focused="(val: boolean) => val && load()"
    >
      <!-- Rendered after the results and, when nothing matched, as the empty
         state - the entry you want may well be a different Jan Kowalski than
         the one that did match. -->
      <template #append-item>
        <template v-if="createName && creatableTypes.length > 0">
          <v-divider class="my-1" />
          <v-list-item
            v-for="kind in creatableTypes"
            :key="kind"
            :data-testid="`entity-picker-add-new-${kind}`"
            :prepend-icon="mdiPlus"
            @click="openCreate(kind)"
          >
            <v-list-item-title>
              Dodaj "<strong>{{ createName }}</strong
              >"
              {{ creatableTypes.length > 1 ? asKindLabel[kind] : "do bazy." }}
            </v-list-item-title>
          </v-list-item>
        </template>
      </template>
      <template #no-data>
        <v-list-item v-if="loading">
          <v-list-item-title>Szukam...</v-list-item-title>
        </v-list-item>
        <v-list-item v-else-if="!search">
          <v-list-item-title>Zacznij pisać, aby wyszukać.</v-list-item-title>
        </v-list-item>
      </template>
    </v-autocomplete>

    <DialogProposeEditNode
      v-if="canCreate"
      ref="createDialog"
      :create-type="pendingCreateType"
      :initial-name="pendingCreateName"
      hide-activator
      skip-redirect
      @created="onCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { mdiPlus } from "@mdi/js";
import { refDebounced } from "@vueuse/core";
import { useCurrentUser } from "vuefire";
import type { NodeType, Link, Article } from "~~/shared/model";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<{
  label?: string;
  hint?: string;
  /** What may be picked. Several kinds when the caller does not care which -
   * the relation composer offers whatever the current page can be joined to,
   * and only works out the relation once one is chosen. */
  entity: NodeType | NodeType[];
}>();

const model = defineModel<Link<NodeType> | undefined>();

const search = ref("");
const debouncedSearch = refDebounced(search, 300);
const loading = ref(false);
const results = ref<Link<NodeType>[]>([]);

const user = useCurrentUser();

const entityTypes = computed<NodeType[]>(() =>
  Array.isArray(props.entity) ? props.entity : [props.entity],
);

/** What can be proposed from here. /api/revisions/create validates against the
 * person and company schemas and knows no other kind, so a region cannot be
 * created even where one can be picked.
 *
 * Where the picker offers several kinds it offers one entry per creatable kind
 * rather than none: somebody searching for a person who is not in the base yet
 * still has to be able to add them, and naming the kind on the row answers
 * "which?" without asking it as a separate question. */
const creatableTypes = computed<NodeType[]>(() =>
  entityTypes.value.filter(
    (kind) => kind === "person" || kind === "place" || kind === "topic",
  ),
);

const asKindLabel: Partial<Record<NodeType, string>> = {
  person: "jako osobę.",
  place: "jako firmę lub instytucję.",
  topic: "jako temat.",
};

const canCreate = computed(() => creatableTypes.value.length > 0);

/** Which kind the open dialog is creating. */
const pendingCreateType = ref<NodeType>("person");

/** The kinds `/api/search` cannot find.
 *
 * It matches on `nameChunksLower`, which a trigger writes for people, places
 * and regions only, and its query names those three types outright. Articles
 * and topics are therefore listed in full and filtered in the browser - there
 * are few enough of either for that to be the cheaper answer anyway.
 */
const LISTED_TYPES: readonly NodeType[] = ["article", "topic"];

const searchableTypes = computed(() =>
  entityTypes.value.filter((kind) => !LISTED_TYPES.includes(kind)),
);
const listedTypes = computed(() =>
  entityTypes.value.filter((kind) => LISTED_TYPES.includes(kind)),
);

/** A listed entry, and the link it came from where it has one.
 *
 * The url is not drawn - it is what an article can be found by. Somebody
 * looking for the piece they have just read has it open in another tab, so what
 * they reach for is the address rather than the headline. */
type Listed = Link<NodeType> & { url?: string };

/** What the listing actually holds, which is not what `Article` promises.
 *
 * `Node.name` is declared as a plain `string`; six articles on koryta.pl carry
 * an empty one and a seventh has no `name` field at all. Written down here
 * rather than asserted away, because the code below is what has to cope. */
type ListedNode = Pick<Article, "visibility" | "shortName" | "sourceURL"> & {
  name?: string | null;
};

/** Whole-collection listings, fetched once when the picker is first opened and
 * kept out of setup so a form that never opens the picker does not pay for
 * them. Keyed by kind because a picker can want both at once. */
const listed = ref<Partial<Record<NodeType, Listed[]>>>({});

async function loadListed(kind: NodeType) {
  if (listed.value[kind]) return;
  try {
    const response = await $fetch<{ nodes: Record<string, ListedNode> }>(
      "/api/nodes",
      // `latest` for a signed in reader, or they cannot see what they have just
      // made. /api/nodes is cached for six hours and this is a plain `$fetch`,
      // so without it somebody who created a topic on one article could not
      // find it from another until the cache expired.
      { query: { type: kind, ...(user.value ? { latest: true } : {}) } },
    );
    listed.value = {
      ...listed.value,
      [kind]: Object.entries(response.nodes)
        .filter(([, node]) => !!user.value || node.visibility !== false)
        .map(([id, node]) => {
          const url = typeof node.sourceURL === "string" ? node.sourceURL : "";
          return {
            type: kind,
            id,
            // The filter below used to call `toLowerCase` on this. On the one
            // article that has no `name` that threw, and it threw on every
            // render of the picker - so the whole article list came back empty
            // and no term found anything at all. The link is what is left to
            // call a nameless article by.
            name:
              (node.name ?? "").trim() || node.shortName?.trim() || url || id,
            ...(url ? { url } : {}),
          };
        }),
    };
  } catch (e) {
    console.error(`Failed to list ${kind}`, e);
    listed.value = { ...listed.value, [kind]: [] };
  }
}

async function search_(term: string) {
  if (searchableTypes.value.length === 0) return;
  loading.value = true;
  try {
    const response = await $fetch<
      Array<{ id: string; name: string; type: string }>
    >("/api/search", { query: { q: term, latest: true } });
    results.value = response
      .filter((node) => entityTypes.value.includes(node.type as NodeType))
      .map((node) => ({
        type: node.type as NodeType,
        id: node.id,
        name: node.name,
      }));
  } catch (e) {
    // A search that fails should offer nothing rather than spin forever.
    console.error("Search failed", e);
    results.value = [];
  } finally {
    loading.value = false;
  }
}

/** Both halves, because a picker can be asked for a mix. The relation composer
 * on an article offers people, places and topics at once: the first two have to
 * be searched and the third has to be listed, and until this did both, asking
 * for any listed kind alongside a searchable one silently returned only the
 * listed one. */
async function load() {
  loading.value = true;
  try {
    await Promise.all(listedTypes.value.map(loadListed));
    const term = (search.value || "").trim();
    if (term) await search_(term);
  } finally {
    loading.value = false;
  }
}

watch(debouncedSearch, async (term) => {
  if (searchableTypes.value.length === 0) return;
  const trimmed = (term || "").trim();
  if (!trimmed || trimmed === model.value?.name) {
    results.value = [];
    return;
  }
  await search_(trimmed);
});

/** What two spellings of the same link have in common.
 *
 * A url pasted out of the address bar and the one we stored differ in ways that
 * are not the article: the scheme, a `www.`, a trailing slash, and whether the
 * Polish letters in the slug arrive percent-encoded or as themselves. */
function urlKey(value: string) {
  let plain = value;
  try {
    plain = decodeURI(value);
  } catch {
    // A stray `%` is not an escape; match on what was typed instead.
  }
  return plain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/** Whether to try the term against links at all.
 *
 * Only what reads as one - a slash or a dotted domain. A headline word would
 * otherwise turn up every article whose slug happens to contain it, which is
 * most of them for a term as short as "sad". */
function looksLikeLink(term: string) {
  return term.includes("/") || /\.[a-z]{2,}/i.test(term);
}

const items = computed<Listed[]>(() => {
  // Trimmed, because a url arrives pasted and a paste brings whitespace with
  // it often enough that the match would be lost to a trailing space.
  const term = (search.value || "").trim().toLowerCase();
  const asLink = looksLikeLink(term) ? urlKey(term) : "";
  const fromListings = listedTypes.value.flatMap((kind) =>
    (listed.value[kind] ?? []).filter(
      (entry) =>
        entry.name.toLowerCase().includes(term) ||
        (!!asLink && !!entry.url && urlKey(entry.url).includes(asLink)),
    ),
  );
  const base = [...results.value, ...fromListings];

  // The picked entry has to stay in the list, or the autocomplete has no title
  // to render for it once the search that found it has been cleared.
  const picked = model.value;
  if (picked && !base.some((item) => item.id === picked.id)) {
    return [...base, picked];
  }
  return base;
});

/** What to offer creating, empty while the results for it are still on the way:
 * otherwise "dodaj do bazy" flashes up as the only option during the debounce,
 * tempting people to add somebody who is already there. */
const createName = computed(() => {
  if (loading.value) return "";
  const settled = (debouncedSearch.value || "").trim();
  if (!settled || settled !== (search.value || "").trim()) return "";
  return settled;
});

// Captured on click, because opening the dialog blurs the autocomplete, which
// can reset `search` before the dialog reads the name to prefill.
const pendingCreateName = ref("");
const createDialog = ref<{ open: () => void } | null>(null);

function openCreate(kind: NodeType) {
  pendingCreateName.value = createName.value;
  pendingCreateType.value = kind;
  createDialog.value?.open();
}

function onCreated(id: string) {
  const created = {
    type: pendingCreateType.value,
    id,
    name: pendingCreateName.value,
  };
  results.value = [created];
  // A listed kind is not searched, so a freshly created one is only findable
  // if it is put into the listing it would otherwise wait for a reload to
  // appear in.
  const existing = listed.value[created.type];
  if (existing) {
    listed.value = { ...listed.value, [created.type]: [created, ...existing] };
  }
  model.value = created;
  search.value = pendingCreateName.value;
}
</script>
