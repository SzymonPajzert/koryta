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

      <!-- A row each, under the committee (Szymon, 2026-11-18: a row each,
           with the person's own party chips). -->
      <div :id="boxId(council.office)" class="lists-box k-bleed-xs">
        <template v-for="group in shownGroups(council)" :key="group.key">
          <div class="council-group__head">
            {{ group.committee ?? "Komitet nieznany" }}
            <span class="council-group__count">{{
              groupCount(council, group)
            }}</span>
          </div>
          <RegionListMembers
            :members="group.members.map(asListMember)"
            :highlight-id="highlightId"
            plain
          />
        </template>
        <button
          v-if="foldedOf(council) > 0"
          type="button"
          class="list-more"
          aria-expanded="false"
          :aria-controls="boxId(council.office)"
          @click="showAllMembers(council)"
        >
          Pokaż wszystkich radnych ({{ namedOf(council) }})
        </button>
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
import { createSlug, generateEntityUrl } from "~~/shared/slugs";
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

/** How many members a committee has on the council, whatever the fold
 * shows of them. */
function groupCount(council: CouncilSection, group: CommitteeGroup): number {
  return (
    council.committees.find((each) => each.key === group.key)?.members.length ??
    group.members.length
  );
}

function namedOf(council: CouncilSection): number {
  return council.seats - council.unnamed;
}

/** How many members a council shows before „Pokaż wszystkich radnych”: a
 * sejmik has up to fifty-one. Never folding a single one away, nor the
 * person the reader came from. */
const MEMBERS_SHOWN = 12;
const unfolded = ref(new Set<string>());

function unfold(office: string) {
  unfolded.value = new Set([...unfolded.value, office]);
}

function shownGroups(council: CouncilSection): CommitteeGroup[] {
  if (
    unfolded.value.has(council.office) ||
    namedOf(council) <= MEMBERS_SHOWN + 1
  ) {
    return council.committees;
  }
  const shown: CommitteeGroup[] = [];
  let left = MEMBERS_SHOWN;
  for (const group of council.committees) {
    const self = group.members.findIndex(
      (member) => !!member.page && member.page.id === props.highlightId,
    );
    const take = Math.max(left, self + 1);
    if (take <= 0) continue;
    shown.push({ ...group, members: group.members.slice(0, take) });
    left -= Math.min(take, group.members.length);
  }
  return shown;
}

function foldedOf(council: CouncilSection): number {
  return (
    namedOf(council) -
    shownGroups(council).reduce((sum, group) => sum + group.members.length, 0)
  );
}

/** For the button to say what it opens, the same on the server and in the
 * browser. */
const councilsId = useId();
function boxId(office: string): string {
  return `${councilsId}-${createSlug(office)}`;
}

/** Where the first member the fold held stands once the council is whole.
 * A committee shows the start of its members, so that is the first committee
 * cut short, after everybody before it - not the first past a count: the
 * person the reader came from shows past the fold. */
function firstFolded(council: CouncilSection): number {
  const shown = new Map(
    shownGroups(council).map((group) => [group.key, group.members.length]),
  );
  let index = 0;
  for (const group of council.committees) {
    const count = shown.get(group.key) ?? 0;
    if (count < group.members.length) return index + count;
    index += group.members.length;
  }
  return index;
}

/** Opening the council takes the focused button away, which would drop a
 * keyboard or screen-reader user back to the top of the page. Focus goes to
 * the first member it opened instead, the next Tab carrying on down the
 * council; `preventScroll`, because the rows open downwards from where the
 * reader already is. A member with no page is text, so their row takes the
 * focus rather than a link. */
async function showAllMembers(council: CouncilSection) {
  const index = firstFolded(council);
  unfold(council.office);
  await nextTick();
  const rows = document
    .getElementById(boxId(council.office))
    ?.querySelectorAll<HTMLElement>(".list-member");
  const row = rows?.[index];
  const link = row?.querySelector<HTMLElement>("a");
  if (link) {
    link.focus({ preventScroll: true });
  } else if (row) {
    row.tabIndex = -1;
    row.focus({ preventScroll: true });
  }
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

.council-group__count {
  font-weight: 400;
  margin-left: 4px;
}
</style>
