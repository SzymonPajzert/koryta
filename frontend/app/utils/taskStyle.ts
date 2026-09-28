import {
  mdiAccountOutline,
  mdiLightbulbOutline,
  mdiRobotOutline,
  mdiRocketLaunchOutline,
  mdiScaleBalance,
  mdiWrenchOutline,
} from "@mdi/js";
import type { RowTone } from "~/composables/rowTone";
import type {
  TaskKind,
  TaskSection,
  TaskStatus,
  TaskWho,
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

/** One tone per list: what waits on the owner stands out, what waits on an
 * agent is calmer, and what cannot start yet is grey. */
export const taskSectionConfig: Record<
  TaskSection,
  { title: string; short: string; tone: RowTone; info: string }
> = {
  mine: {
    title: "Do zrobienia przez Ciebie",
    short: "Dla Ciebie",
    tone: "warning",
    info: "Nic na nie nie czeka, a potrzebują Twoich uprawnień albo decyzji. Od góry: co najpierw.",
  },
  agents: {
    title: "Dla agenta",
    short: "Dla agenta",
    tone: "info",
    info: "Nic na nie nie czeka i agent zrobi je sam - wystarczy zlecić.",
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
