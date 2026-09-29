// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  memoryNotes,
  sessionId,
  taskContext,
  taskReports,
  taskSessions,
} from "../../shared/taskContext";
import type { Task } from "../../shared/tasks";

const T0 = "2026-09-28T08:00:00.000Z";
const T1 = "2026-09-29T10:30:00.000Z";

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    body: "",
    kind: "action",
    who: "owner",
    status: "open",
    dependsOn: [],
    tags: [],
    links: [],
    branches: [],
    createdAt: T0,
    updatedAt: T0,
    createdBy: "agent",
    log: [],
    ...fields,
  };
}

describe("where a task came from", () => {
  it("finds the memory notes it names, however it names them", () => {
    expect(
      memoryNotes({
        source: "memory:branch-triage-2026-09-26 (2026-09-26)",
        body: "From: memory krs-odpis-run-order (as of 2026-09-20). See [[nip-to-krs-only-via-biala-lista]] and the memory note.",
        links: ["~/.claude/projects/x/memory/feedback-sweep-2026-09-28.md"],
      }),
    ).toEqual([
      "branch-triage-2026-09-26",
      "krs-odpis-run-order",
      "nip-to-krs-only-via-biala-lista",
      "feedback-sweep-2026-09-28",
    ]);
  });

  it("knows a session by its workspace, and nothing else as one", () => {
    expect(sessionId("bridge-cse_01GN7HchYK2F8v8FoTz9HZry")).toBe(
      "01GN7HchYK2F8v8FoTz9HZry",
    );
    expect(sessionId("import")).toBeNull();
    expect(
      taskSessions({
        createdBy: "agent:bridge-cse_01Added",
        source: "session bridge-cse_01Added",
        log: [
          { at: T1, by: "agent:import", text: "Imported." },
          { at: T1, by: "agent:bridge-cse_01Later", text: "Checked." },
          { at: T1, by: "owner", text: "Mine." },
        ],
      }),
    ).toEqual([
      {
        label: "bridge-cse_01Added",
        id: "session_01Added",
        role: "added it",
      },
      {
        label: "bridge-cse_01Later",
        id: "session_01Later",
        role: "wrote its history",
      },
    ]);
  });

  it("finds the reports it points at", () => {
    expect(
      taskReports({
        body: "Zgłoszenie: https://koryta.pl/admin/opinie#fb-abc123",
        links: [
          "https://koryta.pl/admin/opinie#fb-abc123",
          "https://koryta.pl/admin/opinie#fb-def456",
        ],
      }),
    ).toEqual(["abc123", "def456"]);
  });
});

describe("taskContext", () => {
  const tasks = [
    task("merge", { title: "Merge the branch", status: "done" }),
    task("deploy", { title: "Deploy the indexes" }),
    task("upload", {
      title: "Upload the names",
      dependsOn: ["merge", "deploy", "gone"],
      source: "memory:company-upload-2026-09-26 (2026-09-26)",
      createdBy: "agent:bridge-cse_01Added",
      updatedAt: T1,
      body: "koryta_uploader --prod < names.jsonl",
      branches: ["names"],
      links: ["https://koryta.pl/admin/opinie#fb-abc123"],
      tags: ["data"],
      log: [{ at: T1, by: "owner", text: "Checked the file." }],
    }),
    task("check", { title: "Check the pages", dependsOn: ["upload"] }),
    task("live", {
      title: "Names on the site",
      kind: "goal",
      dependsOn: ["check"],
    }),
  ];

  it("says everything a new session needs to pick the task up", () => {
    const text = taskContext(tasks[2]!, tasks);
    expect(text.split("\n")).toEqual([
      "A task from the owner's list on koryta.pl: „Upload the names”",
      "https://koryta.pl/admin/zadania#t-upload",
      "Id: upload. Read its current state with task_get and record what you do with task_update (the koryta MCP server).",
      "",
      "Kind: action · for: the owner · status: open · blocked - waits on 1 of 3",
      "Added 2026-09-28 08:00 UTC by agent:bridge-cse_01Added · last changed 2026-09-29 10:30 UTC",
      "Source: memory:company-upload-2026-09-26 (2026-09-26)",
      "Memory notes: company-upload-2026-09-26",
      "Sessions: bridge-cse_01Added (added it; claude.ai session_01Added)",
      "Reports (feedback_get): abc123",
      "Leads to goals: „Names on the site” (live)",
      "",
      "koryta_uploader --prod < names.jsonl",
      "",
      "Waits on:",
      "- [done] merge: Merge the branch",
      "- [open] deploy: Deploy the indexes",
      "- gone: no such task any more",
      "",
      "Then unblocks:",
      "- [open] check: Check the pages",
      "",
      "Branches: names",
      "Links:",
      "- https://koryta.pl/admin/opinie#fb-abc123",
      "Tags: data",
      "",
      "History, oldest first:",
      "- 2026-09-29 10:30 UTC owner: Checked the file.",
    ]);
  });

  it("keeps a bare task short", () => {
    expect(taskContext(tasks[1]!, tasks).split("\n")).toEqual([
      "A task from the owner's list on koryta.pl: „Deploy the indexes”",
      "https://koryta.pl/admin/zadania#t-deploy",
      "Id: deploy. Read its current state with task_get and record what you do with task_update (the koryta MCP server).",
      "",
      "Kind: action · for: the owner · status: open · ready - nothing it waits on is open",
      "Added 2026-09-28 08:00 UTC by agent",
      "Leads to goals: „Names on the site” (live)",
      "",
      "Then unblocks:",
      "- [open] upload: Upload the names",
    ]);
  });
});
