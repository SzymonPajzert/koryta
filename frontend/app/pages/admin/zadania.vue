<template>
  <!-- Full width takes the layout's padding away too, so the page puts its
       own back. -->
  <div class="w-100 pa-3 pa-sm-4">
    <div class="tasks-page__head d-flex align-start flex-wrap ga-2 mb-2">
      <div class="tasks-page__intro">
        <h1 class="text-h5 text-sm-h4 mb-2">Zadania</h1>
        <p class="text-body-2 text-medium-emphasis">
          Co zostało do wdrożenia, uruchomienia, zdecydowania i zbudowania - i
          co na co czeka. Agenci dopisują tu to, co zostawiają po sesji.
        </p>
      </div>
      <v-btn-toggle
        v-model="view"
        mandatory
        density="comfortable"
        variant="outlined"
        divided
        data-task-view
      >
        <v-btn value="lista" :prepend-icon="mdiFormatListBulleted">Lista</v-btn>
        <v-btn value="mapa" :prepend-icon="mdiSitemapOutline">Mapa</v-btn>
      </v-btn-toggle>
      <v-btn
        color="ink-sage"
        variant="flat"
        :prepend-icon="mdiPlus"
        data-task-add
        @click="openDialog(null)"
      >
        Dodaj
      </v-btn>
    </div>

    <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">
      {{ loadError }}
    </v-alert>
    <v-alert
      v-if="missingTarget"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      Nie ma takiego zadania.
    </v-alert>
    <v-progress-linear v-if="pending" indeterminate class="mb-4" />

    <div
      v-if="tasks.length > 0"
      class="tasks-page__filters d-flex align-center flex-wrap ga-2 mb-2"
    >
      <v-text-field
        v-model="search"
        placeholder="Szukaj w zadaniach"
        :prepend-inner-icon="mdiMagnify"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        class="tasks-page__search"
        data-task-search
      />
      <v-chip-group v-model="who" mandatory selected-class="text-ink-sage">
        <v-chip value="wszyscy" size="small" filter>Wszystkie</v-chip>
        <v-chip value="ty" size="small" filter>Twoje</v-chip>
        <v-chip value="agent" size="small" filter>Dla agenta</v-chip>
      </v-chip-group>
      <v-select
        v-if="allTags.length > 0"
        v-model="tag"
        :items="allTags"
        placeholder="Tag"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        class="tasks-page__tag"
      />
      <v-select
        v-if="goals.length > 0"
        v-model="goal"
        :items="goals"
        item-title="title"
        item-value="id"
        placeholder="Cel"
        :prepend-inner-icon="taskKindConfig.goal.icon"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        class="tasks-page__goal"
        data-task-goal-filter
      />
      <v-btn-toggle
        v-if="view === 'lista'"
        v-model="order"
        mandatory
        density="compact"
        variant="outlined"
        divided
        data-task-order
      >
        <v-btn
          value="najstarsze"
          size="small"
          :prepend-icon="mdiSortClockAscendingOutline"
          title="Najpierw te z ustaloną kolejnością, potem od najstarszych"
        >
          Najstarsze
        </v-btn>
        <v-btn
          value="najnowsze"
          size="small"
          :prepend-icon="mdiSortClockDescendingOutline"
          title="Ostatnio dodane na górze każdej listy"
        >
          Najnowsze
        </v-btn>
      </v-btn-toggle>
      <template v-if="view === 'mapa'">
        <v-switch
          v-model="showClosed"
          label="Zamknięte"
          density="compact"
          hide-details
          color="ink-sage"
          class="flex-0-0"
        />
        <v-switch
          v-model="onlyJoined"
          label="Tylko powiązane"
          density="compact"
          hide-details
          color="ink-sage"
          class="flex-0-0"
        />
      </template>
    </div>

    <!-- The lists. Kept to a readable width: a line longer than this is only
         emptier, while the map uses all of the screen it gets. -->
    <div v-if="view === 'lista'" class="tasks-page__lists">
      <template v-for="section in shownSections" :key="section.key">
        <template v-if="section.count > 0">
          <AdminSectionHead
            :title="taskSectionConfig[section.key].title"
            :count="section.count"
            :info="taskSectionConfig[section.key].info"
            :data-section="section.key"
          >
            <v-btn
              v-if="section.key === 'closed'"
              variant="text"
              size="small"
              :prepend-icon="showClosedList ? mdiChevronUp : mdiChevronDown"
              data-toggle-closed
              @click="showClosedList = !showClosedList"
            >
              {{
                showClosedList
                  ? "Ukryj zamknięte"
                  : `Pokaż zamknięte (${section.count})`
              }}
            </v-btn>
          </AdminSectionHead>
          <AdminRowList v-if="section.items.length > 0" class="mb-4">
            <TasksRow
              v-for="task in section.items"
              :key="task.id"
              :task="task"
              :state="states.get(task.id)!"
              :section="section.key"
              :tasks="tasks"
              :saving="saving[task.id]"
              :highlighted="targetId === task.id"
              :when="order === 'najnowsze' ? rowWhen(task) : undefined"
              :expanded="openRows.has(task.id)"
              @update:expanded="(open) => setOpen(task.id, open)"
              @update="(patch) => update(task.id, patch)"
              @edit="openDialog(task)"
              @select="goTo"
              @show-goal="showGoal"
              @connect="(a, b) => connect(a, b)"
              @disconnect="(a, b) => disconnect(a, b)"
            />
          </AdminRowList>
        </template>
      </template>
      <p
        v-if="!pending && tasks.length > 0 && shownCount === 0"
        class="text-body-2 text-medium-emphasis my-4"
      >
        Nic nie pasuje do tych filtrów.
      </p>
    </div>

    <div v-else class="tasks-page__map">
      <div class="tasks-page__canvas">
        <TasksMap
          :tasks="mapTasks.tasks"
          :faded="mapTasks.faded"
          :all="tasks"
          :states="states"
          :selected="selectedId"
          @select="select"
          @connect="
            (prerequisite, dependent) => connect(prerequisite, dependent)
          "
          @disconnect="
            (prerequisite, dependent) => disconnect(prerequisite, dependent)
          "
        />
        <div class="tasks-page__legend text-caption">
          <span
            v-for="key in LEGEND"
            :key="key"
            class="tasks-page__legend-item"
          >
            <span
              class="tasks-page__swatch"
              :style="{
                background: `rgb(var(--v-theme-ink-${taskSectionConfig[key].tone}))`,
              }"
            />
            {{ taskSectionConfig[key].short }}
          </span>
          <span class="tasks-page__legend-hint">
            Strzałka prowadzi od tego, co najpierw, do tego, co czeka.
            Przeciągnij od prawej krawędzi jednego zadania do lewej drugiego
            (albo stuknij w jedną, potem w drugą), żeby je połączyć; stuknij w
            strzałkę, żeby ją usunąć. Przycisk w rogu karty zwija w stos
            wszystko, co prowadzi tylko do niej. Cele i stosy są też na pasku
            nad mapą - strzałkę można upuścić tam.
          </span>
        </div>
      </div>
      <aside class="tasks-page__panel" data-task-panel>
        <template v-if="selectedTask">
          <div class="d-flex align-start ga-2 mb-2">
            <h2 class="text-subtitle-1 font-weight-bold flex-1-1">
              {{ selectedTask.title }}
            </h2>
            <v-btn
              icon
              size="small"
              variant="text"
              aria-label="Zamknij"
              @click="select(null)"
            >
              <v-icon :icon="mdiClose" />
            </v-btn>
          </div>
          <!-- Keyed, so a note half typed for one task is not left in the
               field when another is picked. -->
          <TasksDetails
            :key="selectedTask.id"
            :task="selectedTask"
            :state="states.get(selectedTask.id)!"
            :tasks="tasks"
            :saving="saving[selectedTask.id]"
            @update="(patch) => update(selectedTask!.id, patch)"
            @edit="openDialog(selectedTask)"
            @select="select"
            @show-goal="showGoal(selectedTask!.id)"
            @connect="(a, b) => connect(a, b)"
            @disconnect="(a, b) => disconnect(a, b)"
          />
        </template>
        <p v-else class="text-body-2 text-medium-emphasis">
          Kliknij zadanie na mapie, żeby zobaczyć szczegóły, zamknąć je albo
          wskazać, na co czeka.
        </p>
      </aside>
    </div>

    <v-alert
      v-if="!pending && !loadError && tasks.length === 0"
      type="info"
      variant="tonal"
    >
      Nie ma jeszcze żadnych zadań. Dodaj pierwsze albo poproś agenta, żeby
      zapisał swoje (narzędzie <code>task_add</code>).
    </v-alert>

    <TasksDialog
      v-model="dialogOpen"
      :task="editing"
      :tasks="tasks"
      :submit="submitDialog"
    />

    <v-snackbar v-model="snackbar" :timeout="6000" color="error">
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import {
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiFormatListBulleted,
  mdiMagnify,
  mdiPlus,
  mdiSitemapOutline,
  mdiSortClockAscendingOutline,
  mdiSortClockDescendingOutline,
} from "@mdi/js";
import { useOpsTasks } from "~/composables/opsTasks";
import { useQueryFilters } from "~/composables/queryFilters";
import {
  taskChoices,
  taskKindConfig,
  taskSectionConfig,
} from "~/utils/taskStyle";
import {
  compareNewest,
  foldWords,
  isClosed,
  taskAncestors,
  taskAnchor,
  type Task,
  type TaskCreate,
  type TaskPatch,
  type TaskSection,
} from "~~/shared/tasks";

