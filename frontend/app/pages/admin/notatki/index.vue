<template>
  <div class="w-100">
    <ExploreNodeDrawer
      v-model="openDrawer"
      :node="focusedNode"
      :edges="focusedEdges"
      :company-regions="companyRegions"
      @changed="refreshFocusedEdges()"
    />

    <AdminPageHead
      title="Wszystkie notatki"
      lead="Źródła, poprawki i braki, które zalogowani dopisali do stron."
    >
      <template #actions>
        <v-btn
          color="primary"
          variant="tonal"
          :prepend-icon="mdiGestureTapButton"
          to="/admin/notatki/kategoryzacja"
        >
          Kategoryzuj
        </v-btn>
      </template>
    </AdminPageHead>

    <v-alert
      v-if="singleNote"
      class="mb-4"
      type="info"
      variant="tonal"
      density="compact"
    >
      <div class="d-flex align-center justify-space-between flex-wrap ga-2">
        <span>Pojedyncza notatka, otwarta z linku.</span>
        <v-btn
          size="small"
          variant="text"
          :prepend-icon="mdiFormatListBulleted"
          @click="filterNote = null"
        >
          Pokaż wszystkie
        </v-btn>
      </div>
    </v-alert>

    <!-- The filters are controls over the table, not a record of their own, so
         they sit on the page rather than in a card. On a phone the two short
         selects go two to a line: stacked one above the other they were five
         fields, about 260px, before the first note. „Typ zgłoszenia” and
         „Status” take a line each there: at half a phone's width the first
         was cut to „Typ zgłoszen…”, and once it has a line of its own,
         „Status” has one either way - the whole of it rather than half,
         beside a gap. -->
    <div v-else class="mb-4">
      <v-row dense>
        <v-col cols="12" md="4">
          <v-text-field
            v-model="searchInput"
            label="Szukaj w treści, źródle i nazwie"
            :prepend-inner-icon="mdiMagnify"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
        <v-col cols="6" md="2">
          <v-select
            v-model="filterNodeType"
            :items="nodeTypeFilterOptions"
            label="Typ węzła"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
        <v-col cols="6" md="2">
          <v-select
            v-model="filterKind"
            :items="kindFilterOptions"
            label="Rodzaj"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
        <v-col cols="12" sm="6" md="2">
          <v-select
            v-model="filterAdminType"
            :items="adminTypeFilterOptions"
            label="Typ zgłoszenia"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
        <v-col cols="12" sm="6" md="2">
          <v-select
            v-model="filterStatus"
            :items="statusFilterOptions"
            label="Status"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
      </v-row>
    </div>

    <!-- A failed load used to empty the table and read as "Brak notatek", the
         same as a clean queue. The table steps aside for the error, and comes
         back with the next load that succeeds - a retry here, or a filter
         change above. -->
    <div v-if="loadError" class="mb-4">
      <v-alert type="error" variant="tonal">
        Nie udało się załadować notatek.
      </v-alert>
      <v-btn class="mt-3" variant="tonal" :loading="pending" @click="load()">
        Spróbuj ponownie
      </v-btn>
    </div>

    <!-- Runs edge to edge on a phone, where each note becomes a stack of label
         and value (`mobile-breakpoint`) instead of a desktop row scrolled
         sideways inside the screen. -->
    <v-card v-else class="notes-table k-bleed-xs">
      <!-- In Polish: the site registers no Vuetify locale yet, and the phone
           layout brings Vuetify's own sort picker, which said „Sort by”, and
           its pagination's English aria labels with it. -->
      <v-locale-provider locale="pl" :messages="tableMessages">
        <v-data-table-server
          v-model:items-per-page="itemsPerPage"
          v-model:page="page"
          v-model:sort-by="sortBy"
          density="compact"
          mobile-breakpoint="sm"
          :headers="headers"
          :items="items"
          :items-length="total"
          :loading="pending"
          item-value="key"
          :no-data-text="noDataText"
          loading-text="Ładowanie…"
          items-per-page-text="Wierszy na stronę:"
          page-text="{0}-{1} z {2}"
          :items-per-page-options="[10, 25, 50, 100]"
        >
          <!-- When and who, in one column: seven columns needed about 1,250px,
               and in the page's 1,168 the note was the one that gave way, down
               to a 260px sliver. The date doubles as the entry's permalink. A
               reviewer working through the queue needs a way to hand one row to
               somebody else, and the date is the one cell that was carrying
               nothing else. -->
          <template #[`item.createdAt`]="{ item }">
            <div class="added-cell">
              <NuxtLink
                class="text-no-wrap text-caption"
                :to="{ path: '/admin/notatki', query: { note: item.key } }"
                title="Link do tej notatki"
              >
                {{ formatMoment(item.createdAt) }}
              </NuxtLink>
              <UserChip :uid="item.userUid" />
            </div>
          </template>

          <template #[`item.nodeName`]="{ item }">
            <div class="node-cell">
              <v-icon
                :icon="item.nodeType ? entityIcon(item.nodeType) : mdiHelp"
                size="small"
                class="text-medium-emphasis flex-shrink-0"
              />
              <!-- A button, so the side panel opens from the keyboard too: it
                   was an `<a>` with no href, which Tab never reached. -->
              <button
                type="button"
                class="text-primary node-link"
                :title="item.nodeName ?? item.nodeId"
                @click="focusNode(item)"
              >
                <span class="node-label">{{
                  item.nodeName ?? item.nodeId
                }}</span>
              </button>
              <!-- A 16px glyph right after the name, its 40px target drawn
                   around it by `::before` rather than taking width. As a
                   40px icon button in the line it left the name about 130px
                   in a 200px column: names that fit broke onto two lines,
                   and the glyph floated at the box's edge instead of after
                   the name. -->
              <NuxtLink
                v-if="item.nodeName && item.nodeType"
                :to="
                  generateEntityUrl(item.nodeType, item.nodeId, item.nodeName)
                "
                target="_blank"
                class="node-open text-medium-emphasis flex-shrink-0"
                aria-label="Otwórz stronę w nowej karcie"
                title="Otwórz stronę w nowej karcie"
              >
                <v-icon :icon="mdiOpenInNew" size="16" />
              </NuxtLink>
            </div>
          </template>

          <template #[`item.note`]="{ item }">
            <div class="note-cell">
              <!-- What the author said the note is, over what they wrote: it
                   was a column of its own, and is still a filter above. -->
              <v-chip
                :color="noteKindConfig[item.kind].color"
                variant="tonal"
                size="x-small"
                class="mb-1"
              >
                <v-icon start :icon="noteKindConfig[item.kind].icon" />
                {{ noteKindConfig[item.kind].title }}
              </v-chip>
              <!-- Clamped in the queue so a page of rows stays scannable, whole
                   when the link opened this one entry - there is nothing below
                   it to keep short for. -->
              <div
                v-if="item.note"
                :class="singleNote ? 'note-text-full' : 'note-text'"
                :title="item.note"
              >
                {{ item.note }}
              </div>
              <!-- A source with neither text nor url would leave the kind chip
                   alone in the cell, which reads as a row that failed to
                   load. -->
              <div
                v-else-if="!item.url"
                class="text-body-2 text-medium-emphasis"
              >
                Bez treści
              </div>
              <!-- A link only for an address. Readers type "gazeta, strona 3"
                   into the url field, and bound as an `href` that opened
                   /admin/gazeta,%20strona%203 in a new tab; a bare host such
                   as "wyborcza.pl/x" did the same. It is printed as text
                   instead, and a bare host gets its scheme. -->
              <a
                v-if="item.url && sourceDomain(item.url)"
                :href="withHttpScheme(item.url)"
                :title="item.url"
                target="_blank"
                rel="noopener noreferrer"
                class="note-link text-caption"
              >
                <v-icon :icon="mdiLink" size="x-small" class="flex-shrink-0" />
                <span class="note-url">{{ item.url }}</span>
              </a>
              <span
                v-else-if="item.url"
                class="note-link text-caption text-medium-emphasis"
                :title="item.url"
              >
                <span class="note-url">{{ item.url }}</span>
              </span>
            </div>
          </template>

          <!-- Both verdict chips open a menu, so they carry the menu's chevron,
               and the menu marks the value already set - in Vuetify's neutral
               active tint, no colour of its own. -->
          <template #[`item.adminStatus`]="{ item }">
            <v-menu>
              <template #activator="{ props: activator }">
                <v-chip
                  v-bind="activator"
                  :color="statusColors[item.adminStatus ?? 'none']"
                  :disabled="saving[item.key]"
                  :append-icon="mdiMenuDown"
                  variant="tonal"
                  size="small"
                  class="my-2"
                >
                  {{ statusLabels[item.adminStatus ?? "none"] }}
                </v-chip>
              </template>
              <v-list density="compact">
                <v-list-item
                  v-for="option in statusOptions"
                  :key="option.value ?? 'none'"
                  :title="option.title"
                  :active="(item.adminStatus ?? null) === option.value"
                  @click="patchRow(item, { adminStatus: option.value })"
                />
              </v-list>
            </v-menu>
          </template>

          <template #[`item.adminType`]="{ item }">
            <v-menu>
              <template #activator="{ props: activator }">
                <v-chip
                  v-bind="activator"
                  :disabled="saving[item.key]"
                  :color="adminTypeChip(item).color"
                  :append-icon="mdiMenuDown"
                  variant="outlined"
                  size="small"
                  class="my-2"
                >
                  <v-icon
                    v-if="adminTypeChip(item).icon"
                    start
                    :icon="adminTypeChip(item).icon"
                  />
                  {{ adminTypeChip(item).title }}
                </v-chip>
              </template>
              <v-list density="compact">
                <v-list-item
                  v-for="option in adminTypeOptions"
                  :key="option.value || 'none'"
                  :title="option.title"
                  :active="isAdminType(item, option.value)"
                  @click="patchRow(item, { adminType: option.value })"
                />
              </v-list>
            </v-menu>
          </template>
        </v-data-table-server>
      </v-locale-provider>
    </v-card>

    <!-- The verdict is shown before the server has it, so when the write
         fails the chip snaps back - and says why rather than only moving. -->
    <v-snackbar
      :model-value="!!failure"
      color="error"
      timeout="4000"
      @update:model-value="failure = ''"
    >
      {{ failure }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import {
  mdiCommentQuestionOutline,
  mdiFormatListBulleted,
  mdiGestureTapButton,
  mdiHelp,
  mdiLink,
  mdiMagnify,
  mdiMenuDown,
  mdiOpenInNew,
} from "@mdi/js";
import { computed, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { en, pl } from "vuetify/locale";
import { authRequest } from "~/composables/auth";
import { entityIcon } from "~/utils/entityIcon";
import { sourceDomain } from "~/utils/sourceDomain";
import { useEdges } from "~/composables/edges";
import {
  noteAdminTypeConfig,
  noteAdminTypeLabel,
  noteKindConfig,
} from "~/composables/notes";
import { useQueryFilters } from "~/composables/queryFilters";
import { generateEntityUrl } from "~/composables/slugs";
import { formatMoment } from "~/utils/moment";
import type {
  NodeMaybeRich,
  NodeType,
  NoteAdminStatus,
  NoteRow,
  Node,
} from "~~/shared/model";
import { withHttpScheme } from "~~/shared/url";

// The layout's own column, like every other page: the h1 at the same inset as
// the public pages', and five columns that fit its 1,168px instead of seven
// spread across the whole screen.
definePageMeta({
  middleware: "admin",
});

useHead({ title: "Notatki (Admin) - koryta.pl" });

const route = useRoute();
const { setQuery, stringFilter, numberFilter } = useQueryFilters({
  resetOnChange: ["page"],
});

const DEFAULT_ITEMS_PER_PAGE = 25;

const page = computed<number>({
  get: () => numberFilter("page").value ?? 1,
  set: (val) => void setQuery({ page: val > 1 ? String(val) : undefined }),
});

const itemsPerPage = computed<number>({
  get: () => numberFilter("itemsPerPage").value ?? DEFAULT_ITEMS_PER_PAGE,
  set: (val) =>
    void setQuery({
      itemsPerPage: val === DEFAULT_ITEMS_PER_PAGE ? undefined : String(val),
      page: undefined,
    }),
});

type SortEntry = { key: string; order: "asc" | "desc" };

// The queue is a queue: newest first unless the admin says otherwise, which is
// the one ordering the page could not offer before.
const sortBy = computed<SortEntry[]>({
  get: () => {
    const key = (route.query.sortBy as string | undefined) || "createdAt";
    const order: "asc" | "desc" =
      route.query.sortBy && route.query.sortDesc !== "true" ? "asc" : "desc";
    return [{ key, order }];
  },
  set: (val) => {
    const sort = val[0];
    void setQuery({
      sortBy: sort?.key,
      sortDesc: sort ? String(sort.order === "desc") : undefined,
      page: undefined,
    });
  },
});

const filterKind = stringFilter("kind");
const filterStatus = stringFilter("status");
const filterAdminType = stringFilter("adminType");
const filterNodeType = stringFilter("nodeType");
const filterSearch = stringFilter("q");

/** The entry a permalink named, if this page was opened from one. Not a filter
 * but a selector - it addresses one row, so the filters have nothing left to
 * narrow and are put away while it is set. */
const filterNote = stringFilter("note");
const singleNote = computed(() => Boolean(filterNote.value));

// Typing runs ahead of the url so every keystroke does not push a history entry
// and a request.
const searchInput = ref(filterSearch.value);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, (value) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filterSearch.value = value || null;
  }, 300);
});
watch(filterSearch, (value) => {
  if (value !== searchInput.value) searchInput.value = value;
});

