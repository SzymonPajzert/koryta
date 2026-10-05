import { defineEventHandler } from "h3";
import { requireOwner } from "~~/server/utils/auth";
import { listTasks } from "~~/server/utils/opsTasks";

/** The owner's whole task list, closed tasks included: it is a few hundred
 * documents, and the page works out what waits on what from all of them. */
export default defineEventHandler(async (event) => {
  await requireOwner(event);
  return { tasks: await listTasks() };
});
