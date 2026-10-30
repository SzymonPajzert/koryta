<template>
  <ol
    class="dchain"
    data-testid="declarations-progress"
    aria-label="Od wyszukania do publikacji"
  >
    <li
      v-for="(stage, index) in stages"
      :key="stage.key"
      class="dchain__stage"
      :data-stage="stage.key"
    >
      <span
        class="dchain__node"
        :class="{ 'dchain__node--moved': stage.value > 0 }"
        aria-hidden="true"
      >
        {{ index + 1 }}
      </span>
      <div class="dchain__body">
        <div class="dchain__figure">
          <StatsStatTile
            :label="stage.title"
            :value="stage.value"
            :hint="stage.hint"
          />
          <!-- How much of the stage's own count moved on: a share within one
               unit, never across two - a crop is not a candidacy. -->
          <v-progress-linear
            class="dchain__share"
            :model-value="stage.share"
            :height="4"
            color="ink-sage"
            :bg-color="ink.track"
            rounded
            :aria-label="`${stage.title}: ${Math.round(stage.share)}%`"
          />
        </div>
        <ul v-if="stage.lines.length" class="dchain__lines">
          <li v-for="line in stage.lines" :key="line.key">
            <!-- What needs a person links to its list below, with the list's
                 colour; what is waiting or out of the running is only said. -->
            <a
              v-if="line.href"
              :href="line.href"
              class="dchain__line dchain__line--link"
              :data-line="line.key"
            >
              <span
                v-if="line.tone"
                class="dchain__dot"
                :class="`bg-ink-${line.tone}`"
                aria-hidden="true"
              />
              <span class="dchain__count">{{ formatCount(line.count) }}</span>
              <span class="dchain__label">{{ line.label }}</span>
            </a>
            <span v-else class="dchain__line" :data-line="line.key">
              <span class="dchain__count">{{ formatCount(line.count) }}</span>
              <span class="dchain__label">{{ line.label }}</span>
            </span>
          </li>
        </ul>
      </div>
    </li>

    <!-- The end of the line: what all of it adds up to today. -->
    <li class="dchain__stage dchain__stage--cap" data-stage="cap">
      <span class="dchain__node dchain__node--cap" aria-hidden="true">
        <v-icon :icon="mdiCalendarCheck" size="14" />
      </span>
      <AdminDeclarationsCap
        class="dchain__cap"
        :today="overview.publications.today"
        :daily-limit="overview.dailyLimit"
        :queued="overview.publications.queued"
        :publish="publish"
      />
    </li>
  </ol>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiCalendarCheck } from "@mdi/js";
import { formatCount, ink } from "~/utils/chartTheme";
import { declarationStages } from "~/utils/declarationsAdmin";
import { polishCountingGenitive } from "~/composables/polish";
import type { RowTone } from "~/composables/rowTone";
import type { DeclarationOverview } from "~~/shared/declarations";

/** The overview's chain, under the bar of declarations by state: the way
 * from a candidacy searched to a person published, left to right, each stage
 * with how many made it through and what fell out there, ending in today's
 * publications against the limit. Below a desktop's width the line runs down
 * the left edge instead, the way the rows of the lists below carry theirs.
 *
 * The figure of each stage is what moved on, and its bar the share of the
 * stage's own count that did: units change along the way - candidacies,
 * declarations, crops, pages, people - so no share is taken across two. */
const props = defineProps<{
  overview: DeclarationOverview;
  /** The press of „Opublikuj z kolejki”, as `AdminDeclarationsCap` takes it. */
  publish: () => Promise<boolean>;
}>();

type Line = {
  key: string;
  count: number;
  label: string;
  /** The section below that lists them. */
  href?: string;
  /** Set on what needs a person: the colour of its list's rows. */
  tone?: RowTone;
};

type Stage = {
  key: string;
  title: string;
  value: number;
  hint: string;
  /** 0-100. */
  share: number;
  lines: Line[];
};

const share = (part: number, whole: number) =>
  whole > 0 ? Math.min(100, (part / whole) * 100) : 0;

