<template>
  <!-- A city's „Gmina X”: governed by the city, whose page has it all. One
       quiet line where the section would be, and the way there. -->
  <p
    v-if="!sections"
    class="k-absent mb-0"
    data-testid="region-authorities-empty"
  >
    {{
      pointerTarget?.councilOnly
        ? "Radę miasta pokazujemy na stronie miasta:"
        : "Prezydenta i radę miasta pokazujemy na stronie miasta:"
    }}
    <template v-if="pointerTarget">
      <NuxtLink :to="pointerTarget.url" class="text-ink-info">{{
        pointerTarget.name ?? "strona miasta"
      }}</NuxtLink
      >.
    </template>
  </p>

  <!-- Who governs the place: its head and its councils, as PKW's results
       of the newest local election named them and contributors have
       corrected since (Region.authorities). Szymon, board round
       region-lists-r2: "Even if they are not on the page, they should just
       be listed for the information." -->
  <PageSection
    v-else
    id="wladze"
    :title="sections.title"
    data-testid="region-authorities"
  >
    <template v-if="sections.term" #caption>
      <span data-nosnippet>kadencja {{ sections.term }}</span>
    </template>
    <template #info>
      <p class="mb-2">
        Według wyników wyborów samorządowych {{ year }} ogłoszonych przez PKW.
      </p>
      <p class="mb-2">
        Zmiany w trakcie kadencji uzupełniają użytkownicy, a my je sprawdzamy.
      </p>
      <p class="mb-0">
        Partie przy nazwiskach mają osoby ze stroną na koryta.pl.
      </p>
    </template>

    <!-- The head of the executive. -->
    <div
      v-if="sections.head"
      class="k-group"
      data-testid="region-authorities-head"
    >
      <h3 class="k-group-head">{{ sections.head.title }}</h3>

      <v-row v-if="holder" dense>
        <v-col cols="12" md="6">
          <SuccessionSeatCard
            :name="holder.name"
            :url="pageUrl(holder)"
            :published="holder.page?.published ?? false"
            :parties="holder.page?.parties ?? []"
            :party-hidden="holder.page?.partyHidden"
            :since="sinceOf(holder.since)"
            :aria-current="
              holder.page && holder.page.id === highlightId ? 'true' : undefined
            "
            data-testid="region-authorities-holder"
          >
            <template v-if="headMeta" #details>
              <div class="authority-meta">{{ headMeta }}</div>
            </template>
          </SuccessionSeatCard>
        </v-col>
      </v-row>

      <!-- Nobody known: a starosta or a marszałek, whom the council chooses,
           until somebody fills them in (Szymon, 2026-11-18: keep the slot,
           and say „Brak danych”). The words and the (i) as one unbreakable
           piece, as a company's absent board has them. -->
      <p v-else class="k-absent mb-0" data-testid="region-authorities-no-head">
        <span v-if="sections.head.appointed" class="k-absent__tail"
          >Brak danych
          <InfoBubble :label="sections.head.title">{{
            appointedWhy
          }}</InfoBubble></span
        >
        <template v-else>Brak danych</template>
      </p>
    </div>

    <!-- Each council. -->
    <div
      v-for="council in sections.councils"
      :key="council.office"
      class="k-group"
      :data-testid="`region-authorities-council-${council.office}`"
    >
      <h3 class="k-group-head">
        {{ council.title }}
        <span class="k-group-head__count">{{
          polishCounting(council.seats, "mandat", "mandaty", "mandatów")
        }}</span>
      </h3>

      <!-- Every seat, by the committee that won it. -->
      <StatsCompositionBar
        class="mb-3"
        :segments="segmentsOf(council)"
        :summary="summaryOf(council)"
      />

      <!-- A row each, under the committee (Szymon, 2026-11-18), the
           committees apart. A tab per committee, its members two to a row on a
           desktop, and first a „Wszyscy” tab with every committee side by
           side, a box each - Szymon, board round region-lists-r4: "a synthesis
           of both. Add an option „wszyscy” that shows b option, otherwise it
           shows a". It opens on „Wszyscy”, so everybody is listed at once; a
           council of one committee needs no tabs. -->
      <v-tabs
        v-if="council.committees.length > 1"
        :model-value="selectedOf(council)"
        color="ink-sage"
        density="compact"
        show-arrows
        class="council-tabs mb-2"
        :data-testid="`region-authorities-tabs-${council.office}`"
        @update:model-value="select(council.office, $event)"
      >
        <v-tab :value="ALL" class="text-none">
          Wszyscy
          <span class="council-tab__count">{{ namedOf(council) }}</span>
        </v-tab>
        <v-tab
          v-for="group in council.committees"
          :key="group.key"
          :value="group.key"
          class="text-none"
        >
          {{ tabLabel(group) }}
          <span class="council-tab__count">{{ group.members.length }}</span>
        </v-tab>
      </v-tabs>
      <div
        v-show="selectedOf(council) === ALL"
        class="council-columns"
        :data-testid="`region-authorities-all-${council.office}`"
      >
        <div
          v-for="group in council.committees"
          :key="group.key"
          class="lists-box council-column"
        >
          <div class="council-group__head">
            {{ group.committee ?? "Komitet nieznany" }}
            <span class="council-group__count">{{ group.members.length }}</span>
          </div>
          <RegionListMembers
            :members="group.members.map(asListMember)"
            :highlight-id="highlightId"
            plain
          />
        </div>
      </div>
      <!-- One committee, drawn only once its tab is picked: the page carries
           each name once, under „Wszyscy”. -->
      <div
        v-if="committeeOf(council)"
        class="lists-box k-bleed-xs"
        :data-testid="`region-authorities-committee-${council.office}`"
      >
        <RegionListMembers
          :members="committeeOf(council)!.members.map(asListMember)"
          :highlight-id="highlightId"
          plain
          columns
        />
      </div>

      <!-- A seat whose holder PKW does not name: a winner who became the head
           passed theirs on. -->
      <p
        v-if="council.unnamed"
        class="k-absent mt-2 mb-0"
        :data-testid="`region-authorities-unnamed-${council.office}`"
      >
        Brak danych o
        {{
          council.unnamed === 1
            ? "jednym radnym"
            : `${council.unnamed} radnych`
        }}.
      </p>
    </div>
  </PageSection>
