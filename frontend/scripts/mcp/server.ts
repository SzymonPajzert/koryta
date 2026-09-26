/** An MCP server that lets Claude agents read koryta's production data - for
 * now the feedback queue on /admin/opinie - and do nothing else: it can only
 * read, and it hands on nothing that says who wrote a report.
 *
 * `/.mcp.json` registers it for every session in the repo, so its tools show
 * up as `mcp__koryta__feedback_queue` and `mcp__koryta__feedback_get`. Reads
 * go out as the `firestore-reader` account (see `firestore-reader.ts`), or to
 * the emulator named by FIRESTORE_EMULATOR_HOST.
 *
 * stdout is the protocol: anything logged goes to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { feedbackGet, feedbackQueue } from "./feedback";
import { connect } from "./firestore-reader";

const db = connect();
const server = new McpServer({ name: "koryta", version: "1.0.0" });

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

async function answer(read: () => Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await read() }] };
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
      "report, and what checkers found. " +
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
      "the admin's note, and - when a frontend/shared/qa.ts entry claims to " +
      "fix it - that entry, what checkers found and whether the page would " +
      "offer closing it. " +
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
    },
    annotations: READ_ONLY,
  },
  ({ ids }) => answer(() => feedbackGet(db, ids)),
);

await server.connect(new StdioServerTransport());
