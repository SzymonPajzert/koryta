/** What one revision proposes, field by field, in words a reader recognises.
 *
 * A revision is a *complete snapshot* of its target, not a patch, so most of
 * what it carries is a copy of what the page already says. The handful of
 * fields that actually differ is the whole of what a reviewer has to decide on
 * and the whole of what its author wants to see - everything else is noise, and
 * rendering the snapshot is what makes `/admin/rewizje/[id]` unreadable once a
 * node has more than three revisions.
 *
 * Kept in `shared/` because both sides read it: the server computes the changes
 * and the browser renders them, and a label that lived on only one side would
 * let the reviewer and the author be shown different words for the same field.
 */

import { editSchemas } from "./api";

/** One field a revision would change.
 *
 * `from` and `to` are already rendered to text - the raw values range over
 * strings, booleans, dates and arrays, and deciding how each of those reads in
 * Polish is this module's job rather than a template's. `null` on either side
 * means the field is absent there, which is not the same as an empty string a
 * contributor deliberately cleared.
 */
export interface RevisionChange {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

/** Fields nobody proposes and nobody should read as a change.
 *
 * Three groups. The structural ones say what the document *is* rather than what
 * it claims - an edge restates its own endpoints in every revision - and
 * `isPublicSource` and `categoriesSource` are bookkeeping
 * `/api/revisions/create` writes alongside `isPublic` and `categories`.
 * Removal is rendered as its own thing, not as `deleted: — → tak`, so both of
 * its fields are dropped too.
 *
 * The rest is `INTERNAL_FIELDS` from `server/utils/revisions.ts`: bookkeeping
 * the document owns rather than states. The stored side already has these
 * stripped, but a revision written before the ingest started stripping them
 * still carries them inside its own `data` - `/admin/rewizje/[id]` deletes
 * `revision_id` from its key list for exactly this reason. Left in, every such
 * revision would report its counters as changes, and `revision_id` decodes to a
 * live DocumentReference that has no readable rendering at all.
 *
 * `tests/server/utils/revisions.test.ts` asserts this stays a superset of
 * `INTERNAL_FIELDS`, so the two partitions cannot drift apart. (The assertion
 * lives there because importing `INTERNAL_FIELDS` pulls in firebase-admin.)
 */
export const skippedChangeFields = new Set([
  "type",
  "source",
  "target",
  "isPublicSource",
  "categoriesSource",
  "deleted",
  "delete_reason",
  "stats",
  "revision_id",
  "published",
  "revisions",
  "votes",
  "id",
  "visibility",
  "merged_into",
  "needs_split",
  "nameChunksLower",
]);

/** How each proposable field reads in Polish.
 *
 * `revisionFieldLabelsCoverEditSchemas` in the tests walks every schema in
 * `editSchemas` and fails when one of its keys is missing here, so a newly
 * editable field cannot ship as a bare English key inside Polish copy. Fields
 * that only the ingest writes are labelled on a best-effort basis - they turn
 * up in the queue when a reviewer looks at pipeline output, which is not the
 * case this is for.
 */
export const revisionFieldLabels: Record<string, string> = {
  // person
  name: "nazwa",
  content: "opis",
  parties: "partie",
  birthDate: "data urodzenia",
  education: "wykształcenie",
  wikipedia: "Wikipedia",
  rejestrIo: "rejestr.io",
  ktomaco: "ktomaco",
  // place
  krsNumber: "KRS",
  regonNumber: "REGON",
  nipNumber: "NIP",
  isPublic: "w rękach publicznych",
  categories: "kategorie",
  activity: "kody PKD",
  legalForm: "forma prawna",
  supervisoryBody: "organ nadzoru",
  supervisoryOrgan: "organ nadzoru w KRS",
  // article
  sourceURL: "adres źródła",
  shortName: "nazwa skrócona",
  publishedDate: "data publikacji",
  // topic
  description: "opis tematu",
  // edges, which a reader can propose through the relation dialogs
  start_date: "data od",
  end_date: "data do",
  position: "stanowisko",
  party: "partia",
  committee: "komitet",
  party_member: "deklarowana przynależność partyjna",
  references: "źródła",
  elected: "wybrany",
  term: "kadencja",
  by_election: "wybory uzupełniające",
};

export function revisionFieldLabel(field: string): string {
  return revisionFieldLabels[field] ?? field;
}

/** The editable fields of every proposable type, for the coverage test. */
export function proposableFieldNames(): string[] {
  const fields = new Set<string>();
  for (const schema of Object.values(editSchemas)) {
    for (const key of Object.keys(schema.shape)) fields.add(key);
  }
  return [...fields];
}

/** A stored value as a line of Polish.
 *
 * Arrays arrive both ways round: Firestore stores a top-level array as one, but
 * `sanitizeFirestoreData` rewrites a nested array into a map keyed by index, so
 * an array field can reach here as `{ 0: "PiS" }`. Both read as a list.
 */
export function renderFieldValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? "tak" : "nie";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const items = value.map(renderFieldValue).filter((v) => v !== null);
    return items.length > 0 ? items.join(", ") : "";
  }
  if (typeof value === "object") {
    // A map keyed by index is the sanitized form of an array; anything else is
    // a real nested object, which no proposable field is, and which is more
    // honestly shown as JSON than flattened into something that reads like
    // prose but is not.
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0 && entries.every(([key]) => /^\d+$/.test(key))) {
      return renderFieldValue(
        entries
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, item]) => item),
      );
    }
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * The fields where `proposed` differs from `baseline`.
 *
 * `baseline` is the version the entry is actually serving - its approved
 * revision - rather than whatever the target document happens to hold. Those
 * are not the same thing: `/api/revisions/create` and
 * `createRevisionTransaction` both write the proposal's own data onto the
 * target in the batch that files the proposal, so a stored document routinely
 * already agrees with a revision nobody has reviewed. Diffing against it would
 * report "no changes" for a proposal that is entirely new. See `baselineFor` in
 * `server/utils/revisionQueue.ts`.
 *
 * An empty `baseline` - nothing approved yet - yields every field the proposal
 * states, which is correct: all of it is new.
 */