/** Polish for the table, English kept as the fallback the app's own Vuetify
 * instance has. */
const tableMessages = { en, pl };

const headers = [
  // The author sits under the date and the kind on top of the note, so the
  // note keeps the width the two columns of their own took from it.
  { title: "Dodano", key: "createdAt", sortable: true, width: 200 },
  { title: "Węzeł", key: "nodeName", sortable: true },
  {
    title: "Notatka",
    key: "note",
    sortable: false,
    // A phone gives the note the whole width of its card - see the styles.
    cellProps: { class: "notes-table__note" },
  },
  // Same order as the filters above the table, so the eye moves between the
  // two without re-reading the labels.
  { title: "Typ zgłoszenia", key: "adminType", sortable: false },
  { title: "Status", key: "adminStatus", sortable: true },
];

const kindFilterOptions = Object.entries(noteKindConfig).map(
  ([value, config]) => ({ title: config.title, value }),
);

const statusFilterOptions = [
  // Not a stored status but the one the dashboard counts, so the number on it
  // has a page that shows exactly those rows.
  { title: "Wymagające działania", value: "needs_action" },
  { title: "Bez statusu", value: "none" },
  { title: "Nierozwiązane", value: "unresolved" },
  { title: "Rozwiązane", value: "resolved" },
];

