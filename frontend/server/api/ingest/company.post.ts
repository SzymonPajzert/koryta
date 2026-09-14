import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import {
  createRevisionTransaction,
  revisionChangesNothing,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import {
  companyRequestSchema,
  type CompanyRequest as Request,
} from "#shared/api";
import { pageIsPublic, type EdgeType } from "#shared/model";
import { edgeDocumentId, findEdge } from "~~/server/utils/edges";

/** The site's „Skarb Państwa" node.
 *
 * A Firestore document id in the source, which is not something to do lightly -
 * but it is the only handle this node has. The Treasury is not in KRS, so it
 * has no `krsNumber`; it is not a territory, so it has no `teryt`; and matching
 * on the name would silently stop linking the day somebody renames it, which is
 * exactly the failure this is meant to end. The id cannot change: it is what
 * every `owns` edge already stored against it points at.
 *
 * Hardcoded on this side of the wire rather than sent in the payload, because a
 * document id is the site's business and the pipelines have no way to know it.
 * `entities.company_bodies` and `scrapers.map.jst` name the Treasury with a
 * sentinel instead, and `owner_skarb_panstwa` carries it here.
 */
export const SKARB_PANSTWA_NODE_ID = "qMsAXmM5nDGNdUqmQpWR";

export default defineEventHandler(async (event) => {
  console.info("Handling ingest/company.post");
  const body: Request = await readValidatedBody(event, (body) =>
    companyRequestSchema.parse(body),
  );
  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const {
    ref: nodeRef,
    publish,
    stored,
  } = await findCompanyByKRS(db, body.krs, true);
  // Layered over what is already stored: a payload carries only the fields the
  // scrapers found, and the revision is written to the node wholesale. Taken
  // from the document the KRS lookup has already read, rather than asking for
  // it a second time.
  const revisionData: Record<string, unknown> = {
    ...withoutInternalFields(stored ?? {}),
    name: body.name,
    type: "place",
    krsNumber: body.krs,
  };
  if (body.activity && body.activity.length > 0) {
    revisionData.activity = body.activity;
  }
  // The identifiers every register of public spending keys on. KRS is what this
  // site looks a company up by and it is the one number CRU does not carry, so
  // without these a contract has no way to reach the company that signed it -
  // see `shared/contracts.ts` and `scripts/migrate/backfill-company-nip.ts`,
  // which supplied them for the 4,701 companies that were already here.
  //
  // Written like `supervisoryOrgan` above and for the same reason: the register
  // is the answer, so there is no human value to protect, but the revision is
  // written to the node wholesale and a payload from a pipeline that predates
  // the field has to leave what is stored alone rather than clear it. The zod
  // schema has already normalised these to bare digits and checked their check
  // digit - a wrong NIP here would silently attach another company's contracts
  // to this one, which is the one failure this feature cannot have.
  if (body.nip) revisionData.nipNumber = body.nip;
  if (body.regon) revisionData.regonNumber = body.regon;
  // Worked out by the pipelines rather than here - see
  // `data/pipelines/src/entities/company_categories.py`. An empty array is a
  // real answer ("this company is in no sector we track") and is written; an
  // absent one means the payload did not compute categories at all and leaves
  // whatever is stored alone.
  //
  // A human answer wins permanently, on the same terms as `isPublic` below:
  // the pipelines see PKD codes, and a code is a claim about activity, not
  // about a sector.
  if (
    body.categories !== undefined &&
    revisionData.categoriesSource !== "manual"
  ) {
    revisionData.categories = body.categories;
  }
  // Which organ supervises the company, on the same terms as `categories`: an
  // empty string is a real answer and an absent one leaves the stored value
  // alone. No `...Source: "manual"` escape hatch, unlike `categories` and
  // `isPublic` below - those exist because a person can know something the
  // register cannot show, and here the register *is* the answer. The value
  // follows from `formaPrawna`, so a wrong one is a bug in
  // `entities/company_bodies.py` rather than something to correct per company.
  //
  // Cleared rather than stored as "": absent is what every ordinary company
  // says, so writing an empty marker onto 3,900 nodes would be a field that
  // means nothing on all but 103 of them.
  if (body.supervisory_body !== undefined) {
    if (body.supervisory_body === "") {
      delete revisionData.supervisoryBody;
    } else {
      revisionData.supervisoryBody = body.supervisory_body;
    }
  }
  // `formaPrawna` verbatim, for display beside a hospital's board on
  // /eksploruj/szpitale. Nothing on the site reads it and decides anything -
  // what follows from the form about pay is `supervisoryBody` above, and about
  // sector is `categories`, both worked out by the pipelines.
  if (body.legal_form) revisionData.legalForm = body.legal_form;
  // The organ the register itself names, as opposed to the one the form
  // implies. Reported, never used as a rule: it is "brak" for most SPZOZ,
  // whose rada społeczna is created by statute and never filed, so it can say
  // a board is unpaid but never that one is paid. See `shared/companyOrgans.ts`
  // for why that keeps it separate from `supervisoryBody`.
  //
  // No "a human answer wins" guard, unlike `isPublic` below, and the
  // difference is where the value comes from. Ownership is something the
  // scrapers *infer* and often cannot see at all, so a human's answer has to
  // outrank theirs. The supervisory organ is something KRS publishes outright
  // and the scrapers only transcribe: there is no form on the site that writes
  // one, so there is no human answer to protect, and if the register is wrong
  // the fix belongs in the register.
  //
  // What it does need is the presence check every ingest field needs: the
  // revision is written to the node wholesale, so a payload from a pipeline
  // that predates the field must leave what is stored alone rather than clear
  // it.
  if (body.supervisory_organ)
    revisionData.supervisoryOrgan = body.supervisory_organ;
  // A human answer wins. KRS cannot see who owns a spółka akcyjna, so the
  // scrapers' `false` is "no evidence" rather than "privately owned", and
  // re-running an ingest must not undo somebody who knew better.
  if (
    body.is_public !== undefined &&
    revisionData.isPublicSource !== "manual"
  ) {
    revisionData.isPublic = body.is_public;
  }

  const batch = db.batch();
  // `CompaniesPayloads` re-submits every company the site already has, and most
  // runs learn nothing about most of them - the register has not moved, and the
  // categories are worked out from codes that have not moved either. Layered
  // over what is stored, such a payload produces a revision word for word the
  // same as the one the node already carries, and writing it cost a revision
  // document and a rewrite of the node per company per run. See
  // `revisionChangesNothing`, which also refuses to skip where the write would
  // repair something.
  const options = {
    automatic: true,
    approve: publish,
    stored,
    published: publish,
  };
  const changed = !revisionChangesNothing(nodeRef, revisionData, options);
  if (changed) {
    createRevisionTransaction(db, batch, user, nodeRef, revisionData, options);
  }

  const dbb = { db, batch, user, added: new Set<string>() };

  // Who holds shares, per dział 1 of the register. A company owner is looked up
  // by KRS; a gmina, powiat or województwo has no KRS and arrives as the TERYT
  // code its register name was resolved to.
  let unknownOwners = 0;
  if (body.owners && Array.isArray(body.owners)) {
    for (const parent of body.owners) {
      if (!parent) continue;
      let parentRef;
      try {
        ({ ref: parentRef } = await findCompanyByKRS(db, parent, false));
      } catch {
        // The register names 238 companies as shareholders that koryta.pl does
        // not track. `findCompanyByKRS` throws a 404 for those, and the throw
        // used to escape the handler - so a company whose parent is missing was
        // rejected whole, losing its categories and its seat along with the one
        // edge that could not be drawn. 266 of 3,928 in a real run.
        //
        // Skipped rather than created: minting a place node as a side effect of
        // an ownership edge would add those 238 companies to the site, and that
        // is a decision about what the site covers, not about this request.
        console.warn(
          `Owner KRS ${parent} is not on the site (krs=${body.krs}), skipping the edge`,
        );
        unknownOwners += 1;
        continue;
      }
      await createEdge(dbb, parentRef.id, nodeRef.id, "owns", publish);
    }
  }
  // The Treasury. It owns 110 of the companies the register describes and it is
  // the one owner that can only be named by a node id: it has no KRS number -
  // it is not in the register - and it is not a territory, so there is no TERYT
  // to resolve either. The pipeline therefore sends a flag and the id lives
  // here, on the side of the wire that already deals in node ids.
  if (body.owner_skarb_panstwa) {
    // Checked rather than assumed. The id is stable on production, but a local
    // stack seeded by `scripts/seed-emulator.ts` has no such node, and an edge
    // pointing at a document that does not exist is worse than no edge: it
    // draws on the graph as a nameless dot and `computeNodes` folds it into
    // every employee's `targetNodeIds`.
    const treasury = await db
      .collection("nodes")
      .doc(SKARB_PANSTWA_NODE_ID)
      .get();
    if (treasury.exists) {
      await createEdge(dbb, SKARB_PANSTWA_NODE_ID, nodeRef.id, "owns", publish);
    } else {
      console.warn(
        `No „Skarb Państwa" node (${SKARB_PANSTWA_NODE_ID}); skipping the Treasury owner edge for krs=${body.krs}`,
      );
    }
  }
  if (body.owner_teryts && Array.isArray(body.owner_teryts)) {
    for (const owner of body.owner_teryts) {
      if (!owner) continue;
      const regionNodeId = await findRegionByTeryt(db, owner);
      if (!regionNodeId) {
        // 985 gminy have a region node because they own something; a code that
        // resolves to no node is one the region ingest has not reached yet.
        // Reported rather than fatal, the same way an unknown seat is.
        console.warn(
          `No region node for owner TERYT ${owner} (krs=${body.krs})`,
        );
        continue;
      }
      await createEdge(dbb, regionNodeId, nodeRef.id, "owns", publish);
    }
  }

  // Where the company is registered. A `seat` edge, not an `owns` one: until
  // the register's shareholder lists were ingested the two were the same type
  // and it did not matter, but a region now points at both the companies seated
  // in it and the ones it holds shares in, and only one of those says where a
  // company is.
  let region: "added" | "existing" | "unknown" | undefined;
  if (body.teryt) {
    const regionNodeId = await findRegionByTeryt(db, body.teryt);
    if (regionNodeId) {
      // A company has one registered seat, so a second one from a different
      // region is not a second fact - it is a disagreement. 13 companies on the
      // site have one: their stored seat predates the current register and is
      // simply wrong (ELZAT of Mikołów is filed under Tarnów, Centrum Medyczne
      // Żelazna of Warsaw under Olsztyn), and the register now resolves them
      // correctly.
      //
      // The correct one is reported and NOT written, rather than the stale one
      // being deleted. Deleting takes an edge's revisions with it, and
      // `functions/src/revisions.ts` creates a typeless phantom node under the
      // edge's id when the last revision for it goes - so a fix for 13 rows
      // would introduce a worse problem. They need a hand, or a migration that
      // knows about revisions; either way not silently, in an ingest.
      const conflicting = await findSeatFromAnotherRegion(
        db,
        nodeRef.id,
        regionNodeId,
      );
      if (conflicting) {
        console.warn(
          `Company krs=${body.krs} is already seated in ${conflicting}; the register says ${regionNodeId}. Leaving the stored seat alone.`,
        );
        region = "existing";
      } else {
        const added = await createEdge(
          dbb,
          regionNodeId,
          nodeRef.id,
          "seat",
          publish,
        );
        region = added ? "added" : "existing";
      }
    } else {
      // A company whose registered seat has no region node is still worth
      // ingesting for its other fields, so this is reported, not fatal.
      console.warn(
        `No region node for TERYT ${body.teryt} (krs=${body.krs}), skipping location`,
      );
      region = "unknown";
    }
  }

  await batch.commit();

  // What the request did to the company itself, so a caller submitting a few
  // thousand of them can tell a run that changed nothing from one that did -
  // the edges are reported separately, and a company can be left alone while a
  // location edge is added beside it.
  const company = !stored ? "created" : changed ? "updated" : "unchanged";

  // `unknownOwners` is reported rather than merely counted: a run in which it
  // jumps is a run where the register started naming shareholders the site does
  // not track, and the per-owner warnings above are one line each in a log of
  // 3,928 uploads. Omitted when nought, so the ordinary response is unchanged.
  return {
    id: nodeRef.id,
    code: 200,
    region,
    company,
    ...(unknownOwners > 0 ? { unknownOwners } : {}),
  };
});

type DBB = {
  db: FirebaseFirestore.Firestore;
  batch: FirebaseFirestore.WriteBatch;
  user: { uid: string };
  /** Edge ids already added to this request's batch, so a payload listing the
   * same owner twice does not write the link - and a second revision of it -
   * twice over. A lookup cannot catch that: the batch is not committed yet. */
  added: Set<string>;
};

/** Links two nodes, at most once.
 *
 * The edge id is derived from what the edge represents, matching the scheme the
 * region pipeline already uses (`edge_<source>_<target>_<type>`), so re-running
 * an ingest cannot create a second copy of the same link. Edges written before
 * this carried random ids, so an existing link is looked up by its fields
 * rather than by id - an equality-only query, which Firestore serves by merging
 * single field indexes.
 *
 * Returns whether a new edge was added to the batch.
 */
async function createEdge(
  dbb: DBB,
  source: string,
  target: string,
  type: EdgeType,
  publish: boolean,
): Promise<boolean> {
  const { db, batch, user, added } = dbb;
  const edgeData = { source, target, type };

  const edgeId = edgeDocumentId(edgeData);
  if (added.has(edgeId)) {
    return false;
  }
  if (await findEdge(db, edgeData)) {
    return false;
  }
  // A seat that predates the `owns`/`seat` split is stored as `owns`, and
  // `scripts/migrate/split-seat-edges.ts` will retype it. Until that has run
  // the pair already carries the fact, so writing a `seat` edge beside it would
  // give 3,939 companies two seats - and the ingest runs nightly, so it would
  // win the race against the migration. Left alone rather than retyped here:
  // retyping is the migration's job, and it has the revisions to move too.
  if (
    type === "seat" &&
    (await findEdge(db, { source, target, type: "owns" }))
  ) {
    return false;
  }
  added.add(edgeId);

  const edgeRef = db.collection("edges").doc(edgeId);
  // Only reached when no such edge exists, so there is nothing stored to carry.
  createRevisionTransaction(db, batch, user, edgeRef, edgeData, {
    automatic: true,
    approve: publish,
    published: publish,
  });
  return true;
}

/** Locate the company node for a KRS number.
 *
 * `publish` tells the caller whether the new revision should be approved and
 * published. To keep a migration safe, an existing company keeps its current
 * visibility: an already-public company stays public, while a still-pending
 * one is not force-published by a re-ingest. A brand-new company is published
 * as before.
 *
 * `stored` is the document as it is now, and is undefined for a company being
 * created. The caller needs it twice over - as the base the payload's fields
 * are layered onto, and as the state to carry through the `set` that writes the
 * revision - and this query has already read it, so returning it saves a second
 * read of every company in the pipeline. */
async function findCompanyByKRS(
  db: FirebaseFirestore.Firestore,
  krs: string,
  createNew: boolean,
): Promise<{
  ref: FirebaseFirestore.DocumentReference;
  publish: boolean;
  stored?: Record<string, unknown>;
}> {
  // Check if company already exists
  const existingQuery = await db
    .collection("nodes")
    .where("krsNumber", "==", krs)
    .limit(1)
    .get();

  if (!existingQuery.empty) {
    const doc = existingQuery.docs[0];
    if (!doc) {
      throw new Error("Unexpected empty docs array");
    }
    const stored = doc.data();
    return { ref: doc.ref, publish: pageIsPublic(stored), stored };
  } else if (createNew) {
    return { ref: db.collection("nodes").doc(), publish: true };
  } else {
    throw createError({
      statusCode: 404,
      message: `Company with KRS ${krs} not found`,
    });
  }
}

/** Region node for a company's TERYT code, or null when there is none.
 *
 * Codes longer than a powiat are truncated to one, which is the level the
 * region nodes are complete at. Returns null rather than throwing so a bulk
 * ingest is not aborted by a single unmappable seat. */
/** The region already recorded as this company's seat, if it is a different one.
 *
 * Returns null when there is no seat yet or when the stored seat is the region
 * about to be written - the ordinary case, which `createEdge` then skips on its
 * own.
 */
async function findSeatFromAnotherRegion(
  db: FirebaseFirestore.Firestore,
  placeId: string,
  regionNodeId: string,
): Promise<string | null> {
  const snapshot = await db
    .collection("edges")
    .where("target", "==", placeId)
    .where("type", "==", "seat")
    .get();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    // A seat somebody has removed through /api/edges/delete is not a competing
    // claim - it is one an admin has already ruled on. Without this the ingest
    // would keep refusing to write the correct seat on the strength of a
    // relation that is no longer on the graph.
    if (data.deleted === true) continue;
    if (data.source && data.source !== regionNodeId) {
      return data.source as string;
    }
  }
  return null;
}