export function revisionChanges(
  proposed: Record<string, unknown>,
  baseline: Record<string, unknown>,
): RevisionChange[] {
  const fields = new Set([...Object.keys(proposed), ...Object.keys(baseline)]);
  const changes: RevisionChange[] = [];

  for (const field of fields) {
    if (skippedChangeFields.has(field)) continue;

    // A field the proposal does not mention is not a proposal to delete it:
    // partial data reaches `revisions/create` layered over `baseNodeFields`,
    // but the ingest endpoints write whatever the scrapers found. Only fields
    // the proposal actually states are read as claims about them.
    if (!(field in proposed)) continue;

    // Compared after rendering rather than by identity: `["PiS"]` and
    // `{ 0: "PiS" }` are the same claim written two ways, and a revision that
    // merely round-tripped through `sanitizeFirestoreData` would otherwise show
    // every array field as changed.
    const from = renderFieldValue(baseline[field]);
    const to = renderFieldValue(proposed[field]);
    if (from === to) continue;

    // A field the entry never carried, stated empty, is not a change. The edit
    // dialog posts every optional field of its form, so a proposal that only
    // fixes a misspelt name still says `birthDate: ""` for a person the
    // pipeline created without one - and rendering that as "— → usunięto"
    // buries the one line that matters under four that say nothing. Clearing a
    // field that *is* stored still reports, so a deliberate deletion is not
    // hidden.
    if (from === null && to === "") continue;

    changes.push({ field, label: revisionFieldLabel(field), from, to });
  }

  // Alphabetical by the Polish label, so the same proposal reads the same way
  // every time - Firestore does not promise a key order and `Object.keys` on a
  // decoded document has followed insertion order more than once.
  return changes.sort((a, b) => a.label.localeCompare(b.label, "pl"));
}
