<template>
  <v-sheet
    border
    rounded="lg"
    class="px-2 mb-3 tabela-query-bar"
    data-testid="tabela-query-bar"
  >
    <!-- Band 1: what this table is, what is narrowing it, how much of it there
         is, how it is ordered, how to send it to somebody. One line, 44px,
         where six always-open dropdowns and an explanatory sheet used to put
         the first row of data 697px down a 1440px desktop. -->
    <div class="d-flex flex-wrap align-center ga-2 tabela-query-bar__main">
      <!-- Names the SUBJECT, never the filter: the chips beside it already say
           „Kraków” and „Szpitale”, and a heading that repeated them would be
           the only line on the page that goes stale when one is cleared. -->
      <h1
        v-if="heading"
        class="text-subtitle-2 text-truncate flex-shrink-0 mb-0 tabela-query-bar__title"
      >
        {{ heading }}
      </h1>

      <!-- Two activators for one panel, sorted out by Vuetify's display
           classes rather than by `useDisplay()`: under SSR Vuetify builds its
           display state from a placeholder 1280px and corrects it only when
           the app's suspense resolves, so a width-driven `v-if` renders the
           desktop overlay into the phone's html and sometimes never takes it
           back. -->
      <v-menu
        v-model="menuOpen"
        :close-on-content-click="false"
        location="bottom start"
        min-width="760"
        max-width="760"
      >
        <template #activator="{ props: activatorProps }">
          <v-btn
            v-bind="activatorProps"
            variant="tonal"
            size="small"
            class="text-none flex-shrink-0 d-none d-md-inline-flex"
            :title="queryDescription"
            :prepend-icon="mdiTuneVariant"
            :append-icon="mdiChevronDown"
          >
            {{ filtersLabel }}
          </v-btn>
        </template>
        <v-card class="pa-4">
          <FormEksplorujTabelaFilterPanel
            v-model:visibility="visibility"
            v-model:party="party"
            v-model:teryt="teryt"
            v-model:company-teryt="companyTeryt"
            v-model:place="place"
            v-model:category="category"
            v-model:hide-voted="hideVoted"
            v-model:currently-employed="currentlyEmployed"
            v-model:min-employment-date="minEmploymentDate"
            v-model:min-votes="minVotes"
            :available-parties="availableParties"
            :available-regions="availableRegions"
            :available-companies="availableCompanies"
            :show-visibility="showVisibility"
            :total-items="totalItems"
            show-header
            @close="menuOpen = false"
            @clear="clearAll"
          />
        </v-card>
      </v-menu>

      <v-dialog
        v-model="dialogOpen"
        fullscreen
        transition="dialog-bottom-transition"
      >
        <template #activator="{ props: activatorProps }">
          <v-btn
            v-bind="activatorProps"
            variant="tonal"
            size="small"
            class="text-none flex-shrink-0 d-md-none"
            :title="queryDescription"
            :prepend-icon="mdiTuneVariant"
            :append-icon="mdiChevronDown"
          >
            {{ filtersLabel }}
          </v-btn>
        </template>
        <v-card class="d-flex flex-column">
          <v-toolbar density="comfortable" flat>
            <v-btn
              :icon="mdiClose"
              variant="text"
              aria-label="Zamknij filtry"
              @click="dialogOpen = false"
            />
            <v-toolbar-title>Filtry</v-toolbar-title>
            <v-btn variant="text" class="text-none" @click="clearAll">
              Wyczyść
            </v-btn>
          </v-toolbar>
          <v-divider />
          <div class="pa-4 flex-1-1-0 overflow-y-auto">
            <FormEksplorujTabelaFilterPanel
              v-model:visibility="visibility"
              v-model:party="party"
              v-model:teryt="teryt"
              v-model:company-teryt="companyTeryt"
              v-model:place="place"
              v-model:category="category"
              v-model:hide-voted="hideVoted"
              v-model:currently-employed="currentlyEmployed"
              v-model:min-employment-date="minEmploymentDate"
              v-model:min-votes="minVotes"
              :available-parties="availableParties"
              :available-regions="availableRegions"
              :available-companies="availableCompanies"
              :show-visibility="showVisibility"
              :total-items="totalItems"
              @close="dialogOpen = false"
              @clear="clearAll"
            />
          </div>
        </v-card>
      </v-dialog>

      <v-divider vertical class="mx-1 my-2 d-none d-md-block" />

      <!-- The rail wraps at every width, and never scrolls. The scrolling
           version measured at six filters on a 1440px desktop put the last
           chip at x 916-1052 against a scroller that clipped at 931: half a
           chip, behind a 24px fade, with `scrollbar-width: none` and no way to
           reach it with a plain mouse wheel. Wrapping costs 19px in that state
           and keeps every filter readable, which is the whole job of a chip
           that stands in for a control the reader can no longer see. -->
      <div
        class="d-flex flex-wrap align-center ga-1 flex-1-1-0 tabela-query-bar__rail"
      >
        <!-- `close-label` because VChip names its x „Close”, in English,
             whatever the page is written in: the default is a Vuetify locale
             key and this app ships no Polish translation for it. Spelled out
             per chip so a screen reader, and an e2e locator, can say which of
             six filters is about to go.

             `variant="flat"` and a `bg-surface-*` class rather than
             `variant="tonal" color="primary"`: a tonal chip paints the colour
             itself as the label, and primary is a pale fill - #a8c79f on the
             white sheet measured 1.85:1 against the 4.5:1 AA needs, which is
             the complaint that started this. The class carries its ink with
             it, so the pair cannot be split up later. -->
        <v-chip
          v-for="chip in railChips"
          :key="chip.key"
          size="small"
          variant="flat"
          border
          closable
          :class="chip.look.surface"
          :style="chip.look.style"
          :prepend-icon="chip.look.icon"
          :close-icon="mdiClose"
          :aria-label="chip.label"
          :close-label="`Usuń filtr: ${chip.label}`"
          v-on="chipOpensPanel(chip) ? { click: () => openFilters() } : {}"
          @click:close="clearChip(chip)"
        >
          {{ chip.label }}
        </v-chip>
        <!-- Only when nothing at all is set. With the work row carrying the
             verification chips, an empty rail is not an unfiltered table. -->
        <span
          v-if="chips.length === 0"
          class="text-body-2 text-ink-neutral d-none d-md-inline"
        >
          Wszystkie osoby w bazie
        </span>
        <v-btn
          v-if="chips.length >= 2"
          variant="text"
          size="small"
          class="text-none flex-shrink-0"
          @click="clearAll"
        >
          Wyczyść
        </v-btn>
      </div>

      <!-- Shown at every width, including the 390px phone the mock hid it
           from: „ile tego jest” is the cheapest answer to „what am I looking
           at”, and the reader has just changed a filter without seeing the
           table move. -->
      <span
        v-if="totalItems !== undefined"
        class="text-body-2 text-ink-neutral flex-shrink-0 tabela-query-bar__count"
      >
        {{ polishCountingGrouped(totalItems, "osoba", "osoby", "osób") }}
      </span>

      <v-divider vertical class="mx-1 my-2 d-none d-md-block" />

      <!-- Both live sorts one click away, without opening a column header. The
           keys come from `tableSortOptions` and go verbatim into `?sortBy=`
           and into a Firestore `orderBy` with no allow-list in between.

           The label is drawn at every width. Below 960px „Oceny” and „Wybory”
           are `hidden-sm-and-down` and their header sorts go with them, so
           this button is the only thing on the page that can say how the table
           is ordered - hidden, it left a phone reader with an icon and an
           arrow and no name for either. -->
      <v-menu v-if="sortBy !== undefined" location="bottom end">
        <template #activator="{ props: activatorProps }">
          <v-btn
            v-bind="activatorProps"
            variant="text"
            size="small"
            class="text-none flex-shrink-0"
            :aria-label="sortKey ? `Sortowanie: ${sortLabel}` : 'Sortowanie'"
            :prepend-icon="mdiSort"
            :append-icon="sortArrow"
          >
            {{ sortButtonLabel }}
          </v-btn>
        </template>
        <v-list density="compact" min-width="240">
          <v-list-subheader>Sortuj wg</v-list-subheader>
          <v-list-item
            v-for="option in sortOptions"
            :key="option.key"
            :active="option.key === sortKey"
            @click="pickSort(option.key)"
          >
            <v-list-item-title class="text-body-2">
              {{ option.title }}
            </v-list-item-title>
            <template #append>
              <v-icon
                v-if="option.key === sortKey"
                size="small"
                :icon="sortDesc ? mdiArrowDown : mdiArrowUp"
              />
            </template>
          </v-list-item>
        </v-list>
      </v-menu>

      <ExploreShareQuery
        v-if="showShare"
        :query="query"
        :lookup="lookup"
        @copied="emit('share')"
      />
    </div>

    <!-- Band 2: the work row, for a reader who is signed in and can act on it.
         Progress, this reader's own contribution and the four verification
         filters on one 32px line, in place of a 183px card plus a panel three
         clicks away. Every one of those filters is in the top four by use, so
         each is either a chip that can be cleared here or a `+ Nazwa` that
         sets it here. -->
    <template v-if="showWorkRow">
      <v-divider />
      <div
        class="d-flex align-center flex-wrap ga-2 py-1 tabela-query-bar__work"
        data-testid="tabela-work-row"
      >
        <!-- Without a query there is nothing to ask the progress endpoint
             about, and `query` is a required prop of the bar. -->
        <ExploreProgressBar
          v-if="progressQuery"
          compact
          hide-cta
          :query="progressQuery"
          class="tabela-query-bar__progress"
        />

        <!-- One menu per filter, holding exactly that one control, and the
             same menu whether the filter is set or not: in the mock a set
             chip's body did nothing, so the only way to change „min. 5
             głosów” to „min. 10” was to clear it and start again. -->
        <v-menu
          v-for="shortcut in workRowFilters"
          :key="shortcut.key"
          :close-on-content-click="false"
          location="bottom start"
          :offset="4"
        >
          <template #activator="{ props: activatorProps }">
            <v-chip
              v-if="shortcut.chip"
              v-bind="activatorProps"
              size="small"
              variant="flat"
              border
              :class="shortcut.chip.look.surface"
              :prepend-icon="shortcut.chip.look.icon"
              closable
              :close-icon="mdiClose"
              :aria-label="shortcut.chip.label"
              :close-label="`Usuń filtr: ${shortcut.chip.label}`"
              @click:close="clearChip(shortcut.chip)"
            >
              {{ shortcut.chip.short }}
            </v-chip>
            <v-btn
              v-else
              v-bind="activatorProps"
              variant="text"
              size="x-small"
              class="text-none text-ink-neutral flex-shrink-0"
              :prepend-icon="mdiPlus"
            >
              {{ shortcut.label }}
            </v-btn>
          </template>
          <v-card class="pa-3" min-width="260">
            <FormEksplorujTabelaVerificationFields
              v-model:visibility="visibility"
              v-model:hide-voted="hideVoted"
              v-model:min-employment-date="minEmploymentDate"
              v-model:min-votes="minVotes"
              :only="shortcut.key"
            />
          </v-card>
        </v-menu>

        <!-- The only „Pomóż sprawdzać” a reader of this page meets.
             ExploreProgressBar had a second copy, anchored to the right edge
             of its own box - which ends before the shortcuts - and both of its
             callers hid it, so it is gone from that component. Drawn here so
             the row ends on the invitation rather than breaking in the middle
             of it. (/eksploruj/statystyki draws its own, on its own page.)

             Filled rather than tonal: a tonal button writes its colour as the
             label, and primary is a fill - „Pomóż sprawdzać” in #a8c79f on
             white measured 1.85:1. Filled, Vuetify pairs it with the ink it
             computes for the fill, which on this sage is black at 11.33:1. -->
        <v-btn
          to="/eksploruj/nowe"
          color="primary"
          variant="flat"
          size="small"
          class="text-none flex-shrink-0 ms-auto"
          :append-icon="mdiArrowRight"
        >
          Pomóż sprawdzać
        </v-btn>
      </div>
    </template>
  </v-sheet>
