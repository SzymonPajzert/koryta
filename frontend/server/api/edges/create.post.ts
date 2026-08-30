import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";
import { edgeDocumentId } from "~~/server/utils/edges";
import { edgeTypes } from "~~/shared/model";
import type { ElectionPosition } from "~~/shared/model";
import { electionPositions } from "~~/shared/misc";

const bodyValidator = z.object({
  /** Checked against the declared types. It used to be any truthy string, so a
   * typo stored an edge of a type nothing renders, nothing dedupes - it falls
   * to the `authored` default in `EDGE_SEMANTICS` - and no migration knows
   * about. */
  type: z.enum(edgeTypes),
  source: z.string().min(1),
  target: z.string().min(1),
  name: z.string().optional(),
  content: z.string().optional(),
  text: z.string().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  references: z.array(z.string().min(1)).optional(),
  party: z.string().optional(),
  committee: z.string().optional(),
  /** A declared office, or blank. The form sends "" for every box it left
   * empty, so an empty string has to stay acceptable - what is refused is a
   * value that is neither. */
  position: z
    .string()
    .refine(
      (value) =>
        value === "" || electionPositions.includes(value as ElectionPosition),
      "Nieznane stanowisko wyborcze.",
    )
    .optional(),
  elected: z.boolean().optional(),
  term: z.string().optional(),
  by_election: z.boolean().optional(),
  update_automatic: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
  const body = bodyValidator.parse(await readBody(event));

  const user = await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");

  const revisionData = {
    source: body.source,
    target: body.target,
    type: body.type,
    name: body.name || "",
    content: body.content || body.text || "",
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    references: body.references || [],
    party: body.party || "",
    committee: body.committee || "",
    position: (body.position || "") as ElectionPosition | "",
    elected: !!body.elected,
    term: body.term || "",
    by_election: !!body.by_election,
    update_automatic: body.update_automatic || undefined,
  };

  // Derived from the relation's identity rather than allocated at random, so
  // that stating the same thing twice lands on one document. The form could
  // always be submitted twice, and promoting the same extracted fact twice is a
  // second button that does it - both used to leave two edges saying one thing,
  // which every count and every graph then drew twice. `edgeDocumentId` is the
  // rule the ingest paths already store by.
  // Spelled out rather than handed `revisionData`, which stores `null` for a
  // blank date where `Edge` declares the field optional. `edgeDocumentId` reads
  // undefined, null and "" alike, so the two agree on the id either way; this
  // just says so in the types. Every discriminator any edge type declares is
  // here - see `EDGE_SEMANTICS`.
  const edgeRef = db.collection("edges").doc(
    edgeDocumentId({
      source: revisionData.source,
      target: revisionData.target,
      type: revisionData.type,
      name: revisionData.name,
      content: revisionData.content,
      start_date: revisionData.start_date ?? undefined,
      end_date: revisionData.end_date ?? undefined,
      party: revisionData.party,
      committee: revisionData.committee,
      position: revisionData.position || undefined,
      term: revisionData.term,
    }),
  );

  // Already there: hand back the id rather than writing over it. A `set`
  // through `createRevisionTransaction` would replace the stored document, and
  // with it whether the relation is published and everything counted on it - so
  // re-adding a live relation would quietly take it off the site.
  const existing = await edgeRef.get();
  if (existing.exists) {
    return { id: edgeRef.id, created: false };
  }

  const batch = db.batch();
  // `published: false` said out loud rather than left off. Both readings hide
  // the relation - `pageIsPublic` wants the flag to be `true` - but Firestore
  // matches no filter against a field a document does not have, so an edge
  // written without it is invisible to `where("published", "==", false)` and
  // would never reach the queue in /admin/krawedzie that is supposed to find
  // it. Same reasoning as /api/revisions/create for a brand new node.
  createRevisionTransaction(db, batch, user, edgeRef, revisionData, {
    published: false,
  });

  await batch.commit();

  return { id: edgeRef.id, created: true };
});