const nodeTypeLabels: Record<NodeType, string> = {
  person: "Osoba",
  place: "Instytucja",
  article: "Artykuł",
  region: "Region",
  topic: "Temat",
};

const nodeTypeFilterOptions = Object.entries(nodeTypeLabels).map(
  ([value, title]) => ({ title, value }),
);

const statusLabels: Record<string, string> = {
  none: "Bez statusu",
  unresolved: "Nierozwiązane",
  resolved: "Rozwiązane",
};

const statusColors: Record<string, string> = {
  none: "grey",
  unresolved: "warning",
  resolved: "success",
};

const statusOptions: { title: string; value: NoteAdminStatus | null }[] = [
  { title: "Bez statusu", value: null },
  { title: "Nierozwiązane", value: "unresolved" },
  { title: "Rozwiązane", value: "resolved" },
];

const adminTypeOptions = [
  { title: "Brak", value: "" },
  ...Object.entries(noteAdminTypeConfig).map(([value, config]) => ({
    title: config.title,
    value,
  })),
];

// The two states the phone queue leaves behind are what an admin sitting at
// the table most wants to pull up, so they are filters of their own.
const adminTypeFilterOptions = [
  { title: "Do oceny tutaj", value: "deferred" },
  { title: "Nieokreślony", value: "none" },
  ...adminTypeOptions.filter((option) => option.value !== ""),
];