</template>

<script setup lang="ts">
/** The query bar of /eksploruj/tabela: one 44px line that says what the table
 * is showing, plus a 32px work row for the people verifying it.
 *
 * It replaces six always-open dropdowns and a blue-grey sheet explaining the
 * administrative filters. Measured, that layout put the first row of data
 * 697px down a 1440px desktop and 588px down a 390px phone - a reader who
 * followed a link to „Szpitale w Krakowie” scrolled past every control on the
 * page before reaching one person. The controls are still all here, one click
 * behind „Filtry”; what is on the bar is what is already true about the table:
 * a chip per filter, the row count, the sort and the share link.
 *
 * /eksploruj/autograf/[type] mounts the same component over a chart: the same
 * ten filters, but no table under it and no progress data, so everything that
 * belongs to the table - the count, the sort control, the work row, the share
 * link - appears only when the page passes it in.
 */

import {
  mdiArrowDown,
  mdiArrowRight,
  mdiArrowUp,
  mdiBus,
  mdiChevronDown,
  mdiClose,
  mdiFlashOutline,
  mdiHospitalBuilding,
  mdiPlus,
  mdiRadiator,
  mdiRecycle,
  mdiSoccer,
  mdiSort,
  mdiStethoscope,
  mdiTagOutline,
  mdiTrain,
  mdiTuneVariant,
  mdiWaterPump,
} from "@mdi/js";
import { computed, ref } from "vue";
import type { Query } from "~~/server/api/nodes/index.get";
import { readableInkOn } from "~~/shared/colors";
import { partyColors } from "~~/shared/misc";
import {
  describeQuery,
  queryChips,
  tableSortOptions,
  type QueryChip,
  type QueryLookup,
  type ShareKey,
  type TableQuery,
} from "~~/shared/queryUrl";
import { polishCountingGrouped } from "~/composables/polish";
import FormEksplorujTabelaFilterPanel from "./EksplorujTabelaFilterPanel.vue";
import FormEksplorujTabelaVerificationFields from "./EksplorujTabelaVerificationFields.vue";

