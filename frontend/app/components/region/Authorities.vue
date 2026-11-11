<template>
  <!-- A place that shows nobody: one quiet line where the section would be,
       the company page's rule for what a section lacks - and, where the
       people are on another page, the way to them. -->
  <p
    v-if="emptyLine"
    class="k-absent mb-0"
    data-testid="region-authorities-empty"
  >
    {{ emptyLine.text }}
    <template v-if="emptyLine.link">
      <NuxtLink :to="emptyLine.link.url" class="text-ink-info">{{
        emptyLine.link.name
      }}</NuxtLink
      >.
    </template>
  </p>

  <!-- Who governs the place: the head its voters chose and its councils, as
       the newest local election left them. Szymon, board round
       region-lists-r1: "Display who's currently the president, who is in
       the rada. I know we don't have all the people right now, but let's
       create a view that will be able to show this information." -->
  <PageSection
    v-else
    id="wladze"
    :title="authorities.title"
    data-testid="region-authorities"
  >
    <template #caption>
      <span data-nosnippet
        >według wyborów samorządowych {{ electionYear }}</span
      >
    </template>
    <template #info>
      <p class="mb-2">
        Osoby, które wygrały wybory samorządowe 7 kwietnia
        {{ electionYear }} r. (wójtów, burmistrzów i prezydentów miast także w
        drugiej turze 21 kwietnia) i mają stronę na koryta.pl.
      </p>
      <p class="mb-2">
        Radnych grupujemy według komitetu, z którego listy zdobyli mandat.
        Partie przy nazwiskach to powiązania danej osoby, które zebraliśmy.
      </p>
      <p class="mb-0">
        Nie uwzględniamy jeszcze odwołań, wyborów przedterminowych ani zmian w
        składzie rady w trakcie kadencji.
      </p>
    </template>

    <!-- The head of the executive. -->
    <div
      v-if="authorities.executive || pkwHead"
      class="k-group"
      data-testid="region-authorities-head"
    >
      <h3 class="k-group-head">{{ headTitle }}</h3>

      <template v-if="executive?.state === 'held'">
        <v-row dense>
          <v-col cols="12" md="6">
            <SuccessionSeatCard
              :name="executive.holder.personName"
              :url="personUrl(executive.holder)"
              :published="executive.holder.published"
              :parties="executive.holder.parties"
              :party-hidden="executive.holder.partyHidden"
              :since="`kadencja ${authorities.term}`"
              :aria-current="
                executive.holder.personId === highlightId ? 'true' : undefined
              "
              data-testid="region-authorities-holder"
            >
              <template v-if="executive.committee" #details>
                <div class="authority-meta">
                  Komitet: {{ executive.committee }}
                </div>
              </template>
            </SuccessionSeatCard>
          </v-col>
        </v-row>
      </template>

      <!-- Two wins stored for one seat: an editor sees both and what to
           fix, a reader neither. -->
      <template v-else-if="executive?.state === 'contested' && user">
        <v-row dense>
          <v-col
            v-for="holder in executive.holders"
            :key="holder.personId"
            cols="12"
            md="6"
          >
            <SuccessionSeatCard
              :name="holder.personName"
              :url="personUrl(holder)"
              :published="holder.published"
              :parties="holder.parties"
              :party-hidden="holder.partyHidden"
              :since="`kadencja ${authorities.term}`"
            />
          </v-col>
        </v-row>
        <p class="k-absent mt-2 mb-0">
          Wygraną w {{ electionYear }} r. ma tu zapisaną więcej niż jedna osoba.
          Czytelnicy nie widzą żadnej, dopóki wynik nie zostanie poprawiony.
        </p>
      </template>

      <!-- PKW's own line, where the site knows nobody (preview c). -->
      <p v-else-if="pkwHead" class="k-absent mb-0">
        <template v-if="pkwHead.name">{{ pkwName(pkwHead.name) }} · </template>
        Z listy {{ pkwHead.committee }} ·
        {{
          pkwHead.member
            ? `należy do partii: ${pkwHead.member}`
            : "nie należy do partii"
        }}
        · nie ma jeszcze strony na koryta.pl
      </p>

      <!-- The last word and the (i) as one unbreakable piece, as a
           company's absent board has them: alone, the (i) wrapped onto a
           line of its own. -->
      <p v-else-if="executive?.state === 'appointed'" class="k-absent mb-0">
        Nie znamy jeszcze {{ appointedHead
        }}<span class="k-absent__tail"
          >{{ appointedLast }}.
          <InfoBubble :label="executive.title">
            {{
              executive.title === "Starosta"
                ? "Starostę i zarząd powiatu wybiera rada powiatu, a nie wyborcy, więc nie ma ich w wynikach wyborów."
                : "Marszałka i zarząd województwa wybiera sejmik, a nie wyborcy, więc nie ma ich w wynikach wyborów."
            }}
          </InfoBubble>
        </span>
      </p>
      <p v-else-if="executive?.state === 'awaiting'" class="k-absent mb-0">
        Wynik wyborów na {{ accusative(executive.office) }} czeka na
        sprawdzenie.
      </p>
      <p v-else-if="executive" class="k-absent mb-0">
        Nie znamy jeszcze {{ genitive(executive.title) }}.
      </p>
    </div>

    <!-- Each council. -->
    <div
      v-for="council in councils"
      :key="council.office"
      class="k-group"
      :data-testid="`region-authorities-council-${council.office}`"
    >
      <h3 class="k-group-head">
        {{ council.title }}
        <span v-if="council.seats" class="k-group-head__count">{{
          polishCounting(council.seats.seats, "mandat", "mandaty", "mandatów")
        }}</span>
      </h3>

      <!-- Preview c: PKW's whole split, every seat, by the committee that
           won it. -->
      <StatsCompositionBar
        v-if="council.seats"
        class="mb-3"
        :segments="segmentsOf(council.seats)"
        :summary="summaryOf(council)"
      />

      <template v-if="council.shown">
        <!-- b: the names under the committee, no row each. -->
        <div v-if="wariant === 'b'" class="council-names">
          <div
            v-for="group in council.committees"
            :key="group.key"
            class="council-names__group"
          >
            <div class="council-names__head">
              <PartyChip
                v-if="group.party"
                :party="canonicalParty(group.party)"
              />
              <span v-else class="council-names__committee">{{
                group.committee ?? "Komitet nieznany"
              }}</span>
            </div>
            <div class="council-names__line">
              <span
                v-for="member in group.members"
                :key="member.personId"
                class="council-names__item"
                ><NuxtLink
                  :to="personUrl(member)"
                  :rel="member.published ? undefined : 'nofollow'"
                  class="council-names__link"
                  :class="{
                    'council-names__link--self':
                      member.personId === highlightId,
                  }"
                  >{{ member.personName }}</NuxtLink
                ></span
              >
            </div>
          </div>
        </div>

        <!-- a and c: a row each, under the committee. -->
        <div v-else :id="boxId(council.office)" class="lists-box k-bleed-xs">
          <template v-for="group in shownGroups(council)" :key="group.key">
            <div class="council-group__head">
              {{ group.committee ?? "Komitet nieznany" }}
              <span v-if="seatsOf(council, group)" class="council-group__count"
                >{{ group.members.length }} z
                {{ seatsOf(council, group) }}</span
              >
            </div>
            <RegionListMembers
              :members="group.members"
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
            Pokaż wszystkich radnych ({{ council.shown }})
          </button>
        </div>
      </template>

      <p class="k-absent mt-2 mb-0">{{ footOf(council) }}</p>
    </div>
  </PageSection>