/** Whether a menu option is the type a row holds. „Brak” only for an entry
 * nobody has looked at: one the phone queue handed back reads „Do oceny
 * tutaj” on its chip, so marking „Brak” in the menu under it would contradict
 * the chip. */
const isAdminType = (row: NoteRow, value: string) =>
  value === ""
    ? !row.adminType && !row.adminTypeDeferred
    : row.adminType === value;

/** An entry the phone queue handed back is the one this column is being asked
 * about, so it says so rather than reading as untouched. */
const adminTypeChip = (row: NoteRow) =>
  !row.adminType && row.adminTypeDeferred
    ? {
        title: "Do oceny tutaj",
        color: "warning",
        icon: mdiCommentQuestionOutline,
      }
    : {
        title: noteAdminTypeLabel(row.adminType),
        color: undefined,
        icon: undefined,
      };

const items = ref<NoteRow[]>([]);
const total = ref(0);
const pending = ref(false);
/** The last load failed - which an empty table would otherwise pass off as a
 * queue with nothing in it. */
const loadError = ref(false);
const saving = ref<Record<string, boolean>>({});
/** What went wrong with the last verdict's write, if anything. */
const failure = ref("");

/** Nothing to show for these filters is a different answer from nothing to
 * show at all, and the first one is fixed above the table. */
