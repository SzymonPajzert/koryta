import { z } from "zod";

const utf8 = new TextEncoder();

/** Whether `id` names one document directly inside a collection.
 *
 * Firestore's own limits on a document id, and the reason they matter here
 * is the first one. The Admin SDK's `collection("nodes").doc(id)` takes a
 * slash-separated path, so `doc("x/y/z")` is `nodes/x/y/z` - a document in a
 * subcollection below the node, whose `.id` is `z` - while `doc("x/y")` throws,
 * which a handler answers with a 500, and `doc("x/")` quietly drops the slash.
 * `.` and `..` are not ids either, and `__name__`-shaped ones are reserved: the
 * SDK passes those three through and the server refuses them, another 500.
 */
export function isDocumentId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    !id.includes("/") &&
    id !== "." &&
    id !== ".." &&
    !/^__.*__$/.test(id) &&
    utf8.encode(id).length <= 1500
  );
}

/** A request field that names a document, for a route's zod schema.
 *
 * Read through `readValidatedBody` or `getValidatedQuery`, anything else is a
 * 400 before it reaches `.doc()`. A route that calls `.parse` on the body
 * itself answers every refused field with a 500, this one included. */
export const documentId = z
  .string()
  .refine(isDocumentId, { message: "Nieprawidłowy identyfikator." });

/** `value`, if it names a document; otherwise a 400 naming the field. For the
 * routes that read their input without a schema. */
export function requireDocumentId(value: unknown, field: string): string {
  if (!isDocumentId(value)) {
    throw createError({
      statusCode: 400,
      message: `Nieprawidłowy identyfikator w polu ${field}.`,
    });
  }
  return value;
}
