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
 * Four groups. The structural ones say what the document *is* rather than what
 * it claims - an edge restates its own endpoints in every revision - and
 * `isPublicSource`, `categoriesSource` and `partiesSource` are
 * bookkeeping `/api/revisions/create` writes alongside `isPublic`,
 * `categories` and `parties`.
 * Removal is rendered as its own thing, not as `deleted: — → tak`, so both of
 * its fields are dropped too.
 *
 * Then `INTERNAL_FIELDS` from `server/utils/revisions.ts`: bookkeeping the
 * document owns rather than states. The stored side already has these
 * stripped, but a revision written before the ingest started stripping them
 * still carries them inside its own `data`. Left in, every such revision would
 * report its counters as changes, and `revision_id` decodes to a live
 * DocumentReference that has no readable rendering at all. Last, a few stamps
 * of other kinds, explained where they are listed.
 *
 * `/admin/rewizje/[id]` leaves this whole set out of its comparison table too.
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
  "partiesSource",
  "authoritiesSource",
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
  "content_changed_at",
  // Bookkeeping too. `nameSource` is what `/api/revisions/create` stamps on a
  // hand-made company rename, so the ingest leaves the name alone; listed, it
  // read as a second change beside every rename. `date` and `user` are a
  // creation stamp (ms and a uid) an old code path wrote onto about 440 nodes;
  // nothing reads them, and a proposal copying them showed „date: — →
  // 1752843656679” on /profil and in the review queue.
  "nameSource",
  "date",
  "user",
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
  // region: its „Władze”, read line by line by `governmentChanges`, and its
  // code, which no form offers but a region's first revision states
  authorities: "władze",
  teryt: "kod TERYT",
  // edges, which a reader can propose through the relation dialogs
  start_date: "data od",
  end_date: "data do",
  // Only a candidacy carries one - an employment's role is its `name` - and
  // it is the election the run was for: „Sejm", „Senat", „Samorząd". The
  // dialogs call it that too, so the reviewer reads the word the contributor
  // picked it under.
  position: "typ wyborów",
  party: "partia",
  committee: "komitet",
  references: "źródła",
  elected: "wybrany/a",
  term: "kadencja",
  by_election: "wybory uzupełniające",
};

export function revisionFieldLabel(field: string): string {
  return revisionFieldLabels[field] ?? field;
}

/** A label, or a list of them, at the head of a line: „Data urodzenia”,
 * „Opis, partie”. The map above stays lowercase because the same names are
 * also joined mid-sentence. One helper for the queue's lines, an entry's
 * history, the diff and the comparison table's rows, so they cannot come to
 * write the same field two ways. */
export function capitaliseLabel(text: string): string {
  return text.charAt(0).toLocaleUpperCase("pl-PL") + text.slice(1);
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
  if (typeof value === "object" && isGovernment(value)) {
    return renderGovernment(value);
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
    //
    // Except a win. `elected` is stored as `true` or not at all - an unticked
    // „Uzyskano mandat” is written as nothing, never as `false`, see `elected`
    // in shared/api.ts - so a correction that takes a win back off a candidacy
    // says it by leaving the key out. Approving is a `set` and does delete the
    // win, and skipped here that proposal read as an empty diff.
    const winTakenBack = field === "elected" && baseline.elected === true;
    if (!(field in proposed) && !winTakenBack) continue;

    // A region's „Władze” is sixty names in one field: a line for each part
    // that changed, rather than one cell of everything.
    if (field === "authorities") {
      changes.push(...governmentChanges(baseline[field], proposed[field]));
      continue;
    }

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

/* ---------- a region's „Władze” ---------- */

interface GovernmentShape {
  head?: GovernmentPersonShape & { office?: string; since?: string };
  councils: { office: string; members: GovernmentPersonShape[] }[];
}

interface GovernmentPersonShape {
  name?: string;
  personId?: string;
  committee?: string;
}

/** A list as Firestore may hand one back: an array, or the map keyed by index
 * `sanitizeFirestoreData` makes of an array inside an array. */
function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => /^\d+$/.test(key))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, item]) => item);
  }
  return [];
}

