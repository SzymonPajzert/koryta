import { computed, ref, shallowRef, watch } from "vue";
import { useAuthState } from "~/composables/auth";
import { useOpsTasks } from "~/composables/opsTasks";
import {
  reportTaskDraft,
  reportUrl,
  tasksByReport,
} from "~~/shared/reportTasks";
import {
  similarTasks,
  taskSection,
  type Task,
  type TaskCreate,
  type TaskEdit,
  type TaskPatch,
  type TaskSection,
} from "~~/shared/tasks";
import type { Feedback } from "~~/shared/model";

/** A task on the owner's list that names a report, with the list it is on
 * there - which is what colours it. */
export type ReportTask = { task: Task; section: TaskSection };

/** The owner's task list (/admin/zadania) as /admin/opinie sees it: which
 * tasks each report has, and a report made into a task - see
 * `shared/reportTasks.ts` for how the two are tied.
 *
 * The list is the owner's alone (`/api/ops/tasks/*` answers nobody else), so
 * for any other admin this reads nothing and offers nothing. For the owner it
 * offers nothing either until the list is in: before then a report cannot be
 * told apart from one with no task yet. The writes are the task list's own
 * (`useOpsTasks`), so a task made here is checked, numbered and refused
 * exactly as one added on /admin/zadania. */
export function useReportTasks() {
  const { isOwner } = useAuthState();
  const {
    tasks,
    states,
    pending,
    loadError,
    load,
    create,
    update,
    snackbar,
    snackbarText,
  } = useOpsTasks();

  watch(
    isOwner,
    (owner) => {
      if (owner) void load();
    },
    { immediate: true },
  );

  /** Whether the list is in, for the owner. */
  const ready = computed(
    () => isOwner.value === true && !pending.value && !loadError.value,
  );

  /** For each report the list names, its tasks. */
  const byReport = computed(() => {
    const found = new Map<string, ReportTask[]>();
    for (const [reportId, list] of tasksByReport(tasks.value)) {
      found.set(
        reportId,
        list.map((task) => ({
          task,
          section: taskSection(task, states.value.get(task.id)!),
        })),
      );
    }
    return found;
  });

  /** The report the dialog is making a task of. Shallow: it is only read. */
  const reportFor = shallowRef<Feedback | null>(null);
  const dialogOpen = ref(false);

  /** What the dialog starts from. Where it came from is added on the way
   * out, as the form has no field for it. */
  const draft = computed((): Partial<TaskEdit> | null => {
    if (!reportFor.value) return null;
    const { source: _source, ...fields } = reportTaskDraft(reportFor.value);
    return fields;
  });

  function open(report: Feedback) {
    reportFor.value = report;
    dialogOpen.value = true;
  }

  /** The dialog's "Dodaj". Resolves true once the task is on the list, and it
   * is shown on the report from then on: the list the rows read now has it. */
  async function submit(value: TaskCreate | TaskPatch): Promise<boolean> {
    const report = reportFor.value;
    if (!report) return false;
    const { source } = reportTaskDraft(report);
    return !!(await create({ ...(value as TaskCreate), source }));
  }

  /** Name the report on a task already on the list rather than add one that
   * says the same. A line in the task's history says when. Added to the
   * task's links as they are on the server, not as the page last read them. */
  async function attach(task: Task): Promise<boolean> {
    const report = reportFor.value;
    if (!report) return false;
    const link = reportUrl(report.id!);
    const done = await update(task.id, {
      addLinks: [link],
      note: `Podpięte zgłoszenie ${link}`,
    });
    if (done) dialogOpen.value = false;
    return done;
  }

  /** What the dialog shows beside the title as it is typed: the tasks that
   * already name the report, then the open ones that look like the same
   * thing - the duplicate check agents get from `task_add`. */
  function matches(title: string, branches: string[] = []): Task[] {
    const own = (byReport.value.get(reportFor.value?.id ?? "") ?? []).map(
      ({ task }) => task,
    );
    const alike = title.trim()
      ? similarTasks(tasks.value, { title, branches })
      : [];
    return [...own, ...alike.filter((task) => !own.includes(task))];
  }

  return {
    tasks,
    ready,
    loadError,
    byReport,
    reportFor,
    dialogOpen,
    draft,
    open,
    submit,
    attach,
    matches,
    snackbar,
    snackbarText,
  };
}