</template>

<script setup lang="ts">
import { useCurrentUser } from "vuefire";
import { canonicalParty, partyColors } from "~~/shared/misc";
import { readableInkOn } from "~~/shared/colors";
import { ink } from "~/utils/chartTheme";
import { polishCounting } from "~/composables/polish";
import { createSlug, generateEntityUrl } from "~~/shared/slugs";
import { committeeKey, type ListMember } from "~~/shared/electionLists";
import type {
  AuthorityKind,
  CommitteeSeats,
  CouncilView,
  RegionAuthorities,
} from "~~/shared/regionAuthorities";
import type {
  CompositionCouncil,
  RegionComposition,
} from "~~/shared/regionComposition";
import type { CompositionSegment } from "~/components/stats/CompositionBar.vue";

const props = defineProps<{
  authorities: RegionAuthorities;
  /** Where a place that shows nobody sends the reader: its powiat or its
   * city, by name; the name is missing where its read failed. `councilOnly`
   * for Kraków's hand-drawn page, which shows its rada and no prezydent. */
  pointerTarget?: { name?: string; url: string; councilOnly?: boolean };
  /** The person the reader came from, whose row a council marks. */
  highlightId?: string;
  /** TEMP(wariant): a - a row each with the person's parties, b - names
   * under their committee, c - a with PKW's whole result (preview). */
  wariant: "a" | "b" | "c";
  /** PKW's whole 2024 result, for preview c. */
  composition?: RegionComposition | null;
}>();

const user = useCurrentUser();

const executive = computed(() => props.authorities.executive);
const electionYear = computed(() => props.authorities.term.slice(0, 4));

/** PKW's head where the site holds nobody for the seat. */
const pkwHead = computed(() => {
  const head = props.composition?.executive;
  if (!head) return undefined;
  const state = executive.value?.state;
  return !state || state === "unknown" ? head : undefined;
});

const headTitle = computed(() => {
  if (executive.value) return executive.value.title;
  const office = pkwHead.value?.office ?? "";
  return office === "Prezydent" ? "Prezydent miasta" : office;
});

