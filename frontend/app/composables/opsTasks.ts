import { computed, ref } from "vue";
import { authRequest } from "~/composables/auth";
import {
  compareTasks,
  dependencyProblem,
  taskSection,
  taskStates,
  type Task,
  type TaskCreate,
  type TaskPatch,
  type TaskSection,
} from "~~/shared/tasks";

/** What the server said went wrong, in its own words where it gave some. */
function reason(error: unknown): string {
  const data = (error as { data?: { message?: string } } | null)?.data;
  if (data?.message) return data.message;
  return error instanceof Error ? error.message : String(error);
}

/** The owner's task list for /admin/zadania: the tasks, what each waits on,
 * the page's lists, and the writes. Every write shows what the server wrote
 * back rather than what was asked for, so a refused dependency (a loop, say)
 * never shows as drawn. */
export function useOpsTasks() {
  const tasks = ref<Task[]>([]);
  const pending = ref(true);
  const loadError = ref("");
  const saving = ref<Record<string, boolean>>({});
  const snackbar = ref(false);
  const snackbarText = ref("");

  const fail = (message: string) => {
    snackbarText.value = message;
    snackbar.value = true;
  };

  const states = computed(() => taskStates(tasks.value));
  const byId = computed(() => new Map(tasks.value.map((t) => [t.id, t])));

  const sections = computed(() => {
    const lists: Record<TaskSection, Task[]> = {
      goals: [],
      mine: [],
      agents: [],
      blocked: [],
      ideas: [],
      parked: [],
      closed: [],
    };
    for (const task of [...tasks.value].sort(compareTasks)) {
      lists[taskSection(task, states.value.get(task.id)!)].push(task);
    }
    // Closed ones newest first: they are history, read from the latest.
    lists.closed.sort((a, b) =>
      (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt),
    );
    return lists;
  });

  async function load() {
    pending.value = true;
    loadError.value = "";
    try {
      const answer = await authRequest<{ tasks: Task[] }>(
        "/api/ops/tasks/list",
        { method: "GET" },
      );
      tasks.value = answer.tasks;
    } catch (error) {
      loadError.value = `Nie udało się wczytać zadań: ${reason(error)}`;
    } finally {
      pending.value = false;
    }
  }

  const put = (task: Task) => {
    const index = tasks.value.findIndex((t) => t.id === task.id);
    if (index >= 0) tasks.value.splice(index, 1, task);
    else tasks.value.push(task);
  };

  async function create(input: TaskCreate): Promise<Task | null> {
    try {
      const { task } = await authRequest<{ task: Task }>(
        "/api/ops/tasks/create",
        { method: "POST", body: input },
      );
      put(task);
      return task;
    } catch (error) {
      fail(reason(error));
      return null;
    }
  }

  async function update(id: string, patch: TaskPatch): Promise<boolean> {
    saving.value = { ...saving.value, [id]: true };
    try {
      const { task } = await authRequest<{ task: Task }>(
        "/api/ops/tasks/update",
        { method: "POST", body: { id, patch } },
      );
      put(task);
      return true;
    } catch (error) {
      fail(reason(error));
      return false;
    } finally {
      saving.value = { ...saving.value, [id]: false };
    }
  }

  /** `dependent` waits on `prerequisite` from now on. Refused here already
   * when the page can tell - a loop, the task itself - so the map does not
   * draw an arrow for a moment and take it back. */
  function connect(prerequisite: string, dependent: string) {
    const task = byId.value.get(dependent);
    if (!task || task.dependsOn.includes(prerequisite)) return;
    const problem = dependencyProblem(
      tasks.value,
      dependent,
      [...task.dependsOn, prerequisite],
      task.dependsOn,
    );
    if (problem) {
      fail(problem);
      return;
    }
    return update(dependent, { addDependsOn: [prerequisite] });
  }

  const disconnect = (prerequisite: string, dependent: string) =>
    update(dependent, { removeDependsOn: [prerequisite] });

  return {
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
  };
}

export type OpsTasks = ReturnType<typeof useOpsTasks>;