type SortEntry = { key: string; order: "asc" | "desc" };

const props = withDefaults(
  defineProps<{
    availableParties: { title: string; value: string }[] | string[];
    availableRegions: { title: string; value: string }[];
    availableCompanies: { title: string; value: string }[];
    /** The reader is signed in: the verification filters are theirs to use,
     * and their chips are worth drawing. */
    showVisibility?: boolean;
    /** Rows the current query returns. Absent on a page with no table. */
    totalItems?: number;
    /** The table query, for the progress band. Also the switch for
     * ExploreProgressBar itself - the band's shortcuts are useful without it,
     * the bar is not. */
    progressQuery?: Query;
    /** Draw the work row at all. Off by default so that a page with nothing to
     * verify (autograf) does not grow an empty band. */
    showProgress?: boolean;
    /** Draw the share control. Off by default for the same reason: a link to
     * the table is not what a visualisation page wants to hand out. */
    showShare?: boolean;
    /** The page's `<h1>`, naming what the table is about. `null` for a page
     * that already has a heading of its own. */
    heading?: string | null;
    /** Where in the results the reader is standing. Not a filter and never a
     * chip: it reaches the share card, which offers to add it to the link only
     * when it would change the address. Left out by the page while it is at
     * the value a link without it lands on, so „Dołącz stronę i liczbę
     * wierszy” cannot be offered for a string that would come back
     * identical. */
    page?: number;
    itemsPerPage?: number;
  }>(),
  {
    showVisibility: true,
    totalItems: undefined,
    progressQuery: undefined,
    showProgress: false,
    showShare: false,
    heading: "Powiązania osób i spółek publicznych",
    page: undefined,
    itemsPerPage: undefined,
  },
);

