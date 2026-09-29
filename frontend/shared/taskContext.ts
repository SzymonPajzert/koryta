/** A task from /admin/zadania as text to paste into a chat with an agent:
 * everything the task says, and every lead to where it came from - the memory
 * note it was harvested from, the sessions that added it and wrote its
 * history, the reports it answers - so that a new session can pick it up
 * without asking. In English, like the rest of what agents read.
 */
import { taskStates, taskUrl, type Task, type TaskState } from "./tasks";

/** `2026-09-28 14:05 UTC`: to the minute, and in one zone whoever reads it. */
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)+";

/** Memory notes a task names: `memory:<name>` in its source (what the import
 * from the notes writes), "memory <name>" or `[[<name>]]` in its text, or a
 * path to `memory/<name>.md`. */
export function memoryNotes(task: Pick<Task, "source" | "body" | "links">) {
  const text = [task.source ?? "", task.body, ...task.links].join("\n");
  const found = [
    ...text.matchAll(new RegExp(`\\bmemory[: ]+(${SLUG})`, "gi")),
    ...text.matchAll(new RegExp(`\\[\\[(${SLUG})\\]\\]`, "g")),
    ...text.matchAll(new RegExp(`memory/(${SLUG})\\.md`, "g")),
  ].map((match) => match[1]!.toLowerCase());
  return [...new Set(found)];
}

/** A Claude Code session's id, from the name an agent signs its changes
 * with: the workspace directory, `bridge-cse_<id>`, which is the claude.ai
 * session `session_<id>`. Null for a name that is no session (`import`). */
export function sessionId(label: string): string | null {
  return /^(?:bridge-)?cse_([A-Za-z0-9]+)$/.exec(label)?.[1] ?? null;
}

/** The sessions that had a hand in a task, oldest first, and what each did. */
export function taskSessions(
  task: Pick<Task, "createdBy" | "source" | "log">,
): { label: string; id: string; role: string }[] {
  const roles = new Map<string, string[]>();
  const add = (label: string, role: string) => {
    if (!sessionId(label)) return;
    const seen = roles.get(label) ?? [];
    if (!seen.includes(role)) seen.push(role);
    roles.set(label, seen);
  };
  if (task.createdBy.startsWith("agent:")) {
    add(task.createdBy.slice(6), "added it");
  }
  const fromSource = /^session (\S+)/.exec(task.source ?? "")?.[1];
  if (fromSource) add(fromSource, "added it");
  for (const entry of task.log) {
    if (entry.by.startsWith("agent:")) {
      add(entry.by.slice(6), "wrote its history");
    }
  }
  return [...roles].map(([label, done]) => ({
    label,
    id: `session_${sessionId(label)}`,
    role: done.join(", "),
  }));
}

/** Report ids a task points at, as `feedback_get` takes them. */
export function taskReports(task: Pick<Task, "body" | "links">): string[] {
  const text = [task.body, ...task.links].join("\n");
  return [
    ...new Set([...text.matchAll(/#fb-([A-Za-z0-9]+)/g)].map((m) => m[1]!)),
  ];
}

/** The goals a task leads to, through whatever waits on it. */
function goalsOf(task: Task, states: Map<string, TaskState>): Task[] {
  const goals: Task[] = [];
  const seen = new Set([task.id]);
  const queue = [...states.get(task.id)!.dependents];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    if (next.kind === "goal") goals.push(next);
    queue.push(...(states.get(next.id)?.dependents ?? []));
  }
  return goals;
}

const READINESS: Record<TaskState["readiness"], string> = {
  ready: "ready - nothing it waits on is open",
  blocked: "blocked",
  parked: "parked on purpose",
  closed: "closed",
};

/** The text itself. `tasks` is the whole list, for what it waits on and what
 * waits on it. */
export function taskContext(task: Task, tasks: readonly Task[]): string {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const states = taskStates(byId.has(task.id) ? tasks : [...tasks, task]);
  const state = states.get(task.id)!;
  const brief = (t: Task) => `- [${t.status}] ${t.id}: ${t.title}`;

  const readiness =
    state.readiness === "blocked"
      ? `blocked - waits on ${state.blockers.length} of ${task.dependsOn.length}`
      : READINESS[state.readiness];
  const lines: string[] = [
    `A task from the owner's list on koryta.pl: „${task.title}”`,
    taskUrl(task.id),
    `Id: ${task.id}. Read its current state with task_get and record what ` +
      "you do with task_update (the koryta MCP server).",
    "",
    `Kind: ${task.kind} · for: ${task.who === "owner" ? "the owner" : "an agent"} · ` +
      `status: ${task.status} · ${readiness}`,
    `Added ${when(task.createdAt)} by ${task.createdBy}` +
      (task.updatedAt !== task.createdAt
        ? ` · last changed ${when(task.updatedAt)}`
        : "") +
      (task.closedAt ? ` · closed ${when(task.closedAt)}` : ""),
  ];
  if (task.source) lines.push(`Source: ${task.source}`);
  const notes = memoryNotes(task);
  if (notes.length > 0) lines.push(`Memory notes: ${notes.join(", ")}`);
  const sessions = taskSessions(task);
  if (sessions.length > 0) {
    lines.push(
      "Sessions: " +
        sessions
          .map((s) => `${s.label} (${s.role}; claude.ai ${s.id})`)
          .join(", "),
    );
  }
  const reports = taskReports(task);
  if (reports.length > 0) {
    lines.push(`Reports (feedback_get): ${reports.join(", ")}`);
  }
  const goals = goalsOf(task, states);
  if (goals.length > 0) {
    lines.push(
      `Leads to goals: ${goals.map((g) => `„${g.title}” (${g.id})`).join(", ")}`,
    );
  }

  if (task.body.trim()) lines.push("", task.body.trim());

  const waitsOn = task.dependsOn.flatMap((id) => byId.get(id) ?? []);
  if (waitsOn.length > 0 || state.missing.length > 0) {
    lines.push(
      "",
      task.kind === "goal" ? "Tasks leading to it:" : "Waits on:",
      ...waitsOn.map(brief),
      ...state.missing.map((id) => `- ${id}: no such task any more`),
    );
  }
  if (state.dependents.length > 0) {
    lines.push("", "Then unblocks:", ...state.dependents.map(brief));
  }
  const refs: string[] = [];
  if (task.branches.length > 0) {
    refs.push(`Branches: ${task.branches.join(", ")}`);
  }
  if (task.links.length > 0) {
    refs.push("Links:", ...task.links.map((link) => `- ${link}`));
  }
  if (task.tags.length > 0) refs.push(`Tags: ${task.tags.join(", ")}`);
  if (refs.length > 0) lines.push("", ...refs);
  if (task.log.length > 0) {
    lines.push(
      "",
      "History, oldest first:",
      ...task.log.map((e) => `- ${when(e.at)} ${e.by}: ${e.text}`),
    );
  }
  return lines.join("\n");
}