async function findRegionByTeryt(
  db: FirebaseFirestore.Firestore,
  terytArg: string,
): Promise<string | null> {
  // The exact code first, then the powiat above it. Which one answers depends
  // on where the code came from, and both callers are real:
  //
  //   an owner TERYT is resolved from the register by `scrapers.map.jst` and is
  //     exact - 7 characters for a gmina, and 706 gminy have a node precisely
  //     because they own something. Truncating it to 4 would file every gmina
  //     shareholder under its powiat and collapse the co-owners of a company
  //     back into one, which is the bug the resolver exists to fix.
  //
  //   a seat TERYT comes from `get_teryt`, which reads geonames, and that
  //     column is six digits: WOJ+POW+GMI with no RODZ. It therefore matches no
  //     node at all - `Regions` mints gminy as WOJ+POW+GMI+RODZ - and falls
  //     through to the powiat, which is where the site records a seat anyway.
  const candidates =
    terytArg.length > 4 ? [terytArg, terytArg.slice(0, 4)] : [terytArg];
  for (const teryt of candidates) {
    const regionNodeId = `teryt${teryt}`;
    if ((await db.collection("nodes").doc(regionNodeId).get()).exists) {
      return regionNodeId;
    }
    const snapshot = await db
      .collection("nodes")
      .where("teryt", "==", teryt)
      .limit(1)
      .get();
    if (!snapshot.empty && snapshot.docs[0]) {
      return snapshot.docs[0].id;
    }
  }

  return null;
}