/** Emitted instead of clearing the filters one by one.
 *
 * Every filter here is a writable computed over `route.query`, and each write
 * is a `router.push` built from the query as it is *now* - `route.query` only
 * changes once a navigation has been confirmed. Ten writes in one tick would
 * all start from the same still-filtered url and the last one would win,
 * leaving nine filters in place after a button that promised to remove them.
 * The page owns the url, so the page drops them in one write - which is also
 * one history entry for the back button rather than ten.
 */
const emit = defineEmits<{
  clear: [];
  /** The reader copied a link to the query this bar describes. Passed up rather
   * than counted here for the same reason `clear` is: the page owns what its
   * surface is called. */
  share: [];
}>();

const visibility = defineModel<"all" | "public" | "private">("visibility");
const party = defineModel<string[] | null>("party");
const teryt = defineModel<string | null>("teryt");
const companyTeryt = defineModel<string | null>("companyTeryt");
/** Selected employers, by place node id. */
const place = defineModel<string[] | null>("place");
const category = defineModel<string | null>("category");
const hideVoted = defineModel<"all" | "no_votes" | "has_votes">("hideVoted");
const currentlyEmployed = defineModel<"all" | "any" | "selected">(
  "currentlyEmployed",
);
const minEmploymentDate = defineModel<string | null>("minEmploymentDate");
const minVotes = defineModel<number | null>("minVotes");

