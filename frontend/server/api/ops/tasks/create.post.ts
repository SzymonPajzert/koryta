import { defineEventHandler, readValidatedBody } from "h3";
import { requireOwner } from "~~/server/utils/auth";
import { createTask } from "~~/server/utils/opsTasks";
import { taskCreateSchema } from "~~/shared/tasks";

/** A task the owner adds on /admin/zadania. */
export default defineEventHandler(async (event) => {
  await requireOwner(event);
  const input = await readValidatedBody(event, (body) =>
    taskCreateSchema.parse(body),
  );
  return { task: await createTask(input, "owner") };
});