definePageMeta({
  // `admin` as well, though every owner is one: it is what lights the Admin
  // menu while the page is open.
  middleware: ["admin", "owner"],
  // The map takes the whole width it is given; the lists narrow themselves.
  fullWidth: true,
});

useHead({ title: "Zadania (Admin) - koryta.pl" });

const route = useRoute();
const router = useRouter();

const {
  tasks,
  byId,
  states,
  sections,
  pending,
  loadError,
  saving,
  snackbar,
  snackbarText,
  load,
  create,
  update,
  connect,
  disconnect,
} = useOpsTasks();

const { choiceFilter, stringFilter } = useQueryFilters();
type View = "lista" | "mapa";
const viewParam = choiceFilter<View>("widok", "lista");
const view = computed<View>({
  get: () => (viewParam.value === "mapa" ? "mapa" : "lista"),
  set: (value) => (viewParam.value = value),
});
type Who = "wszyscy" | "ty" | "agent";
const whoParam = choiceFilter<Who>("kto", "wszyscy");
const who = computed<Who>({
  get: () =>
    ["ty", "agent"].includes(whoParam.value) ? whoParam.value : "wszyscy",
  set: (value) => (whoParam.value = value),
});
const tag = stringFilter("tag");
const goal = stringFilter("cel");
type Order = "najstarsze" | "najnowsze";
const orderParam = choiceFilter<Order>("kolejnosc", "najstarsze");
const order = computed<Order>({
  get: () => (orderParam.value === "najnowsze" ? "najnowsze" : "najstarsze"),
  set: (value) => (orderParam.value = value),
});
/** Typed, so kept out of the url: a history entry per keystroke is noise. */
const search = ref<string | null>("");