/** Deliberately without a default: a page that binds it has a table to sort
 * and gets the sort control, a page that does not (autograf) would otherwise
 * get a control that writes `?sortBy=` into a url nothing reads. */
const sortBy = defineModel<SortEntry[]>("sortBy");

const menuOpen = ref(false);
const dialogOpen = ref(false);

/** The names behind the codes in the url. Both are optional in `QueryLookup`
 * because the lists arrive over the network: until they do, a chip says
 * „Region: teryt1261”, which is at least true. */
const lookup = computed<QueryLookup>(() => ({
  region: (code) =>
    props.availableRegions.find((region) => region.value === code)?.title,
  company: (id) =>
    props.availableCompanies.find((company) => company.value === id)?.title,
}));

/** What this component knows about the query, in the shape `shared/queryUrl`
 * reads. `krs` is missing on purpose: a link minted before employers were
 * keyed on node ids carries it, and the page resolves it into `place` as soon
 * as the company list arrives, so a chip for it would flicker rather than
 * inform. */
const query = computed<TableQuery>(() => ({
  category: category.value,
  teryt: teryt.value,
  companyTeryt: companyTeryt.value,
  party: party.value,
  place: place.value,
  currentlyEmployed: currentlyEmployed.value,
  visibility: visibility.value,
  hideVoted: hideVoted.value,
  minEmploymentDate: minEmploymentDate.value,
  minVotes: minVotes.value,
  sortBy: sortBy.value?.[0]?.key,
  sortDesc: sortBy.value?.[0]
    ? String(sortBy.value[0].order === "desc")
    : undefined,
  // Neither is a filter, and `shareQuery` keeps both out of the address by
  // default; they are here so the share card can offer to put them back. Left
  // out, its checkbox compared a link against itself and could never appear.
  page: props.page,
  itemsPerPage: props.itemsPerPage,
}));

/** Every filter narrowing the table right now, the administrative ones
 * included for a guest. They are not inert there: `server/api/nodes/index.get`
 * applies `hideVoted`, `minVotes` and `minEmploymentDate` to everybody, and
 * answers a signed-out reader's `?visibility=private` with an empty result set
 * before it looks at anything else (line 108). A shared link carrying one and
 * a rail that said nothing would leave that reader in front of a short table,
 * or none at all, with nothing on screen naming the cause or offering to undo
 * it - which is the failure the count on the „Filtry” button exists to
 * prevent. The x on the chip is the only way back. */
const chips = computed(() => queryChips(query.value, lookup.value));

/** The pale background each filter's chip is painted on.
 *
 * One class per chip and not a colour name: Vuetify writes `bg-surface-sage`
 * together with its `on-surface-sage` ink (#46673c on #e9f1e7, 5.57:1), so a
 * chip cannot end up with a background from one decision and a label from
 * another - which is how the rail came to paint #a8c79f, a fill colour, as
 * 12px text at 1.85:1.
 *
 * The hues group the filters rather than giving each one its own: sage is what
 * the table is about, blue is where, and the editor's own narrowings stay
 * grey. tests/shared/colors.test.ts holds every one of these pairs to 4.5:1,
 * and the test beside this file measures the chips as the bar mounts them.
 */
const CHIP_SURFACES: Partial<Record<ShareKey, string>> = {
  place: "bg-surface-sage",
  category: "bg-surface-sage",
  currentlyEmployed: "bg-surface-sage",
  teryt: "bg-surface-info",
  companyTeryt: "bg-surface-info",
  party: "bg-surface-muted",
  hideVoted: "bg-surface-muted",
  minEmploymentDate: "bg-surface-muted",
  minVotes: "bg-surface-muted",
};

