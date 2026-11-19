<template>
  <section class="task-merge" data-task-merge>
    <div class="task-merge__label">
      {{ task.branches.length > 1 ? "Gałęzie" : "Gałąź" }}
    </div>
    <p
      v-if="task.branches.length === 0"
      class="text-body-2 text-medium-emphasis"
      data-task-merge-missing
    >
      Brak gałęzi: dopisz ją w „Edytuj”.
    </p>
    <ul v-else class="task-merge__branches">
      <li
        v-for="branch in shown"
        :key="branch.name"
        class="task-merge__branch"
        :data-task-merge-branch="branch.name"
      >
        <div class="task-merge__line">
          <span class="task-merge__name" :title="branch.name">
            {{ branch.name }}
          </span>
          <!-- Nothing to open for a branch GitHub no longer has. -->
          <a
            v-if="branch.check?.state !== 'gone'"
            class="task-merge__link"
            :href="`${REPO}/compare/main...${encodeURIComponent(branch.name)}`"
            target="_blank"
            rel="noopener"
            title="Co gałąź zmienia względem main, na GitHubie"
          >
            Zmiany
            <v-icon :icon="mdiOpenInNew" size="14" />
          </a>
          <a
            v-if="branch.check?.state !== 'gone'"
            class="task-merge__link"
            :href="`${REPO}/tree/${encodeURIComponent(branch.name)}`"
            target="_blank"
            rel="noopener"
            title="Gałąź na GitHubie"
          >
            GitHub
            <v-icon :icon="mdiOpenInNew" size="14" />
          </a>
        </div>
        <div
          v-if="branch.check"
          class="task-merge__state"
          :data-task-merge-branch-state="branch.check.state"
        >
          <span
            v-if="branch.check.commits > 0 && branch.check.commits <= MAX_DOTS"
            class="task-merge__dots"
            aria-hidden="true"
          >
            <span
              v-for="n in branch.check.commits"
              :key="n"
              class="task-merge__dot"
              :class="{ 'task-merge__dot--landed': n <= branch.check.landed }"
            />
          </span>
          <span
            v-else-if="branch.check.commits > MAX_DOTS"
            class="task-merge__bar"
            aria-hidden="true"
          >
            <span
              class="task-merge__bar-fill"
              :style="{
                width: `${(100 * branch.check.landed) / branch.check.commits}%`,
              }"
            />
          </span>
          <span class="text-body-2">{{ stateText(branch.check) }}</span>
        </div>
        <div
          v-else
          class="task-merge__state text-body-2 text-medium-emphasis"
        >
          Jeszcze nie sprawdzone.
        </div>
      </li>
    </ul>
    <v-btn
      v-if="hidden > 0"
      size="small"
      variant="text"
      class="mt-1"
      @click="showAll = true"
    >
      {{ hiddenText }}
    </v-btn>
    <p v-if="task.mergeCheck" class="task-merge__checked text-caption">
      Sprawdzone {{ formatTaskDate(task.mergeCheck.checkedAt) }} na main
      {{ task.mergeCheck.main.slice(0, 8) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiOpenInNew } from "@mdi/js";
import { polishCounting } from "~/composables/polish";
import { formatTaskDate } from "~/utils/taskStyle";
import type { MergeCheck, Task } from "~~/shared/tasks";

/** A merge's branches: where to read them on GitHub, and how much of each
 * the last check of main found there. A branch lands on main as rewritten
 * copies, so the check compares the changes, not the commit ids. */

const REPO = "https://github.com/SzymonPajzert/koryta";
/** More commits than this draw as a bar: dots stop being countable. */
const MAX_DOTS = 12;
/** Branches shown before „+N”. */
const FIRST = 3;

const props = defineProps<{ task: Task }>();

const showAll = ref(false);

const branches = computed(() =>
  props.task.branches.map((name) => ({
    name,
    check: props.task.mergeCheck?.branches.find((b) => b.name === name),
  })),
);

const shown = computed(() =>
  showAll.value ? branches.value : branches.value.slice(0, FIRST),
);
const hidden = computed(() => branches.value.length - shown.value.length);
const hiddenText = computed(
  () =>
    `+${polishCounting(hidden.value, "gałąź", "gałęzie", "gałęzi")}`,
);

const changes = (n: number) => polishCounting(n, "zmiana", "zmiany", "zmian");

function stateText(check: MergeCheck["branches"][number]): string {
  if (check.state === "gone") return "Gałęzi nie ma już na GitHubie.";
  if (check.state === "merged") return "Cała na main.";
  if (check.state === "partial") {
    return `Na main ${check.landed} z ${changes(check.commits)}.`;
  }
  return `Poza main: ${changes(check.commits)}.`;
}
</script>

<style scoped>
.task-merge {
  margin-bottom: 16px;
}

.task-merge__label {
  margin-bottom: 6px;
  font-size: 0.875rem;
  font-weight: 600;
}

.task-merge__branches {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.task-merge__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
}

/* The name to type, in a code face, whole: a branch name is not shortened
 * where it is the thing to copy. */
.task-merge__name {
  padding: 2px 8px;
  border-radius: 6px;
  font-family: ui-monospace, monospace;
  font-size: 0.8125rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
  background: rgb(var(--v-theme-surface-muted));
}

.task-merge__link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 0.875rem;
  color: rgb(var(--v-theme-ink-info));
  text-decoration: none;
}

.task-merge__link:hover {
  text-decoration: underline;
}

.task-merge__state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.task-merge__dots {
  display: inline-flex;
  gap: 3px;
}

/* A commit of the branch: filled once the same change is on main. */
.task-merge__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1.5px rgb(var(--v-theme-ink-neutral));
}

.task-merge__dot--landed {
  box-shadow: none;
  background: rgb(var(--v-theme-ink-success));
}

.task-merge__bar {
  flex: 0 0 96px;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface-muted));
}

.task-merge__bar-fill {
  display: block;
  height: 100%;
  background: rgb(var(--v-theme-ink-success));
}

.task-merge__checked {
  margin-top: 6px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
</style>