const noDataText = computed(() =>
  filterKind.value ||
  filterStatus.value ||
  filterAdminType.value ||
  filterNodeType.value ||
  filterSearch.value
    ? "Żadna notatka nie pasuje do tych filtrów."
    : "Brak notatek",
);

const apiQuery = computed(() => ({
  page: page.value,
  limit: itemsPerPage.value,
  sortBy: sortBy.value[0]?.key ?? "createdAt",
  sortDesc: sortBy.value[0]?.order === "asc" ? "false" : "true",
  kind: filterKind.value || undefined,
  status: filterStatus.value || undefined,
  // "deferred" is not a stored type but a flag beside it, so it travels in the
  // url as one filter and splits into two query parameters here.
  adminType:
    filterAdminType.value === "deferred"
      ? undefined
      : filterAdminType.value || undefined,
  deferred: filterAdminType.value === "deferred" ? "true" : undefined,
  nodeType: filterNodeType.value || undefined,
  q: filterSearch.value || undefined,
  note: filterNote.value || undefined,
}));

// Requests can land out of order once a filter and a page change chase each
// other, so only the newest one is allowed to write the table.
let latestRequest = 0;

const load = async () => {
  // The endpoint only answers a caller carrying an admin token, which the
  // server render has no way to present - it would spend a request on a 401.
  if (import.meta.server) return;

  const request = ++latestRequest;
  pending.value = true;
  try {
    const res = await authRequest<{ notes: NoteRow[]; total: number }>(
      "/api/notes/admin",
      { method: "GET", query: apiQuery.value },
    );
    if (request !== latestRequest) return;
    items.value = res.notes;
    total.value = res.total;
    loadError.value = false;
  } catch (error) {
    if (request !== latestRequest) return;
    console.error("Failed to load notes", error);
    items.value = [];
    total.value = 0;
    loadError.value = true;
  } finally {
    if (request === latestRequest) pending.value = false;
  }
};

watch(apiQuery, load, { immediate: true });

const patchRow = async (
  row: NoteRow,
  patch: { adminStatus?: NoteAdminStatus | null; adminType?: string | null },
) => {
  const previous = {
    adminStatus: row.adminStatus,
    adminType: row.adminType,
    adminTypeDeferred: row.adminTypeDeferred,
  };
  // Applied straight away - the verdict is the whole point of the row, and
  // waiting on a round trip to see it makes triaging a page of them slow.
  // Giving a type here answers what the deferral was waiting for, which is
  // what the endpoint does to the stored entry too.
  Object.assign(row, patch);
  if (patch.adminType) row.adminTypeDeferred = false;
  saving.value[row.key] = true;
  try {
    await authRequest("/api/notes/admin", {
      method: "POST",
      body: {
        noteId: row.noteId,
        sourceIndex: row.sourceIndex,
        ...patch,
      },
    });
  } catch (error) {
    console.error("Failed to update note admin data", error);
    Object.assign(row, previous);
    failure.value =
      "Nie udało się zapisać zmiany - przywrócono poprzednią wartość.";
  } finally {
    saving.value[row.key] = false;
  }
};

// A node opened here comes straight from /api/nodes/[id], so it carries no
// employment context of its own; the drawer derives the cities to search in
// from the edges it is handed and this lookup.
const { companyRegions } = useCompanyLocations();

const openDrawer = shallowRef(false);
const focusedNode = shallowRef<NodeMaybeRich | undefined>(undefined);
const focusedNodeId = shallowRef<string | undefined>(undefined);
const {
  sources: focusedSources,
  targets: focusedTargets,
  refresh: refreshFocusedEdges,
} = await useEdges(focusedNodeId);
const focusedEdges = computed(() => [
  ...focusedSources.value,
  ...focusedTargets.value,
]);