/** Anything `queryChips` grows later, until somebody gives it a hue of its
 * own. Grey is the only tone here that says nothing about what it is filtering
 * and so cannot say anything wrong. */
const CHIP_FALLBACK = "bg-surface-muted";

/** The one chip that gets an icon: the category, whose label is a bare sector
 * name („Szpitale”) with nothing in front of it to say what is being filtered.
 * Its own sector icon where there is one, below.
 *
 * Every other chip names its filter in the label - „Region: Małopolskie”,
 * „Siedziba: Małopolskie”, „Zatrudnieni od 1 marca 2021”, „Min. 5 głosów”,
 * „Tylko szkice” - so the icon repeated the word beside it, and it repeated it
 * in the width of a glyph and its gap, on a rail that shares one 44px line
 * with the heading, the „Filtry” button, the count and the sort. */
const CATEGORY_FALLBACK_ICON = mdiTagOutline;

/** A sector's own icon, keyed by the values in `shared/companyCategories`. A
 * category added there and not here keeps the generic tag. */
const CATEGORY_ICONS: Record<string, string> = {
  szpitale: mdiHospitalBuilding,
  przychodnie: mdiStethoscope,
  wodociagi: mdiWaterPump,
  cieplownictwo: mdiRadiator,
  energetyka: mdiFlashOutline,
  odpady: mdiRecycle,
  koleje: mdiTrain,
  "komunikacja-miejska": mdiBus,
  sport: mdiSoccer,
};

interface ChipLook {
  /** A `bg-surface-*` class, or nothing where `style` paints the chip. */
  surface: string;
  /** Only the category chip has one - see `CATEGORY_FALLBACK_ICON`. `v-chip`
   * draws no `prepend` slot for `undefined`, so the chip is its label. */
  icon: string | undefined;
  /** Only the party chip, which takes the party's own colour. */
  style?: { backgroundColor: string; color: string };
}

/** The party's own colour, when the filter names exactly one party the site
 * has a colour for. `queryChips` merges `?party` and `?parties` into a single
 * chip; this bar only ever binds `party`, so one value there is the whole
 * filter. „Partie: 3” and „Brak partii” have no colour to take and stay grey.
 */
const partyFill = computed(() => {
  const chosen = party.value;
  return chosen?.length === 1 ? partyColors[chosen[0]!] : undefined;
});

/** How one chip is painted, given what it is filtering on.
 *
 * The three chips that decide their own colour read it out of the model rather
 * than off their label: a party chip says „PiS” and a category chip says
 * „Szpitale”, and matching on those strings would repaint itself the day
 * either list is reworded.
 */
function chipLook(chip: QueryChip): ChipLook {
  if (chip.key === "party" && partyFill.value) {
    // The label sits on a fill that runs from #f5c400 to near-black, so the
    // ink is measured against it rather than fixed: black on Konfederacja's
    // navy is 1.29:1, and this is the same call PartyChip makes on the row
    // below, so a party reads the same in the filter and in the table.
    return {
      surface: "",
      icon: undefined,
      style: {
        backgroundColor: partyFill.value,
        color: readableInkOn(partyFill.value),
      },
    };
  }
  if (chip.key === "category") {
    return {
      surface: CHIP_SURFACES.category!,
      icon: CATEGORY_ICONS[category.value ?? ""] ?? CATEGORY_FALLBACK_ICON,
    };
  }
  // „Tylko szkice” in the same amber the table's `szkic` badge uses, and
  // „Tylko opublikowane” in the green of a published row: the filter and the
  // rows it leaves behind are then the same colour.
  if (chip.key === "visibility") {
    return {
      surface:
        visibility.value === "private"
          ? "bg-surface-warning"
          : "bg-surface-success",
      icon: undefined,
    };
  }
  return {
    surface: CHIP_SURFACES[chip.key] ?? CHIP_FALLBACK,
    icon: undefined,
  };
}

/** A chip with its paint attached, so the template asks once per chip rather
 * than once per bound attribute. */