const allTags = computed(() =>
  [...new Set(tasks.value.flatMap((t) => t.tags))].sort(),
);

/** The goals to filter by: open ones first, then the rest, which a link to a
 * closed goal still needs to find. */
const goals = computed(() =>
  taskChoices(tasks.value.filter((t) => t.kind === "goal")),
);

/** The goal the filter picked, and everything that leads to it. */
const goalGroup = computed(() =>
  goal.value
    ? new Set([goal.value, ...taskAncestors(tasks.value, goal.value)])
    : null,
);

const matches = (task: Task) => {
  if (goalGroup.value && !goalGroup.value.has(task.id)) return false;
  if (who.value === "ty" && task.who !== "owner") return false;
  if (who.value === "agent" && task.who !== "agent") return false;
  if (tag.value && !task.tags.includes(tag.value)) return false;
  const words = foldWords(search.value ?? "");
  if (words.length === 0) return true;
  const haystack = foldWords(
    [task.id, task.title, task.body, ...task.branches, ...task.tags].join(" "),
  ).join(" ");
  return words.every((word) => haystack.includes(word));
};

const filtering = computed(
  () =>
    who.value !== "wszyscy" ||
    !!tag.value ||
    !!goal.value ||
    !!search.value?.trim(),
);

/** Only what leads to `id`, from a goal's own "Pokaż jego zadania". */
const showGoal = (id: string) => {
  goal.value = id;
  window.scrollTo({ top: 0, behavior: "smooth" });
};