/** „starosty”, „prezydenta miasta”: after „Nie znamy jeszcze”. */
function genitive(title: string): string {
  return (
    {
      Starosta: "starosty",
      "Marszałek województwa": "marszałka województwa",
      "Prezydent miasta": "prezydenta miasta",
      Burmistrz: "burmistrza",
      Wójt: "wójta",
    }[title] ?? title.toLowerCase()
  );
}

/** The appointed head after „Nie znamy jeszcze”, up to its last word, and
 * the last word, which the template keeps on one line with the (i) - as
 * succession/CompanyChanges.vue splits its absent line. Only the last word:
 * „marszałka województwa.” unbroken would overflow a zoomed phone. */
const appointedName = computed(() =>
  executive.value?.state === "appointed" ? genitive(executive.value.title) : "",
);
const appointedHead = computed(() =>
  appointedName.value.slice(0, appointedName.value.lastIndexOf(" ") + 1),
);
const appointedLast = computed(() =>
  appointedName.value.slice(appointedName.value.lastIndexOf(" ") + 1),
);

/** „prezydenta miasta”: after „wybory na”. */
function accusative(office: string): string {
  return (
    { Prezydent: "prezydenta miasta", Burmistrz: "burmistrza", Wójt: "wójta" }[
      office
    ] ?? office.toLowerCase()
  );
}

/** „tego powiatu”: after „nikogo z władz”. */
const PLACE_GENITIVE: Record<AuthorityKind, string> = {
  wojewodztwo: "tego województwa",
  powiat: "tego powiatu",
  miasto: "tego miasta",
  gmina: "tej gminy",
  dzielnica: "tej dzielnicy",
};

/** „z rady powiatu”, „z sejmiku”. */
function councilGenitive(office: string): string {
  return (
    {
      Sejmik: "sejmiku",
      "Rada powiatu": "rady powiatu",
      "Rada miasta": "rady miasta",
      "Rada gminy": "rady gminy",
      "Rada dzielnicy": "rady dzielnicy",
    }[office] ?? office.toLowerCase()
  );
}

/** PKW writes „SIEWIERA Mariusz”; a page writes „Mariusz Siewiera”. */
function pkwName(name: string): string {
  const [surname, ...given] = name.split(" ");
  const cased = (surname ?? "")
    .toLowerCase()
    .replace(/(^|-)\p{L}/gu, (letter) => letter.toUpperCase());
  return [...given, cased].join(" ");
}

function personUrl(member: ListMember): string {
  return generateEntityUrl("person", member.personId, member.personName);
}

/** The line where a place shows nobody, with the way to where its people
 * are. Null where the section is drawn. */
const emptyLine = computed(() => {
  const view = props.authorities;
  const state = view.executive?.state;
  if (
    view.shown > 0 ||
    state === "awaiting" ||
    state === "contested" ||
    props.composition
  ) {
    return null;
  }
  const target = props.pointerTarget;
  if (view.pointer === "powiat") {
    return {
      text: "Nie znamy jeszcze władz tej gminy. Kandydatów z gmin zapisujemy na razie przy powiecie:",
      link: target
        ? { name: target.name ?? "strona powiatu", url: target.url }
        : undefined,
    };
  }
  if (view.pointer === "miasto") {
    return view.kind === "dzielnica"
      ? {
          text: "Nie znamy jeszcze władz tej dzielnicy. Kandydatów do rad dzielnic zapisujemy na razie przy mieście:",
          link: target
            ? { name: target.name ?? "strona miasta", url: target.url }
            : undefined,
        }
      : {
          text: target?.councilOnly
            ? "Radę miasta pokazujemy na stronie miasta:"
            : "Prezydenta i radę miasta pokazujemy na stronie miasta:",
          link: target
            ? { name: target.name ?? "strona miasta", url: target.url }
            : undefined,
        };
  }
  return {
    text: `Nie znamy jeszcze nikogo z władz ${PLACE_GENITIVE[view.kind]}.`,
    link: undefined,
  };
});

type CouncilShown = CouncilView & { seats?: CompositionCouncil };

/** The councils to draw: the graph's, with PKW's seats beside them in
 * preview c, and PKW's councils the graph knows nobody of. */
const councils = computed<CouncilShown[]>(() => {
  const graph = props.authorities.councils;
  const pkw = props.wariant === "c" ? (props.composition?.councils ?? []) : [];
  if (!pkw.length) return graph;
  const byOffice = new Map(graph.map((council) => [council.office, council]));
  const drawn: CouncilShown[] = pkw.map((seats) => {
    const known = byOffice.get(seats.office);
    return known
      ? { ...known, seats }
      : {
          office: seats.office,
          title:
            seats.office === "Sejmik" ? "Sejmik województwa" : seats.office,
          committees: [],
          shown: 0,
          seats,
        };
  });
  return [
    ...drawn,
    ...graph.filter(
      (council) => !pkw.some((seats) => seats.office === council.office),
    ),
  ];
});

