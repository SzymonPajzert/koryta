import { z } from "zod";
import { defineEventHandler, readValidatedBody } from "h3";
import { requireOwner } from "~~/server/utils/auth";
import { updateTask } from "~~/server/utils/opsTasks";
import { TASK_ID_PATTERN, taskPatchSchema } from "~~/shared/tasks";

const bodyValidator = z.object({
  id: z.string().regex(TASK_ID_PATTERN),
  patch: taskPatchSchema,
});

/** A change the owner makes to a task: its status, what it waits on, a line
 * of history. Answers the task as written, so the page shows what the
 * database holds rather than what it asked for. */
export default defineEventHandler(async (event) => {
  await requireOwner(event);
  const { id, patch } = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );
  return { task: await updateTask(id, patch, "owner") };
});
