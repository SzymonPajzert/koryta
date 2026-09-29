/** A report from /admin/opinie as a task on the owner's list (/admin/zadania),
 * and the way back: which tasks name a report.
 *
 * The task keeps the report where the list has always kept the reports a
 * task answers - its link, `https://koryta.pl/admin/opinie#fb-<id>`, in
 * `links` - and in a `Zgłoszenie:` line of its text, both of which „Kopiuj
 * dla czatu” reads too (`taskReports`). Nothing is written on the report: the
 * tasks it has are read off the list, so a report never says anything the
 * list does not, a task an agent filed with the link shows on it as well as
 * one made from it, and the report goes on being triaged on its own - its
 * status and its place in the queue are its own.
 */
import type { Feedback } from "./model";
import { reporterLabels, reporterOf } from "./reporters";
import { isClosed, type Task, type TaskEdit } from "./tasks";

const SITE = "https://koryta.pl";

/** Where a report is, the way the task list and the agents name it. */
export const reportUrl = (reportId: string, origin = SITE) =>
  `${origin}/admin/opinie#fb-${reportId}`;

const REPORT_LINK = /#fb-([A-Za-z0-9]+)/;

/** The reports a task is for: those in its links, and the one its text names
 * on a `Zgłoszenie:` line. Not every `#fb-` in the text - a report quoted in
 * the message, or the page it was written on (itself a report on
 * /admin/opinie, often), is not one the task was made for. */
export function reportsOf(task: Pick<Task, "body" | "links">): string[] {
  const ids = [
    ...task.links,
    ...task.body.split("\n").filter((line) => line.startsWith("Zgłoszenie:")),
  ].flatMap((text) => REPORT_LINK.exec(text)?.[1] ?? []);
  return [...new Set(ids)];
}

/** Every report the tasks name, with the tasks that name it: the open ones
 * first, then the rest, newest first within each. */
export function tasksByReport(tasks: readonly Task[]): Map<string, Task[]> {
  const found = new Map<string, Task[]>();
  for (const task of tasks) {
    for (const reportId of reportsOf(task)) {
      const list = found.get(reportId);
      if (list) list.push(task);
      else found.set(reportId, [task]);
    }
  }
  for (const list of found.values()) {
    list.sort(
      (a, b) =>
        Number(isClosed(a)) - Number(isClosed(b)) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  }
  return found;
}

/** A title is read on a one-line row: past this it is only cut off there. */
const TITLE_MAX = 120;

/** Words a full stop follows without ending a sentence. */
const ABBREVIATIONS = new Set(
  (
    "np m.in ul al pl tzw tj ok wg św im dr prof gen hab inż mgr nr godz r " +
    "ww jw itd itp etc cdn zob por tel ds sp o.o s.a"
  ).split(" "),
);

/** Where the first sentence of `line` ends. A question or exclamation mark
 * ends it whatever follows; a full stop only before a capital or the end
 * ("z 66. -> dlaczego" goes on), and not after an abbreviation ("np. PKP"). */
function sentenceEnd(line: string): number {
  for (let i = 0; i < line.length; i++) {
    const rest = line.slice(i + 1);
    if (rest !== "" && !/^\s/.test(rest)) continue;
    const char = line[i]!;
    if ("?!…".includes(char)) return i + 1;
    if (char !== ".") continue;
    if (!/^\s*$|^\s+[\p{Lu}„"(]/u.test(rest)) continue;
    const word = /(\S+)$/.exec(line.slice(0, i))?.[1]?.toLowerCase() ?? "";
    if (ABBREVIATIONS.has(word)) continue;
    return i + 1;
  }
  return line.length;
}

/** The report's first sentence, as far as it fits a title - or its first
 * words, cut at a word. A title has no full stop, as none on the list has,
 * and a list's first marker is not its first word. */
export function reportTaskTitle(message: string, fallback: string): string {
  const line = message
    .trim()
    .split("\n")[0]!
    .trim()
    .replace(/^(?:\d+[.)]|[-*•])\s+/, "");
  if (!line) return fallback;
  const sentence = line
    .slice(0, sentenceEnd(line))
    .replace(/(?<!\.)[.:;,]$/, "");
  if (sentence.length <= TITLE_MAX) return sentence;
  const cut = sentence.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  const words = space > TITLE_MAX / 2 ? cut.slice(0, space) : cut;
  return `${words.replace(/[\s,;:-]+$/, "")}…`;
}

/** What a new task made from a report starts as, before the owner changes
 * any of it in the dialog: an idea stays an idea, anything else is work to
 * do, for the owner, with the whole report in its text - where it came from,
 * who wrote it, where it was written and what the team noted on it - and its
 * link. Who wrote it, because an agent takes what is on the owner's list for
 * the owner's own words. */
export function reportTaskDraft(
  report: Feedback,
  origin = SITE,
): Pick<TaskEdit, "title" | "body" | "kind" | "who" | "tags" | "links"> & {
  source: string;
} {
  const id = report.id!;
  const link = reportUrl(id, origin);
  const reporter = reporterOf(report.userUid);
  const lines = [
    report.message.trim(),
    "",
    `Zgłoszenie: ${link}`,
    `Zgłaszający: ${reporterLabels[reporter]} (${reporter})`,
  ];
  const qa = report.context.qa;
  if (qa) {
    lines.push(`Wpis QA: „${qa.title}” ${origin}/qa#qa-${qa.itemId}`);
  } else if (/^\/(?!\/)/.test(report.context.route)) {
    // Only a path on the site: the route is whatever the reporter's browser
    // sent. Without its hash, which on /admin/opinie names another report.
    lines.push(`Strona: ${origin}${report.context.route.split("#")[0]}`);
  }
  if (report.adminNote?.trim()) {
    lines.push(`Notatka: ${report.adminNote.trim()}`);
  }
  return {
    title: reportTaskTitle(report.message, `Zgłoszenie ${id}`),
    body: lines.join("\n"),
    kind: report.kind === "idea" ? "idea" : "task",
    who: "owner",
    tags: ["opinie"],
    links: [link],
    source: `zgłoszenie ${id}`,
  };
}