type DressedChip = QueryChip & { look: ChipLook };

const dress = (chip: QueryChip): DressedChip => ({
  ...chip,
  look: chipLook(chip),
});

/** A chip only pretends to be a button where the control behind it exists: a
 * guest has no „Weryfikacja” block in the panel (FilterPanel gates it on the
 * same prop), so opening it on an administrative chip would answer a click
 * with a panel that does not hold the filter that was clicked. Without a
 * click listener VChip drops its ripple, its tabindex and its pointer, so it
 * does not invite the click in the first place. */
const chipOpensPanel = (chip: QueryChip) => props.showVisibility || !chip.admin;

const queryDescription = computed(() =>
  describeQuery(query.value, lookup.value),
);

const VERIFICATION_KEYS = new Set<ShareKey>([
  "visibility",
  "hideVoted",
  "minEmploymentDate",
  "minVotes",
]);

const showWorkRow = computed(() => props.showProgress && props.showVisibility);

/** The rail drops the verification filters when the work row is drawing them:
 * the same filter as two chips, one grey above the other, reads as two
 * filters. */
const railChips = computed<DressedChip[]>(() =>
  (showWorkRow.value
    ? chips.value.filter((chip) => !VERIFICATION_KEYS.has(chip.key))
    : chips.value
  ).map(dress),
);

/** What a `+ Nazwa` button does, short enough to fit on the work row. The set
 * form of each of these is the chip's own `short` label from
 * `shared/queryUrl`, so the two never drift.
 *
 * `hideVoted` is named after the setting rather than after the parameter: „+
 * Głosy” beside „+ Min. głosy” gave the reader two shortcuts saying the same
 * word, and the only way to tell them apart was to open one - the exact cost
 * the work row exists to remove. */
const VERIFICATION_SHORTCUTS = [
  { key: "visibility", label: "Widoczność" },
  { key: "hideVoted", label: "Bez ocenionych" },
  { key: "minEmploymentDate", label: "Od kiedy" },
  { key: "minVotes", label: "Min. głosy" },
] as const;

const workRowFilters = computed(() =>
  VERIFICATION_SHORTCUTS.map((shortcut) => {
    const chip = chips.value.find((item) => item.key === shortcut.key);
    return { ...shortcut, chip: chip ? dress(chip) : undefined };
  }),
);

/** How many filters are narrowing the table right now. On the button because a
 * panel that is quietly filtering behind a closed door is worse than no panel:
 * the reader sees a short list and no reason for it. Counted from the chips so
 * that the number and the rail can never disagree - one chip per filter, which
 * is why `place` with three employers counts once. */
const filtersLabel = computed(() =>
  chips.value.length ? `Filtry (${chips.value.length})` : "Filtry",
);

/** „Status” orders by `visibility`, which a reader who cannot see drafts has
 * no use for: it would sort every row into the one bucket they are allowed. */
const sortOptions = computed(() =>
  tableSortOptions.filter(
    (option) => props.showVisibility || !("adminOnly" in option),
  ),
);

/** Shorter names for the button, which shares a 390px line with „Filtry”, the
 * chip rail and the row count; the menu keeps the full ones. Only the three
 * that do not fit - a key missing from here falls back to its own title. */
const SORT_SHORT_TITLES: Record<string, string> = {
  latestEmploymentStart: "Zatrudnienie",
  "stats.votes.interesting": "Oceny",
  notesCount: "Notatki",
};

const sortKey = computed(() => sortBy.value?.[0]?.key);
const sortOption = computed(() =>
  tableSortOptions.find((option) => option.key === sortKey.value),
);
const sortDesc = computed(() => sortBy.value?.[0]?.order === "desc");
const sortLabel = computed(() => sortOption.value?.title ?? "Sortowanie");
const sortButtonLabel = computed(() =>
  sortOption.value
    ? (SORT_SHORT_TITLES[sortOption.value.key] ?? sortOption.value.title)
    : "Sortowanie",
);

/** No arrow until something is actually being sorted. A default-loaded table
 * is in whatever order Firestore returned, and a descending arrow beside
 * „Sortowanie” claimed an order the rows are not in. */
