import {
  mdiAccountOutline,
  mdiFlagCheckered,
  mdiLightbulbOutline,
  mdiRobotOutline,
  mdiRocketLaunchOutline,
  mdiScaleBalance,
  mdiWrenchOutline,
} from "@mdi/js";
import type { RowTone } from "~/composables/rowTone";
import {
  isClosed,
  type PriorityChoice,
  type Task,
  type TaskKind,
  type TaskPriority,
  type TaskSection,
  type TaskState,
  type TaskStatus,
  type TaskWho,
} from "~~/shared/tasks";

/** How /admin/zadania names and draws the kinds, lists and statuses of
 * `shared/tasks.ts`. The list rows and the map's cards read the same table, so
 * a task has one colour and one icon wherever it is shown. */

export const taskKindConfig: Record<TaskKind, { title: string; icon: string }> =
  {
    action: { title: "Operacja", icon: mdiRocketLaunchOutline },
    task: { title: "Zadanie", icon: mdiWrenchOutline },
    decision: { title: "Decyzja", icon: mdiScaleBalance },
    idea: { title: "Pomysł", icon: mdiLightbulbOutline },
    goal: { title: "Cel", icon: mdiFlagCheckered },
  };

export const taskWhoConfig: Record<TaskWho, { title: string; icon: string }> = {
  owner: { title: "Ty", icon: mdiAccountOutline },
  agent: { title: "Agent", icon: mdiRobotOutline },
};

export const taskStatusConfig: Record<TaskStatus, { title: string }> = {
  open: { title: "Otwarte" },
  doing: { title: "W toku" },
  parked: { title: "Odłożone" },
  done: { title: "Zrobione" },
  dropped: { title: "Porzucone" },
};

/** The levels as the page offers them, from the lowest. `taken` is the word
 * on a task that holds up one with that level, `goal` on one that leads to a
 * goal with it. */
export const taskPriorityConfig: Record<
  PriorityChoice,
  { title: string; taken: string; goal: string }
> = {
  normal: { title: "Zwykłe", taken: "", goal: "" },
  high: {
    title: "Ważne",
    taken: "blokuje ważne",
    goal: "do ważnego celu",
  },
  urgent: {
    title: "Pilne",
    taken: "blokuje pilne",
    goal: "do pilnego celu",
  },
};

/** Lowest first, as the toggles offer them. */
export const taskPriorityOrder: PriorityChoice[] = ["normal", "high", "urgent"];

export type TaskPriorityBadge = {
  level: TaskPriority;
  /** Taken from what the task holds up, rather than its own. */
  taken: boolean;
  /** On a line with room: „Pilne”, „blokuje pilne”, „do pilnego celu”. */
  text: string;
  /** Where there is none: the level alone. */
  short: string;
  /** Who set it, or what it is taken from. */
  title: string;
};

/** What a task's priority says on a row or a card, or null for normal. */
export function taskPriorityBadge(
  task: Task,
  state: Pick<TaskState, "priority" | "priorityFrom">,
): TaskPriorityBadge | null {
  const level = state.priority;
  if (!level) return null;
  const config = taskPriorityConfig[level];
  const from = state.priorityFrom;
  if (from.length === 0) {
    return {
      level,
      taken: false,
      text: config.title,
      short: config.title,
      title: `${config.title} · ${taskActorLabel(task.prioritySetBy ?? "agent")}`,
    };
  }
  const named = from.map((t) =>
    t.kind === "goal" ? `cel „${t.title}”` : `„${t.title}”`,
  );
  // „zadanie” is neuter and „cel” masculine: na nie, na niego.
  const it = task.kind === "goal" ? "niego" : "nie";
  return {
    level,
    taken: true,
    text: from.every((t) => t.kind === "goal") ? config.goal : config.taken,
    short: config.title,
    title: `${config.title}, bo czeka na ${it}: ${named.join(", ")}`,
  };
}

/** One tone per list: what waits on the owner stands out, what waits on an
 * agent is calmer, and what cannot start yet is grey. Goals are the one dark
 * thing on the page: where everything else leads. */
export const taskSectionConfig: Record<
  TaskSection,
  { title: string; short: string; tone: RowTone; info: string }
> = {
  goals: {
    title: "Cele",
    short: "Cel",
    tone: "strong",
    info: "Dokąd prowadzą zadania. Cel czeka na zadania, które do niego prowadzą - tak się je grupuje - a filtr „Cel” pokazuje tylko je. Pilny albo ważny cel podnosi wszystkie te zadania.",
  },
  mine: {
    title: "Do zrobienia przez Ciebie",
    short: "Dla Ciebie",
    tone: "warning",
    info: "Nic na nie nie czeka, a potrzebują Twoich uprawnień albo decyzji. Od góry: pilne, ważne, potem od najstarszych. Zadanie, na które czeka pilne albo ważne zadanie lub cel, jest pilne albo ważne razem z nim.",
  },
  agents: {
    title: "Dla agenta",
    short: "Dla agenta",
    tone: "info",
    info: "Nic na nie nie czeka i agent zrobi je sam - wystarczy zlecić. Od góry: pilne, ważne, potem od najstarszych.",
  },
  blocked: {
    title: "Czekają",
    short: "Czeka",
    tone: "neutral",
    info: "Czekają na inne zadanie. Przejdą wyżej same, gdy tamto zostanie zamknięte.",
  },
  ideas: {
    title: "Pomysły",
    short: "Pomysł",
    tone: "sage",
    info: "Warte zrobienia kiedyś - nikt się jeszcze do nich nie zobowiązał.",
  },
  parked: {
    title: "Odłożone",
    short: "Odłożone",
    tone: "neutral",
    info: "Odłożone celowo. Nie zaczynaj ich bez decyzji.",
  },
  closed: {
    title: "Zamknięte",
    short: "Zamknięte",
    tone: "success",
    info: "Zrobione albo porzucone.",
  },
};

/** Tasks to pick from in a field, as its items. Closed ones stay pickable -
 * a dependency on something done is a record of the order things happened
 * in - but after the open ones. */
export const taskChoices = (tasks: readonly Task[]) =>
  [...tasks]
    .sort((a, b) => Number(isClosed(a)) - Number(isClosed(b)))
    .map((t) => ({ id: t.id, title: t.title }));

export const formatTaskDate = (iso: string) =>
  new Date(iso).toLocaleString("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  });

/** Who made a change, in words: `agent:<workspace>` keeps the workspace, which
 * is named after the session. */
export const taskActorLabel = (by: string) =>
  by === "owner"
    ? "Ty"
    : by.startsWith("agent:")
      ? `agent (${by.slice(6)})`
      : "agent";

/** Pieces of a task's text, with web links picked out so they can be
 * rendered as links and nothing else as HTML. */
export function linkify(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(
    /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g,
  )) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[0], href: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