/** Whether a stored value is a region's „Władze” record. */
function isGovernment(value: object): boolean {
  return "councils" in value || ("head" in value && "election" in value);
}

function asGovernment(value: unknown): GovernmentShape {
  if (!value || typeof value !== "object") return { councils: [] };
  const record = value as { head?: unknown; councils?: unknown };
  return {
    head:
      record.head && typeof record.head === "object"
        ? (record.head as GovernmentShape["head"])
        : undefined,
    councils: listOf(record.councils).map((council) => {
      const { office, members } = council as {
        office?: string;
        members?: unknown;
      };
      return {
        office: office ?? "",
        members: listOf(members) as GovernmentPersonShape[],
      };
    }),
  };
}

/** „Prezydent” is „prezydent miasta” to a reader; the rest read as stored. */
function officeLabel(office: string | undefined): string {
  return (
    office === "Prezydent" ? "Prezydent miasta" : (office ?? "")
  ).toLocaleLowerCase("pl-PL");
}

/** „Mariusz Siewiera (KWW ŁOWICKIE.PL)”, and whether a page is linked. */
function renderGovernmentPerson(person: GovernmentPersonShape): string {
  const name = person.name ?? "";
  const committee = person.committee ? ` (${person.committee})` : "";
  const page = person.personId ? ", ze stroną" : "";
  return `${name}${committee}${page}`;
}

function renderGovernmentHead(head: GovernmentShape["head"]): string | null {
  if (!head?.name) return null;
  const since = head.since ? `, od ${head.since}` : "";
  return `${renderGovernmentPerson(head)}${since}`;
}

/** The whole record as lines, for the comparison table: the head, then each
 * council with its seats. */
function renderGovernment(value: object): string {
  const record = asGovernment(value);
  const lines: string[] = [];
  const head = renderGovernmentHead(record.head);
  if (record.head?.office) {
    lines.push(
      `${capitaliseLabel(officeLabel(record.head.office))}: ${head ?? "brak danych"}`,
    );
  }
  for (const council of record.councils) {
    lines.push(
      `${council.office} (${council.members.length}): ${council.members
        .map(renderGovernmentPerson)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}

/** What a proposal changes in a region's „Władze”, a line for each part: the
 * head as who held it and who would, a council as who would leave it and who
 * would join it. `field` is unique per line, which the diff keys its rows by. */
export function governmentChanges(
  baseline: unknown,
  proposed: unknown,
): RevisionChange[] {
  const before = asGovernment(baseline);
  const after = asGovernment(proposed);
  const changes: RevisionChange[] = [];

  const headFrom = renderGovernmentHead(before.head);
  const headTo = renderGovernmentHead(after.head);
  if (headFrom !== headTo) {
    changes.push({
      field: "authorities.head",
      label: `władze: ${officeLabel(after.head?.office ?? before.head?.office)}`,
      from: headFrom,
      to: headTo ?? "",
    });
  }

  const offices = [
    ...new Set(
      [...before.councils, ...after.councils].map((council) => council.office),
    ),
  ];
  for (const office of offices) {
    const was = (
      before.councils.find((council) => council.office === office)?.members ??
      []
    ).map(renderGovernmentPerson);
    const now = (
      after.councils.find((council) => council.office === office)?.members ?? []
    ).map(renderGovernmentPerson);
    const leaving = was.filter((member) => !now.includes(member));
    const joining = now.filter((member) => !was.includes(member));
    if (!leaving.length && !joining.length) continue;
    changes.push({
      field: `authorities.${office}`,
      label: `władze: ${office.toLocaleLowerCase("pl-PL")}`,
      from: leaving.length ? leaving.join(", ") : null,
      to: joining.length ? joining.join(", ") : "",
    });
  }
  return changes;
}