const sortArrow = computed(() =>
  sortKey.value ? (sortDesc.value ? mdiArrowDown : mdiArrowUp) : undefined,
);

function pickSort(key: string) {
  if (key === sortKey.value) {
    sortBy.value = [{ key, order: sortDesc.value ? "asc" : "desc" }];
    return;
  }
  // Surnames read A to Z; every other key here is a date or a count, where the
  // interesting end is the top one.
  sortBy.value = [{ key, order: key === "name" ? "asc" : "desc" }];
}

function openFilters() {
  // Both activators are in the DOM at once and a display class picks which one
  // is visible, so opening the menu below 960px would anchor an overlay to a
  // `display: none` button - it opens in the top left corner of the page.
  // Measured at click time rather than through `useDisplay()`, whose value
  // under SSR is a placeholder 1280px.
  const desktop =
    typeof window === "undefined" ||
    window.matchMedia("(min-width: 960px)").matches;
  if (desktop) menuOpen.value = true;
  else dialogOpen.value = true;
}

/** Unset every parameter one chip stands for.
 *
 * `chip.clears` is longer than one key where two parameters name the same
 * filter, and both have to go: dropping `place` while leaving a legacy `krs`
 * behind would leave the table exactly as it was after a click that promised
 * to widen it. Here both pairs are cleared by a single model - the page's
 * `usePlaceFilter` writes `krs: undefined` alongside every `place`, and
 * `parties` is `party` under the name the api uses - so the loop only has to
 * make sure it does not write the same model twice.
 */
function clearChip(chip: QueryChip) {
  for (const key of chip.clears) {
    switch (key) {
      case "place":
        place.value = null;
        break;
      case "teryt":
        teryt.value = null;
        break;
      case "companyTeryt":
        companyTeryt.value = null;
        break;
      case "category":
        category.value = null;
        break;
      case "party":
        party.value = null;
        break;
      case "currentlyEmployed":
        currentlyEmployed.value = "all";
        break;
      case "visibility":
        visibility.value = "all";
        break;
      case "hideVoted":
        hideVoted.value = "all";
        break;
      case "minEmploymentDate":
        minEmploymentDate.value = null;
        break;
      case "minVotes":
        minVotes.value = null;
        break;
      default:
        // `krs` and `parties` are cleared by the models above; `sortBy` and
        // `sortDesc` never reach a chip.
        break;
    }
  }
}

function clearAll() {
  menuOpen.value = false;
  dialogOpen.value = false;
  emit("clear");
}
</script>

<style scoped>
/* The bar keeps the plain hairline `v-sheet border` draws on all four sides.
   It had a 4px sage edge on the leading one, the accent the entity page puts
   on its cards, and there is only one bar on the page - so the edge marked it
   off from nothing, while spending the colour that the header band, the meta
   pill and the party chips below need to be read as meaning something. */

/* 44px of bar, whatever it is holding. `min-height` and not `height`: below
   960px the chips wrap under the controls and the row has to grow. */
.tabela-query-bar__main {
  min-height: 44px;
}

/* The rail takes the room the fixed-width controls leave and wraps inside it.
   `min-width: 0` because a flex item's default `min-width: auto` is its
   content, which would make a long chip push the count and the sort button off
   the bar instead of moving itself to the next line. */
.tabela-query-bar__rail {
  min-width: 0;
}

/* Same width whatever the number is, so the count does not shove the sort
   button sideways every time a filter changes. */
.tabela-query-bar__count {
  font-variant-numeric: tabular-nums;
  min-width: 96px;
  text-align: right;
}

/* On a phone the heading takes the whole first line. Sharing it with the
   „Filtry” button leaves the chips a third of a 390px screen, and a chip rail
   in 130px wraps one chip per line. */
@media (max-width: 599.98px) {
  .tabela-query-bar__title {
    flex: 1 1 100%;
  }
  .tabela-query-bar__count {
    min-width: 0;
  }
}

/* The progress band shrinks to its content so that Vuetify's own `v-spacer`
   inside it collapses; left free to grow it would open a gap between „Twój
   wkład” and the verification chips that follow it here. */
.tabela-query-bar__progress {
  flex: 0 1 auto;
  min-width: 0;
}
</style>