const stages = computed<Stage[]>(() => {
  const o = props.overview;
  const s = declarationStages(o);
  const candidacy = o.candidacies.byStatus;
  const extract = o.extracts.byStatus;
  const list: Stage[] = [
    {
      key: "search",
      title: "Znalezione oświadczenia",
      value: s.found,
      hint: `z ${polishCountingGenitive(s.candidacies, "kandydatury", "kandydatur")}`,
      share: share(s.found, s.candidacies),
      lines: [
        {
          key: "pending",
          count: candidacy.pending,
          label: "jeszcze nie szukano",
        },
        {
          key: "not_found",
          count: candidacy.not_found,
          label: "nie znaleziono",
          href: "#nie-znaleziono",
        },
        {
          key: "unconfirmed",
          count: candidacy.unconfirmed,
          label: "znalezione, ale niepewne",
        },
      ],
    },
    {
      key: "crops",
      title: "Wycinki z datą",
      value: s.crops,
      hint: `z ${polishCountingGenitive(s.declarations, "oświadczenia", "oświadczeń")}`,
      share: share(s.crops, s.declarations),
      lines: [
        {
          key: "failed",
          count: extract.failed,
          label: "bez wycinka",
          href: "#nie-znaleziono",
        },
        { key: "withdrawn", count: extract.withdrawn, label: "wycofane" },
      ],
    },
    {
      key: "readings",
      title: "Odczytane zgodnie",
      value: s.agreed,
      hint: `z ${polishCountingGenitive(s.crops, "wycinka", "wycinków")}`,
      share: share(s.agreed, s.crops),
      lines: [
        { key: "open", count: extract.open, label: "czeka na czytelników" },
        { key: "unreadable", count: extract.unreadable, label: "nieczytelne" },
        {
          key: "disputed",
          count: extract.disputed,
          label: "sporne",
          href: "#sporne",
          tone: "danger",
        },
      ],
    },
    {
      key: "pages",
      title: "Zgodne ze stroną",
      value: s.same,
      hint: `z ${polishCountingGenitive(s.compared, "strony", "stron")}`,
      share: share(s.same, s.compared),
      lines: [
        {
          key: "different",
          count: o.pages.different,
          label: "inna data na stronie",
          href: "#inna-data",
          tone: "danger",
        },
        {
          key: "confirmed",
          count: o.pages.confirmed,
          label: "już publiczne, data się zgadza",
        },
        {
          key: "noDate",
          count: o.pages.noDate,
          label: "strona bez daty urodzenia",
        },
      ],
    },
    {
      key: "publications",
      title: "Opublikowane",
      value: s.published,
      hint: `z ${polishCountingGenitive(s.decided, "osoby", "osób")}`,
      share: share(s.published, s.decided),
      lines: [
        { key: "queued", count: o.publications.queued, label: "w kolejce" },
        {
          key: "held",
          count: o.publications.held,
          label: "wstrzymane",
          href: "#wstrzymane",
          tone: "warning",
        },
      ],
    },
  ];
  // A line that counts nothing is only noise next to the ones that do; the
  // lists below say "nothing" for themselves.
  return list.map((stage) => ({
    ...stage,
    lines: stage.lines.filter((line) => line.count > 0),
  }));
});
</script>

<style scoped>
/* The rail: a 2px line through numbered stops, the stages hanging under
 * them. One grid, so the stages share their widths and the cap - the end of
 * the line - gets a little more. */
.dchain {
  --dchain-node: 24px;
  --dchain-gap: 24px;
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr)) minmax(200px, 1.3fr);
  column-gap: var(--dchain-gap);
}

.dchain__stage {
  position: relative;
  min-width: 0;
  padding-top: calc(var(--dchain-node) + 16px);
}

/* The line runs from each stop across the gap to the next one. */
.dchain__stage::before {
  content: "";
  position: absolute;
  top: calc(var(--dchain-node) / 2 - 1px);
  left: 0;
  right: calc(var(--dchain-gap) * -1);
  height: 2px;
  background: rgba(var(--v-border-color), 0.16);
}

.dchain__stage--cap::before {
  display: none;
}

.dchain__node {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  width: var(--dchain-node);
  height: var(--dchain-node);
  border-radius: 50%;
  border: 2px solid rgb(var(--v-theme-ink-neutral));
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/* A stage something got through is filled; one still at nothing stays a
 * ring, so the line shows at a glance how far the run has reached. */
.dchain__node--moved {
  border-color: rgb(var(--v-theme-ink-sage));
  background: rgb(var(--v-theme-ink-sage));
  color: rgb(var(--v-theme-surface));
}

.dchain__node--cap {
  border-color: rgb(var(--v-theme-ink-success));
  color: rgb(var(--v-theme-ink-success));
}

.dchain__figure {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dchain__share {
  max-width: 160px;
}

.dchain__lines {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dchain__line {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.dchain__line--link {
  color: rgb(var(--v-theme-on-surface));
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}

.dchain__line--link:hover {
  text-decoration-style: solid;
}

.dchain__line--link:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
  border-radius: 2px;
}

.dchain__dot {
  flex: none;
  align-self: center;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dchain__count {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* The cap is the end of the line, set on the page's one tint so the run
 * reads as arriving somewhere. */
.dchain__cap {
  padding: 12px 16px 16px;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-sage));
}

/* Below a desktop's width six columns are too narrow for their words: the
 * line turns and runs down the left edge, like the rail of a list row. */
@media (max-width: 959.98px) {
  .dchain {
    grid-template-columns: minmax(0, 1fr);
  }

  .dchain__stage {
    padding: 0 0 20px calc(var(--dchain-node) + 16px);
  }

  .dchain__stage::before {
    top: var(--dchain-node);
    bottom: 0;
    left: calc(var(--dchain-node) / 2 - 1px);
    right: auto;
    width: 2px;
    height: auto;
  }

  .dchain__stage--cap {
    padding-bottom: 0;
  }

  /* On a tablet the figure and what fell out sit side by side. */
  .dchain__body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }

  .dchain__lines {
    margin-top: 0;
  }
}

/* On a phone what fell out wraps under the figure as one run of text. */
@media (max-width: 599.98px) {
  .dchain__body {
    display: block;
  }

  .dchain__lines {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 2px 14px;
    margin-top: 8px;
  }
}
</style>
