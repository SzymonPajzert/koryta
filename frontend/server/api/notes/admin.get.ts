import { z } from "zod";
import { defineEventHandler, getValidatedQuery } from "h3";
import { getUser } from "~~/server/utils/auth";
import { getNoteRows } from "~~/server/utils/notes";
import type { NoteRow } from "~~/shared/model";
import { adminFirestore } from "~~/server/utils/firebase";

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page: z.coerce.number().int().min(1).default(1),

  kind: z.enum(["source", "change_request", "missing"]).optional(),
  /** "none" selects the entries nobody has triaged yet. */
  status: z.enum(["resolved", "unresolved", "none"]).optional(),
  /** A stored type, or "none" for the entries nobody has classified - which is
   * the queue /admin/notatki/kategoryzacja works through. */
  adminType: z.string().min(1).optional(),
  /** Entries a reviewer handed back to the table view ("true"), or the ones
   * they did not ("false"). The phone queue asks for the latter so an entry it
   * could not classify does not come round again. */
  deferred: z.enum(["true", "false"]).optional(),
  nodeType: z.enum(["person", "place", "article", "region"]).optional(),
  /** Free text over the note, its url and the name of the node it is on. */
  q: z.string().min(1).optional(),

  sortBy: z
    .enum(["createdAt", "nodeName", "nodeType", "kind", "adminStatus"])
    .default("createdAt"),
  sortDesc: z.enum(["true", "false"]).default("true"),
});

/** The triage queue behind /admin/notatki.
 *
 * Admin-only because it joins every note with its author and with nodes that
 * may not be published yet. The page used to build this in the browser, which
 * meant streaming the whole `notes` collection down and then one request per
 * node to resolve a name.
 */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (!user.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const rows = await getNoteRows(adminFirestore());

  const needle = query.q?.toLowerCase();
  const matching = rows.filter((row) => {
    if (query.kind && row.kind !== query.kind) return false;
    if (query.status === "none" && row.adminStatus) return false;
    if (
      query.status &&
      query.status !== "none" &&
      row.adminStatus !== query.status
    ) {
      return false;
    }
    if (query.adminType) {
      const wanted = query.adminType === "none" ? null : query.adminType;
      if (row.adminType !== wanted) return false;
    }
    if (query.deferred && row.adminTypeDeferred !== (query.deferred === "true"))
      return false;
    if (query.nodeType && row.nodeType !== query.nodeType) return false;
    if (needle && !matchesText(row, needle)) return false;
    return true;
  });

  // `getNoteRows` already hands back the default order, so only a column the
  // admin picked costs a sort.
  const sorted =
    query.sortBy === "createdAt" && query.sortDesc === "true"
      ? matching
      : sortRows(matching, query.sortBy, query.sortDesc === "true");

  const offset = (query.page - 1) * query.limit;

  return {
    notes: sorted.slice(offset, offset + query.limit),
    total: sorted.length,
  };
});

function matchesText(row: NoteRow, needle: string) {
  return (
    row.note.toLowerCase().includes(needle) ||
    (row.url?.toLowerCase().includes(needle) ?? false) ||
    (row.nodeName?.toLowerCase().includes(needle) ?? false)
  );
}

function sortRows(rows: NoteRow[], key: keyof NoteRow, desc: boolean) {
  // Copied rather than sorted in place - `rows` may be the cached list, or a
  // filtered view sharing its order with it.
  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (left === right) return 0;
    // Whichever way the column is sorted, the entries with nothing in it are
    // the least interesting, so they stay at the bottom.
    if (left == null) return 1;
    if (right == null) return -1;
    return (left < right ? -1 : 1) * (desc ? -1 : 1);
  });
}