const showClosedList = ref(false);
const SECTION_ORDER: TaskSection[] = [
  "goals",
  "mine",
  "agents",
  "blocked",
  "ideas",
  "parked",
  "closed",
];
const shownSections = computed(() =>
  SECTION_ORDER.map((key) => {
    const items = sections.value[key].filter(matches);
    // The closed list is newest first either way: by when it was closed.
    if (order.value === "najnowsze" && key !== "closed") {
      items.sort(compareNewest);
    }
    return {
      key,
      count: items.length,
      items: key === "closed" && !showClosedList.value ? [] : items,
    };
  }),
);
const shownCount = computed(() =>
  shownSections.value.reduce((sum, s) => sum + s.count, 0),
);

/** What a row sorted newest first says at its end: how long ago it was added,
 * or - on the closed list, which is sorted by that - closed. */
const rowWhen = (task: Task) =>
  isClosed(task)
    ? { at: task.closedAt ?? task.updatedAt, label: "Zamknięte" }
    : { at: task.createdAt, label: "Dodane" };

// ---- the map ----

const LEGEND: TaskSection[] = [
  "goals",
  "mine",
  "agents",
  "blocked",
  "ideas",
  "parked",
];
const showClosed = ref(false);
const onlyJoined = ref(false);

/** What the map draws: the tasks the filters keep, plus - faded - the ones
 * they are joined to, so that a chain cut by a filter still reads as one. */
const mapTasks = computed(() => {
  const visible = (task: Task) => showClosed.value || !isClosed(task);
  const kept = tasks.value.filter((t) => visible(t) && matches(t));
  const keptIds = new Set(kept.map((t) => t.id));
  const faded = new Set<string>();
  if (filtering.value) {
    for (const task of kept) {
      const state = states.value.get(task.id)!;
      for (const other of [
        ...task.dependsOn.flatMap((id) => byId.value.get(id) ?? []),
        ...state.dependents,
      ]) {
        if (!keptIds.has(other.id) && visible(other)) faded.add(other.id);
      }
    }
  }
  let shown = [...kept, ...tasks.value.filter((t) => faded.has(t.id))];
  if (onlyJoined.value) {
    const ids = new Set(shown.map((t) => t.id));
    const joined = new Set(
      shown.flatMap((t) =>
        t.dependsOn.filter((d) => ids.has(d)).flatMap((d) => [d, t.id]),
      ),
    );
    shown = shown.filter((t) => joined.has(t.id));
  }
  return { tasks: shown, faded };
});