</template>

<script setup lang="ts">
import { canonicalParty, partyColors } from "~~/shared/misc";
import { readableInkOn } from "~~/shared/colors";
import { monthYear, shortDate } from "~~/shared/dates";
import { ink } from "~/utils/chartTheme";
import { polishCounting } from "~/composables/polish";
import { generateEntityUrl } from "~~/shared/slugs";
import type { ListMember } from "~~/shared/electionLists";
import {
  committeeLabel,
  type CommitteeGroup,
  type CouncilSection,
  type GovernmentPersonView,
  type GovernmentSections,
} from "~~/shared/regionAuthorities";
import type { CompositionSegment } from "~/components/stats/CompositionBar.vue";

const props = defineProps<{
  /** What to draw (`governmentSections`); null on a city's gmina twin,
   * which says where its government is instead. */
  sections: GovernmentSections | null;
  /** Where a twin sends the reader: its city, by name; the name is missing
   * where its read failed. `councilOnly` for Kraków's hand-drawn page, which
   * shows its rada and no prezydent. */
  pointerTarget?: { name?: string; url: string; councilOnly?: boolean };
  /** The person the reader came from, whose row a council marks. */
  highlightId?: string;
}>();

const holder = computed(() => props.sections?.head?.holder);

const year = computed(() => props.sections?.term.slice(0, 4) || "2024");

/** Why nobody is known for a head the council chooses. */
const appointedWhy = computed(() => {
  switch (props.sections?.kind) {
    case "powiat":
      return "Starostę wybiera rada powiatu, nie wyborcy.";
    case "wojewodztwo":
      return "Marszałka wybiera sejmik, nie wyborcy.";
    default:
      return "Burmistrza dzielnicy wybiera rada dzielnicy, nie wyborcy.";
  }
});