// The panel opens once the node is in hand, not on the click. Opened first, it
// drew the explore page's „Wybierz osobę z tabeli” prompt while the read was
// on its way - and for good when a note hangs off a node with no document,
// whose read 404s - so a reviewer was told to pick a row they had just picked.
const focusNode = async (row: NoteRow) => {
  focusedNode.value = undefined;
  focusedNodeId.value = row.nodeId;

  try {
    // `latest` so a note written on a node nobody has approved yet still opens
    // instead of 404ing - with the token, which is what lets it through.
    const { node } = await authRequest<{ node: Node & { id?: string } }>(
      `/api/nodes/${row.nodeId}`,
      { method: "GET", query: { latest: "true" } },
    );
    if (focusedNodeId.value !== row.nodeId) return;
    focusedNode.value = { ...node, id: node.id ?? row.nodeId };
    openDrawer.value = true;
  } catch (error) {
    console.error(`Failed to fetch node ${row.nodeId}`, error);
    if (focusedNodeId.value !== row.nodeId) return;
    openDrawer.value = false;
    failure.value = "Nie udało się otworzyć wpisu - mógł zostać usunięty.";
  }
};
</script>

<style scoped>
/* A row is as tall as its note, up to three lines, so every cell starts at the
   top: centred, a date and two chips floated in the middle of a row whose note
   began a line above them. */
.notes-table :deep(td) {
  vertical-align: top;
}

/* The column holds the author's chip to its width, and a long name ellipsises
   inside the chip rather than being cut by it - the chip lets its content
   shrink (UserChip.vue). */
.added-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  max-width: 168px;
  padding-block: 8px;
}

.node-cell {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  min-width: 160px;
  max-width: 260px;
  padding-block: 8px;
}

/* A registry name runs to a hundred characters of capitals with no break the
   column can use. */
.node-link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  text-align: start;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.node-link:hover {
  text-decoration: underline;
}

/* The same three lines as .note-text: a KRS name ran to eight in this column
   and set the row's height on its own. The full name is in the title and in
   the side panel the button opens. */
.node-label {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* The open-in-new glyph after the name: 16px on the name's first line, with
   a 40px-tall target over the 4px gap and past the glyph, never over the
   name, which opens the side panel. */
.node-open {
  position: relative;
  display: inline-flex;
  margin-top: 2px;
}

.node-open::before {
  content: "";
  position: absolute;
  inset: -12px -12px -12px -4px;
}

.node-open:hover .v-icon {
  color: rgb(var(--v-theme-on-surface));
}

.node-link:focus-visible,
.node-open:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
  border-radius: 2px;
}

.note-cell {
  min-width: 260px;
  max-width: 560px;
  padding-block: 8px;
}

/* `anywhere`: a pasted url inside the note has nowhere else to break, and in
   the unclamped single-note view it ran on across the next two columns. */
.note-text-full {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.note-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.note-link {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  width: fit-content;
  margin-top: 4px;
}

.note-url {
  max-width: 320px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- phone: one note, one stack of labels and values ----

   Vuetify draws a mobile row as two equal columns, the value pushed to the
   right. The labels here are a word or two and the values are the content,
   so the label gets a narrow column and the value reads from the left, as
   text does everywhere else; the note takes the card's whole width under its
   label. */
.notes-table :deep(.v-data-table__tr--mobile > td) {
  grid-template-columns: 88px minmax(0, 1fr);
  column-gap: 12px;
  align-items: baseline;
  padding-block: 4px;
}

.notes-table :deep(.v-data-table__tr--mobile > td.notes-table__note) {
  grid-template-columns: minmax(0, 1fr);
}

.notes-table :deep(.v-data-table__tr--mobile .v-data-table__td-title) {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  font-weight: 600;
}

.notes-table :deep(.v-data-table__tr--mobile .v-data-table__td-value) {
  min-width: 0;
  text-align: start;
}

.notes-table :deep(.v-data-table__tr--mobile .note-cell),
.notes-table :deep(.v-data-table__tr--mobile .node-cell),
.notes-table :deep(.v-data-table__tr--mobile .added-cell) {
  min-width: 0;
  max-width: none;
  padding-block: 4px;
}

/* 40px square on a phone, where it is tapped: the target runs on past the
   glyph into the empty end of the line. */
@media (max-width: 599.98px) {
  .node-open::before {
    inset-inline-end: -20px;
  }
}
</style>