const selectedId = ref<string | null>(null);
const selectedTask = computed(() =>
  selectedId.value ? (byId.value.get(selectedId.value) ?? null) : null,
);
const select = async (id: string | null) => {
  selectedId.value = id;
  // On a phone the details are under the map, out of sight: go to them.
  if (id && window.matchMedia("(max-width: 959.98px)").matches) {
    await nextTick();
    document
      .querySelector("[data-task-panel]")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  // Kept in the url, so the task can be linked and the back button works.
  void router.replace({
    query: route.query,
    hash: id ? `#${taskAnchor(id)}` : "",
  });
};

// ---- rows, links and the dialog ----

const openRows = reactive(new Set<string>());
const setOpen = (id: string, open: boolean) =>
  open ? openRows.add(id) : openRows.delete(id);

/** The task a `#t-<id>` hash names, if it does. */
const hashTarget = () => /^#t-(.+)$/.exec(route.hash)?.[1] ?? null;
const targetId = computed(hashTarget);
const missingTarget = ref(false);

/** Bring the task a link points at into view: opened on the list, picked on
 * the map. A filter hiding it is cleared first. */
async function focusTarget() {
  const id = hashTarget();
  missingTarget.value = false;
  if (!id) return;
  const task = byId.value.get(id);
  if (!task) {
    missingTarget.value = !pending.value && !loadError.value;
    return;
  }
  if (view.value === "mapa" && isClosed(task)) showClosed.value = true;
  // A task already on screen - one of the map's faded neighbours, say - is
  // shown where it is; only one the filters hide clears them.
  const onScreen =
    view.value === "mapa"
      ? mapTasks.value.tasks.some((t) => t.id === id)
      : matches(task);
  if (!onScreen) {
    search.value = "";
    // The view and the order stay: neither hides anything.
    await router.replace({
      query: { widok: route.query.widok, kolejnosc: route.query.kolejnosc },
      hash: route.hash,
    });
  }
  if (view.value === "mapa") {
    selectedId.value = id;
    return;
  }
  if (isClosed(task)) showClosedList.value = true;
  openRows.add(id);
  await nextTick();
  document
    .getElementById(taskAnchor(id))
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}

const goTo = (id: string) =>
  router.replace({ query: route.query, hash: `#${taskAnchor(id)}` });

watch(() => route.hash, focusTarget);

const dialogOpen = ref(false);
const editing = ref<Task | null>(null);
const openDialog = (task: Task | null) => {
  editing.value = task;
  dialogOpen.value = true;
};

async function submitDialog(value: TaskCreate | TaskPatch): Promise<boolean> {
  if (editing.value) return update(editing.value.id, value as TaskPatch);
  const task = await create(value as TaskCreate);
  if (task) void goTo(task.id);
  return !!task;
}

onMounted(async () => {
  await load();
  await focusTarget();
});
</script>

<style scoped>
.tasks-page__head,
.tasks-page__filters,
.tasks-page__lists {
  max-width: 1100px;
}

/* Gives way before the view switch and "Dodaj" do, so they stay on the
 * title's line wherever there is room for both. */
.tasks-page__intro {
  flex: 1 1 0;
  min-width: 260px;
}

.tasks-page__search {
  flex: 1 1 220px;
  max-width: 360px;
}

.tasks-page__tag {
  flex: 0 1 180px;
}

.tasks-page__goal {
  flex: 0 1 240px;
}

.tasks-page__map {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 16px;
  align-items: start;
}

.tasks-page__panel {
  position: sticky;
  top: 80px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  padding: 16px;
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
}

/* The panel scrolls on its own; what can be done with the task stays at its
 * bottom edge, however long the task is. */
.tasks-page__panel :deep(.task-details__footer) {
  position: sticky;
  bottom: 0;
  /* Over the panel's own padding, so nothing scrolls by under it. */
  margin-bottom: -16px;
  padding-bottom: 16px;
  background: rgb(var(--v-theme-surface));
}

.tasks-page__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  margin-top: 8px;
}

.tasks-page__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tasks-page__swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.tasks-page__legend-hint {
  flex: 1 1 100%;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

/* On a phone the panel goes under the map, which keeps the screen's width. */
@media (max-width: 959.98px) {
  .tasks-page__map {
    grid-template-columns: minmax(0, 1fr);
  }

  .tasks-page__panel {
    position: static;
    max-height: none;
  }

  .tasks-page__panel :deep(.task-details__footer) {
    position: static;
  }
}
</style>