/** „Komitet: KWW ŁOWICKIE.PL · członek partii: Prawo i Sprawiedliwość”. */
const headMeta = computed(() => {
  const head = holder.value;
  if (!head) return "";
  return [
    head.committee ? `Komitet: ${head.committee}` : "",
    head.member ? `członek partii: ${head.member}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
});

/** „od 7.05.2024”, „od maja 2024”, „od 2024”: as precise as it was said. */
function sinceOf(since: string | undefined): string | undefined {
  if (!since) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) return `od ${shortDate(since)}`;
  if (/^\d{4}-\d{2}$/.test(since)) return `od ${monthYear(`${since}-01`)}`;
  return `od ${since}`;
}

function pageUrl(person: GovernmentPersonView): string | undefined {
  return person.page
    ? generateEntityUrl("person", person.page.id, person.name)
    : undefined;
}

/** A council member as the list rows draw one: a name with no page is text. */
function asListMember(person: GovernmentPersonView): ListMember {
  return {
    personId: person.page?.id ?? "",
    personName: person.name,
    parties: person.page?.parties ?? [],
    ...(person.page?.partyHidden ? { partyHidden: true } : {}),
    published: person.page?.published ?? false,
    offices: [],
    elected: false,
  };
}

/** One party's colour for a committee; a local list in the muted grey. Two
 * parties' list in the first one's, for now. */
function colorOf(parties: readonly string[]): string {
  const party = parties[0] ? canonicalParty(parties[0]) : undefined;
  return (party && partyColors[party]) || ink.muted;
}

function segmentsOf(council: CouncilSection): CompositionSegment[] {
  const segments: CompositionSegment[] = council.committees.map((group) => {
    const color = colorOf(group.parties);
    return {
      key: group.key,
      label: committeeLabel(
        group.committee ?? "Komitet nieznany",
        group.parties,
      ),
      value: group.members.length,
      color,
      labelColor: readableInkOn(color),
    };
  });
  // The seats nobody is named for, in the bar's own grey for what is not
  // there yet.
  if (council.unnamed) {
    segments.push({
      key: "brak-danych",
      label: "Brak danych",
      value: council.unnamed,
      color: ink.track,
      labelColor: readableInkOn(ink.track),
    });
  }
  return segments;
}

function summaryOf(council: CouncilSection): string {
  return `${council.title}, ${polishCounting(council.seats, "mandat", "mandaty", "mandatów")}: ${segmentsOf(
    council,
  )
    .map((segment) => `${segment.label} ${segment.value}`)
    .join(", ")}`;
}

/** The tab of every committee at once. */
const ALL = "wszyscy";

/** The tab each council shows: „Wszyscy” until the reader picks one. */
const picked = ref<Record<string, string>>({});

function selectedOf(council: CouncilSection): string {
  return picked.value[council.office] ?? ALL;
}

/** The committee whose tab is open, or none on „Wszyscy”. */
function committeeOf(council: CouncilSection): CommitteeGroup | undefined {
  const key = selectedOf(council);
  return key === ALL
    ? undefined
    : council.committees.find((group) => group.key === key);
}

/** Members the council names, against its seats. */
function namedOf(council: CouncilSection): number {
  return council.seats - council.unnamed;
}

function select(office: string, key: unknown) {
  if (typeof key === "string") {
    picked.value = { ...picked.value, [office]: key };
  }
}

/** „PiS”, „KO”, „Trzecia Droga”: a party's list by the party, a local list
 * by its own name. */
function tabLabel(group: CommitteeGroup): string {
  return committeeLabel(group.committee ?? "Komitet nieznany", group.parties);
}
</script>

<style scoped>
.authority-meta {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  line-height: 1.4;
  margin-top: 8px;
  overflow-wrap: anywhere;
}

/* The committee over its members: the list's name in the meta size, with
   how many seats it won. */
.council-group__head {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
  padding: 10px 16px 6px;
}

.lists-box > * + .council-group__head {
  border-top: 1px solid var(--k-line);
}

.council-group__count,
.council-tab__count {
  font-weight: 400;
  margin-left: 4px;
}

/* b: a committee to a box, two boxes to a row on a desktop. */
.council-columns {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 960px) {
  .council-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.council-column {
  align-self: start;
}
</style>