/** A committee's seats in PKW's split, joined by the committee key the
 * lists use: „7 z 9”. */
function seatsOf(council: CouncilShown, group: CommitteeSeats) {
  if (!council.seats || !group.committee) return undefined;
  const key = createSlug(committeeKey(group.committee));
  return council.seats.split.find(
    (seats) => createSlug(committeeKey(seats.committee)) === key,
  )?.seats;
}

/** One party's colour for a committee; a local list in the muted grey. Two
 * parties' list in the first one's, for now (round region-lists-r2). */
function colorOf(parties: string[]): string {
  const party = parties[0] ? canonicalParty(parties[0]) : undefined;
  return (party && partyColors[party]) || ink.muted;
}

function segmentsOf(council: CompositionCouncil): CompositionSegment[] {
  return council.split.map((seats) => {
    const color = colorOf(seats.parties);
    return {
      key: seats.committee,
      label: seats.label,
      value: seats.seats,
      color,
      labelColor: readableInkOn(color),
    };
  });
}

function summaryOf(council: CouncilShown): string {
  const seats = council.seats!;
  return `${council.title}, ${polishCounting(seats.seats, "mandat", "mandaty", "mandatów")}: ${seats.split
    .map((each) => `${each.label} ${each.seats}`)
    .join(", ")}`;
}

/** The line under a council: what it leaves out. */
function footOf(council: CouncilShown): string {
  const seats = council.seats?.seats;
  if (seats !== undefined) {
    if (!council.shown) {
      return `Nie pokazujemy jeszcze nikogo z ${seats} radnych.`;
    }
    const missing = seats - council.shown;
    return missing > 0
      ? `Brakuje jeszcze ${missing} z ${seats} radnych.`
      : "Pokazujemy wszystkich radnych.";
  }
  return council.shown
    ? "Pokazujemy tylko radnych, którzy mają stronę na koryta.pl."
    : `Nie znamy jeszcze nikogo z ${councilGenitive(council.office)}.`;
}

/** How many members a council shows before „Pokaż wszystkich radnych”: a
 * sejmik shows up to thirty-six. Never folding a single one away, nor the
 * person the reader came from. */
const MEMBERS_SHOWN = 12;
const unfolded = ref(new Set<string>());

function unfold(office: string) {
  unfolded.value = new Set([...unfolded.value, office]);
}

function shownGroups(council: CouncilView): CommitteeSeats[] {
  if (
    unfolded.value.has(council.office) ||
    council.shown <= MEMBERS_SHOWN + 1
  ) {
    return council.committees;
  }
  const shown: CommitteeSeats[] = [];
  let left = MEMBERS_SHOWN;
  for (const group of council.committees) {
    const self = group.members.findIndex(
      (member) => member.personId === props.highlightId,
    );
    const take = Math.max(left, self + 1);
    if (take <= 0) continue;
    shown.push({ ...group, members: group.members.slice(0, take) });
    left -= Math.min(take, group.members.length);
  }
  return shown;
}

function foldedOf(council: CouncilView): number {
  return (
    council.shown -
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
function firstFolded(council: CouncilView): number {
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
 * the first member it opened instead, a link, so the next Tab carries on
 * down the council; `preventScroll`, because the rows open downwards from
 * where the reader already is. */
async function showAllMembers(council: CouncilView) {
  const index = firstFolded(council);
  unfold(council.office);
  await nextTick();
  const rows = document
    .getElementById(boxId(council.office))
    ?.querySelectorAll<HTMLElement>(".list-member");
  rows?.[index]
    ?.querySelector<HTMLElement>("a")
    ?.focus({ preventScroll: true });
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
   how many of its seats are shown in preview c. */
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

/* b: the names of one committee as one line under its chip, the facts
   line's hung dot between them. */
.council-names__group + .council-names__group {
  margin-top: 12px;
}

.council-names__committee {
  font-size: var(--k-meta-size);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.council-names__line {
  column-gap: 17px;
  display: flex;
  flex-wrap: wrap;
  font-size: var(--k-ui-size);
  line-height: 1.6;
  margin: 4px 0 0 -4px;
  overflow-x: clip;
  padding-inline-start: 4px;
}

.council-names__item {
  position: relative;
}

.council-names__item + .council-names__item::before {
  color: rgba(var(--v-theme-on-surface), 0.38);
  content: "·";
  content: "·" / "";
  left: -11px;
  position: absolute;
}

.council-names__link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: rgba(var(--v-theme-on-surface), 0.38);
  text-underline-offset: 3px;
}

.council-names__link--self {
  font-weight: 700;
}
</style>
