import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import {
  createRevisionTransaction,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import { aidRequestSchema, type AidRequest as Request } from "#shared/api";
import { categoriesFromActivity } from "#shared/companyCategories";
import { pageIsPublic } from "#shared/model";
import { edgeDocumentId } from "~~/server/utils/edges";
import { findRegionByTeryt } from "~~/server/utils/regions";
import { asArray } from "#shared/misc";

/** Public aid granted under one programme, as one beneficiary's share of it.
 *
 * Modelled on `ingest/company`: the same revision-per-document write, the same
 * "an existing node keeps the visibility it has" rule, the same derived edge
 * ids. What is different is the shape of the fact. A company's owner is a tie
 * between two companies; a grant is a transaction each end had with the state,
 * and there are far more of them than there are pairs - 9461 decisions over
 * 5233 (institution, beneficiary) pairs under SA.116730 alone. So the decisions
 * are summed into one edge per pair per programme before they get here, and the
 * edge carries the total rather than the register carrying 9461 documents whose
 * only reader would be a sum.
 *
 * See `EDGE_SEMANTICS.aid` for why the measure number is part of the edge's
 * identity, and `edgeTraverse.aid` for why the edge is a dead end in both
 * directions.
 */
export default defineEventHandler(async (event) => {
  console.info("Handling ingest/aid.post");
  const body: Request = await readValidatedBody(event, (body) =>
    aidRequestSchema.parse(body),
  );
  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const batch = db.batch();

  // The owner claim is checked here rather than taken on trust, because the
  // pipeline that made it matched on a name and this is the only place that can
  // see the person's own region links.
  //
  // A claim that does not hold up costs the claim and nothing else: the aid
  // itself is a matter of public record either way, and failing the whole
  // request over it would drop a real grant because of a guess about who owns
  // the recipient. Logged rather than silently dropped, because the pipeline
  // should not have sent it.
  const owner = body.owner ? await findOwner(db, body.owner) : null;
  if (body.owner && !owner) {
    console.warn(
      `[ingest/aid] unconfirmed owner ${body.owner.name} ` +
        `(node ${body.owner.node_id}) for nip=${body.nip}: not a person of ` +
        `that name in powiat ${body.owner.teryt}. Storing the aid without it.`,
    );
  }

  // Everything in the register is stored. What differs is whether a page goes
  // up: a company out of KRS is published on arrival, as `ingest/company` has
  // always done, while a natural person trading under their own name is stored
  // and left for a reviewer. Their business is a matter of public record and
  // the aid is public money, but the name on the door is a private individual's
  // and 2967 automatically published pages about them is not a decision an
  // ingest should be making on its own.
  const soleTrader = body.soleTrader ?? !body.krs;
  const beneficiary = await findPlace(
    db,
    body.krs ? { krsNumber: body.krs } : { nipNumber: body.nip },
    { publishNew: !soleTrader },
  );
  const beneficiaryData: Record<string, unknown> = {
    ...withoutInternalFields(beneficiary.stored ?? {}),
    name: body.name,
    type: "place",
    ...(body.krs ? { krsNumber: body.krs } : {}),
  };
  // The join key SUDOP is addressed by. Nothing in the database carries one
  // today - all 3631 stored companies have a KRS number and none has a NIP - so
  // writing it here is what makes a company found by this ingest findable by
  // the next one without going back through the white list.
  if (body.nip) beneficiaryData.nipNumber = body.nip;
  if (body.activity && body.activity.length > 0) {
    beneficiaryData.activity = body.activity;
    beneficiaryData.categories = categoriesFromActivity(body.activity);
  }
  createRevisionTransaction(db, batch, user, beneficiary.ref, beneficiaryData, {
    automatic: true,
    approve: beneficiary.publish,
    stored: beneficiary.stored,
    published: beneficiary.publish,
  });

  // Always unpublished, whatever the beneficiary's own state. "A councillor's
  // firm took flood money" is the strongest claim this pipeline can make and
  // the one it is least able to verify: the corroboration above says the names
  // agree and the powiat agrees, which is a reason to look rather than a
  // finding. A person reads it before the public does.
  if (owner) {
    await writeEdge(db, batch, user, {
      source: owner.id,
      target: beneficiary.ref.id,
      type: "owns",
      publish: false,
    });
  }

  let region: "added" | "existing" | "unknown" | undefined;
  if (body.teryt) {
    const regionNodeId = await findRegionByTeryt(db, body.teryt);
    if (regionNodeId) {
      const seat = await writeEdge(db, batch, user, {
        source: regionNodeId,
        target: beneficiary.ref.id,
        type: "owns",
        publish: beneficiary.publish,
      });
      region = seat.created ? "added" : "existing";
    } else {
      console.warn(
        `No region node for TERYT ${body.teryt} ` +
          `(${body.krs ? `krs=${body.krs}` : `nip=${body.nip}`}), skipping location`,
      );
      region = "unknown";
    }
  }

  const edges: string[] = [];
  for (const grant of body.grants) {
    // Grantors are matched on NIP because most of them cannot be matched on
    // anything else: a starosta and a marszałek are urzędy, outside KRS
    // entirely. They are created unpublished, unlike the beneficiary: a public
    // institution appearing on the site for the first time because it paid
    // somebody is worth a reviewer's glance, and there are only 32 of them.
    const grantor = await findPlace(
      db,
      { nipNumber: grant.grantor_nip },
      { publishNew: false },
    );
    const grantorData = {
      ...withoutInternalFields(grantor.stored ?? {}),
      name: grant.grantor_name,
      type: "place",
      nipNumber: grant.grantor_nip,
      // Every grantor under a flood measure is an organ of the state or a fund
      // it set up, which is exactly what the flag says. Unlike the scrapers'
      // reading of KRS this is not an inference, so it is safe to assert - but
      // never over a human's answer.
      ...(grantor.stored?.isPublicSource === "manual" ? {} : { isPublic: true }),
    };
    // Only when it would say something new. There are 25 granting institutions
    // behind 1040 grants, so a run that restated each of them per grant would
    // write 1040 revisions of 25 documents - a review queue made entirely of
    // one office's name, restated.
    if (!grantor.stored || changes(grantor.stored, grantorData)) {
      createRevisionTransaction(db, batch, user, grantor.ref, grantorData, {
        automatic: true,
        approve: grantor.publish,
        stored: grantor.stored,
        published: grantor.publish,
      });
    }

    // The edge is written whether or not one is already stored, and its id is
    // derived from (grantor, beneficiary, measure) so the second write lands on
    // the first document. That is the point: SUDOP is fed with a delay, a
    // re-ingest a month later is the same pair with a larger total, and the
    // totals have to be replaced rather than added to.
    edges.push(
      (
        await writeEdge(db, batch, user, {
          source: grantor.ref.id,
          target: beneficiary.ref.id,
          type: "aid",
          publish: beneficiary.publish && grantor.publish,
          fields: {
            aidMeasure: body.measure,
            aidGross: grant.gross,
            aidDecisions: grant.decisions,
            ...(grant.first_decision
              ? { start_date: grant.first_decision }
              : {}),
            ...(grant.last_decision ? { end_date: grant.last_decision } : {}),
          },
        })
      ).id,
    );
  }

  await batch.commit();

  return { id: beneficiary.ref.id, code: 200, region, edges };
});

/** The person a sole trader's business belongs to, if the claim holds up.
 *
 * Two things have to agree, and the pipeline having said so is not one of them:
 *
 * - the node it names is a person, and still carries the name it was matched by
 * - that person is tied to the powiat the business is registered in
 *
 * The second is the one that does the work. Names alone match 21 of the 2045
 * sole traders to somebody on the site and all 21 are the wrong powiat, so a
 * check that trusted the name would publish twenty-one accusations of nothing.
 *
 * The powiat is read off `stats.edges.all.targetNodeIds`, which holds the id of
 * every node this person's edges reach - `teryt1607` for powiat nyski among
 * them. Those ids are stored as an object keyed by index rather than an array,
 * so they are read through `asArray`.
 */
async function findOwner(
  db: FirebaseFirestore.Firestore,
  owner: { name: string; node_id: string; teryt: string },
): Promise<{ id: string } | null> {
  const snapshot = await db.collection("nodes").doc(owner.node_id).get();
  const stored = snapshot.data();
  if (!snapshot.exists || !stored || stored.type !== "person") return null;
  if (stored.name !== owner.name) return null;

  const targets = asArray<string>(
    (
      (stored.stats as Record<string, any> | undefined)?.edges as
        | Record<string, any>
        | undefined
    )?.all?.targetNodeIds,
  );
  const inPowiat = targets.some(
    (target) =>
      typeof target === "string" &&
      target.startsWith("teryt") &&
      target.slice("teryt".length, "teryt".length + 4) === owner.teryt,
  );
  return inPowiat ? { id: owner.node_id } : null;
}

/** Whether writing `proposed` over `stored` would change anything.
 *
 * Only the fields the payload states are compared: `proposed` is already
 * layered over the stored document, so a field it does not mention is by
 * construction equal on both sides.
 */
function changes(
  stored: Record<string, unknown>,
  proposed: Record<string, unknown>,
): boolean {
  return Object.entries(proposed).some(
    ([key, value]) => JSON.stringify(stored[key]) !== JSON.stringify(value),
  );
}

type PlaceMatch = {
  ref: FirebaseFirestore.DocumentReference;
  publish: boolean;
  stored?: Record<string, unknown>;
};

/** The place node for a register number, creating one when there is none.
 *
 * `identifier` is a single-field equality match, which Firestore serves from
 * the single-field indexes it maintains by default - no composite index is
 * needed for either key.
 *
 * An existing node keeps the visibility it has, for the reason
 * `ingest/company` gives: a re-ingest must neither publish a company somebody
 * left pending nor hide one that is live. `publishNew` decides only what a
 * node created by this request starts as.
 */
async function findPlace(
  db: FirebaseFirestore.Firestore,
  identifier: { krsNumber: string } | { nipNumber: string },
  { publishNew = true }: { publishNew?: boolean } = {},
): Promise<PlaceMatch> {
  const [field, value] =
    "krsNumber" in identifier
      ? (["krsNumber", identifier.krsNumber] as const)
      : (["nipNumber", identifier.nipNumber] as const);
  const existing = await db
    .collection("nodes")
    .where(field, "==", value)
    .limit(1)
    .get();

  const doc = existing.docs[0];
  if (doc) {
    const stored = doc.data();
    return { ref: doc.ref, publish: pageIsPublic(stored), stored };
  }
  return { ref: db.collection("nodes").doc(), publish: publishNew };
}

/** Writes an edge, replacing whatever is stored under the same identity.
 *
 * Returns the ref and whether the document is new, which the caller reports so
 * a bulk run can be read as "how much of this was already here".
 *
 * Unlike `ingest/company`'s helper this does not skip an edge that exists.
 * There, an `owns` edge is the whole assertion and re-writing it would only
 * churn revisions; here the edge carries totals that the register revises, and
 * skipping would freeze them at whatever the first run saw.
 */
async function writeEdge(
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  user: { uid: string },
  {
    source,
    target,
    type,
    publish,
    fields = {},
  }: {
    source: string;
    target: string;
    type: "aid" | "owns";
    publish: boolean;
    fields?: Record<string, unknown>;
  },
) {
  const edgeData = { source, target, type, ...fields };
  const edgeRef = db.collection("edges").doc(edgeDocumentId(edgeData));
  const snapshot = await edgeRef.get();
  const stored = snapshot.exists ? snapshot.data() : undefined;

  createRevisionTransaction(db, batch, user, edgeRef, edgeData, {
    automatic: true,
    // An edge already on the site keeps its visibility, on the same terms as a
    // node: a reviewer who has not yet approved this link should not find it
    // published because the totals moved.
    approve: stored ? pageIsPublic(stored) : publish,
    stored,
    published: stored ? pageIsPublic(stored) : publish,
  });

  return { id: edgeRef.id, created: !stored };
}
