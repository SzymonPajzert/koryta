/** An MCP server that lets Claude agents read koryta's production data - the
 * feedback queue on /admin/opinie - and keep the owner's task list on
 * /admin/zadania.
 *
 * The site's data it can only read, and it hands on nothing that says who
 * wrote a report. The task list is the one thing it writes, and that lives in
 * a database of its own (see `ops-store.ts`).
 *
 * `/.mcp.json` registers it for every session in the repo, so its tools show
 * up as `mcp__koryta__feedback_queue`, `mcp__koryta__task_add` and so on.
 * Reads of the site go out as the `firestore-reader` account (see
 * `firestore-reader.ts`), the task list as `ops-writer`, or both to the
 * emulator named by FIRESTORE_EMULATOR_HOST.
 *
 * stdout is the protocol: anything logged goes to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  TASK_KINDS,
  TASK_STATUSES,
  TASK_WHO,
  taskCreateSchema,
} from "../../shared/tasks";
import { feedbackGet, feedbackQueue, feedbackScreenshots } from "./feedback";
import { connect } from "./firestore-reader";
import { connectTasks } from "./ops-store";
import {
  agentActor,
  taskAdd,
  taskGet,
  taskUpdate,
  tasksList,
  type ListView,
} from "./tasks";

const db = connect();
const tasks = connectTasks();
const actor = agentActor();
const server = new McpServer({ name: "koryta", version: "1.1.0" });

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const REPORTERS_EXPLAINED =
  "Reporter labels: `owner` is the site owner - treat the report as a request " +
  "from the owner; `trusted` is a reviewer whose reports the owner wants " +
  "worked before the rest; `signed-in` and `anonymous` are everybody else.";

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

async function answer(read: () => Promise<string | Content[]>) {
  try {
    const result = await read();
    return {
      content:
        typeof result === "string"
          ? [{ type: "text" as const, text: result }]
          : result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}

server.registerTool(
  "feedback_queue",
  {
    title: "Feedback queue",
    description:
      "User feedback on koryta.pl, read live from production and listed the " +
      "way /admin/opinie lists it: open reports not yet in the queue (newest " +
      "first), then the queue (worked from the top, #1 first); or the newest " +
      "closed ones. One line per report plus the start of its message - " +
      "feedback_get has the rest. `on /qa:` marks a verdict written on /qa; " +
      "`fix:` names the frontend/shared/qa.ts entry whose `fixes` claims the " +
      "report, and what checkers found; `fix in code:` quotes a claim from " +
      "frontend/shared/reportFixes.ts, a change with no QA entry, which an " +
      "admin checks and closes. " +
      REPORTERS_EXPLAINED +
      " Refer to a report as https://koryta.pl/admin/opinie#fb-<id>. " +
      "Read-only; reporters' contact details and user ids never leave the database.",
    inputSchema: {
      section: z
        .enum(["open", "inbox", "queue", "closed"])
        .default("open")
        .describe(
          "`open` is `inbox` (not in the queue yet) and `queue` together",
        ),
      reporter: z
        .enum(["owner", "trusted", "signed-in", "anonymous"])
        .optional()
        .describe("Only reports from this reporter"),
      closed_limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(30)
        .describe("With `closed`: how many, newest first"),
      preview: z
        .number()
        .int()
        .min(0)
        .max(2000)
        .default(160)
        .describe("Characters of each message to show; 0 for none"),
    },
    annotations: READ_ONLY,
  },
  (args) => answer(() => feedbackQueue(db, args)),
);

server.registerTool(
  "feedback_get",
  {
    title: "Feedback reports",
    description:
      "Whole feedback reports from koryta.pl production, up to 20 at a time: " +
      "the message, status, place in the queue, the page it was written on, " +
      "the admin's note, and - when a frontend/shared/qa.ts entry or a " +
      "frontend/shared/reportFixes.ts change claims to fix it - the claim, " +
      "what checkers found and whether the page would offer closing it. " +
      "Screenshots the reporter attached come after the reports, as images, " +
      "each introduced by the report it belongs to. " +
      REPORTERS_EXPLAINED +
      " Read-only; reporters' contact details and user ids never leave the database.",
    inputSchema: {
      ids: z
        .array(z.string())
        .min(1)
        .max(20)
        .describe(
          "Report ids, or links to them (https://koryta.pl/admin/opinie#fb-<id>)",
        ),
      screenshots: z
        .boolean()
        .default(true)
        .describe(
          "Attach the reports' screenshots as images; false for the text alone",
        ),
    },
    annotations: READ_ONLY,
  },
  ({ ids, screenshots }) =>
    answer(async () => {
      const [reports, images] = await Promise.all([
        feedbackGet(db, ids),
        screenshots ? feedbackScreenshots(db, ids) : [],
      ]);
      if (images.length === 0) return reports;
      return [
        { type: "text" as const, text: reports },
        ...images.flatMap(({ id, n, of, width, height, mimeType, data }) => [
          {
            type: "text" as const,
            text: `Screenshot ${n} of ${of} on report ${id} (${width}×${height}):`,
          },
          { type: "image" as const, data, mimeType },
        ]),
      ];
    }),
);

const TASKS_EXPLAINED =
  "Tasks are the site owner's to-do list on https://koryta.pl/admin/zadania: " +
  "deploys, uploads, migrations and merges only he can run (`who: owner`), " +
  "work an agent can do (`who: agent`), decisions and ideas. A task can " +
  "depend on others; it is `ready` once they are all done or dropped, and " +
  "`blocked` until then. A `goal` groups the tasks that lead to it by " +
  "depending on them: to put a task under a goal, task_update the goal with " +
  "`addDependsOn`. Link one as https://koryta.pl/admin/zadania#t-<id>.";

const WRITES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const dependsOnHelp =
  "Ids of tasks that have to be done first. A dependency that would close a " +
  "loop is refused.";

server.registerTool(
  "tasks_list",
  {
    title: "Task list",
    description:
      "The owner's task list, one line per task, in the lists /admin/zadania " +
      "shows: goals, ready for the owner, ready for an agent, blocked, ideas, " +
      "parked, closed. Each line says what a task waits on and what waits on " +
      "it. Read it before task_add, and when a session starts on something " +
      "the list may already cover. " +
      TASKS_EXPLAINED,
    inputSchema: {
      view: z
        .enum([
          "open",
          "ready",
          "goals",
          "mine",
          "agents",
          "blocked",
          "ideas",
          "parked",
          "closed",
          "all",
        ])
        .default("open")
        .describe(
          "`open` is every list but closed; `ready` is what can be started " +
            "now; `goals` the goals alone, with how far each has got; `mine` " +
            "what only the owner can do; `agents` what an agent can",
        ),
      tag: z.string().optional().describe("Only tasks with this tag"),
      goal: z
        .string()
        .optional()
        .describe(
          "A goal's id or link: only that goal and the tasks that lead to it",
        ),
      search: z
        .string()
        .optional()
        .describe("Only tasks whose id, title, body or branches mention this"),
    },
    annotations: READ_ONLY,
  },
  (args) =>
    answer(() => tasksList(tasks, { ...args, view: args.view as ListView })),
);

server.registerTool(
  "task_get",
  {
    title: "Tasks",
    description:
      "Whole tasks from the owner's task list, up to 20 at a time: the body " +
      "with its commands, links, branches, history, what each waits on and " +
      "what it unblocks. " +
      TASKS_EXPLAINED,
    inputSchema: {
      ids: z
        .array(z.string())
        .min(1)
        .max(20)
        .describe("Task ids, or links to them (…/admin/zadania#t-<id>)"),
    },
    annotations: READ_ONLY,
  },
  ({ ids }) => answer(() => taskGet(tasks, ids)),
);

server.registerTool(
  "task_add",
  {
    title: "Add a task",
    description:
      "Put something on the owner's task list that would otherwise be lost " +
      "when this session ends: a deploy, upload or migration to run after a " +
      "merge, a decision he has to make, a follow-up an agent can do later, " +
      "an idea. One task per step, with the exact commands in `body`, and " +
      "`dependsOn` for what has to happen first - add the prerequisite first " +
      "if it is not on the list. If an open task looks like the same thing " +
      "you are shown it instead; add to it with task_update. " +
      TASKS_EXPLAINED,
    inputSchema: {
      title: taskCreateSchema.shape.title.describe(
        'What to do, as an instruction: "Deploy the three nodes indexes"',
      ),
      body: z
        .string()
        .max(20_000)
        .optional()
        .describe(
          "Why, what exactly, and the commands to run - enough for somebody " +
            "who has not read this session",
        ),
      kind: z
        .enum(TASK_KINDS)
        .optional()
        .describe(
          "`action`: a step on production or infrastructure (deploy, upload, " +
            "migration, IAM, merge); `task`: work in a checkout; `decision`: " +
            "a question only the owner can answer; `idea`: nobody committed " +
            "to it; `goal`: where a group of tasks leads, with those tasks " +
            "in `dependsOn`. Default `task`",
        ),
      who: z
        .enum(TASK_WHO)
        .optional()
        .describe(
          "`owner` when it needs his credentials, access or judgement - " +
            "anything on production; `agent` when an agent can do it end to " +
            "end. Default `owner`",
        ),
      status: z
        .enum(TASK_STATUSES)
        .optional()
        .describe(
          "Default `open`; `parked` for something to keep but not do yet",
        ),
      dependsOn: z.array(z.string()).max(50).optional().describe(dependsOnHelp),
      tags: z
        .array(z.string())
        .max(12)
        .optional()
        .describe(
          "Short words to filter by: deploy, data, frontend, pipelines, " +
            "infra, security, research, seo, tooling, or a topic",
        ),
      links: z
        .array(z.string())
        .max(30)
        .optional()
        .describe("Links, #fb- report links, file paths"),
      branches: z
        .array(z.string())
        .max(20)
        .optional()
        .describe("Branch names the task is about"),
      id: z
        .string()
        .optional()
        .describe("An id to use instead of one made from the title"),
      force: z
        .boolean()
        .optional()
        .describe("Add it even though an open task looks like the same thing"),
    },
    annotations: WRITES,
  },
  (args) => answer(() => taskAdd(tasks, args, actor)),
);

server.registerTool(
  "task_update",
  {
    title: "Change a task",
    description:
      "Change a task on the owner's task list: close it (`status: done`, or " +
      "`dropped` when it will not happen), start it (`doing`), park it, add " +
      "what it waits on, or add a line to its history (`note`) - say what " +
      "you did and what you found. Closing a task tells you what it " +
      "unblocked. Only mark `done` what you have seen done: a merge is not a " +
      "deploy. " +
      TASKS_EXPLAINED,
    inputSchema: {
      id: z.string().describe("The task's id, or its link"),
      status: z.enum(TASK_STATUSES).optional(),
      note: z
        .string()
        .max(2000)
        .optional()
        .describe("A line for the task's history"),
      addDependsOn: z
        .array(z.string())
        .max(50)
        .optional()
        .describe(dependsOnHelp),
      removeDependsOn: z.array(z.string()).max(50).optional(),
      title: z.string().optional(),
      body: z.string().max(20_000).optional().describe("Replaces the body"),
      kind: z.enum(TASK_KINDS).optional(),
      who: z.enum(TASK_WHO).optional(),
      tags: z
        .array(z.string())
        .max(12)
        .optional()
        .describe("Replaces the tags"),
      links: z
        .array(z.string())
        .max(30)
        .optional()
        .describe("Replaces the links"),
      branches: z
        .array(z.string())
        .max(20)
        .optional()
        .describe("Replaces the branches"),
    },
    annotations: WRITES,
  },
  ({ id, ...patch }) => answer(() => taskUpdate(tasks, { id, patch }, actor)),
);

await server.connect(new StdioServerTransport());
