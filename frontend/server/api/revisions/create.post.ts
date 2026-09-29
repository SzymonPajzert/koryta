import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import {
  baseNodeFields,
  createRevisionTransaction,
  withoutInternalFields,
  proposalId,
  sameStoredValue,
  sanitizeFirestoreData,
  withSeededNodeStats,
} from "~~/server/utils/revisions";
import { revisionIsPending } from "~~/shared/model";
import {
  editSchemas,
  proposableNodeTypes,
  removalSchema,
  type ProposableNodeType,
} from "~~/shared/api";

export type RevisionCreated = {
  /** The revision this wrote - or, for a restatement, the one already
   * waiting. */
  id: string;
  node_id: string;
  /** The proposal was already on the table, so nothing new was filed and `id`
   * is the one waiting. */
  duplicate: boolean;
  /** Written approved and put on the page, rather than left for a reviewer.
   * Only ever true where the caller asked with `apply` and holds the admin
   * claim. */
  applied: boolean;
};

export default defineEventHandler(async (event): Promise<RevisionCreated> => {
  const rawBody = await readBody(event);
  const node_id =
    typeof rawBody.node_id === "string" ? rawBody.node_id : undefined;

  // Without a node_id the user proposes a brand new node instead of a change
  // to an existing one.
  const isNewNode = !node_id;

  const user = await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const nodeRef = isNewNode
    ? db.collection("nodes").doc()
    : db.collection("nodes").doc(node_id);
  const timestamp = Timestamp.now();

  // An admin asking for their edit to go live - see `apply` below. Known
  // before anything is read, because that path needs the whole stored
  // document and not only the layering base, and one read serves both.
  const wantsApply =
    rawBody.apply === true && !isNewNode && user.admin === true;
  const storedSnapshot = wantsApply ? await nodeRef.get() : undefined;

  // Fetch the existing node to use as a base layer so that the revision
  // contains a complete snapshot (type, wikipedia, rejestrIo, etc.).
  const baseFields: Record<string, unknown> = isNewNode
    ? { type: proposableType(rawBody) }
    : storedSnapshot
      ? withoutInternalFields(storedSnapshot.data() ?? {})
      : await baseNodeFields(nodeRef);

  // Which fields are on offer depends on what is being edited: a place takes a
  // KRS number and an ownership answer, a person a party and its source links,
  // an article the URL it lives at. Parsing against the schema also strips
  // anything not explicitly allowed, so a caller can't smuggle in e.g.
  // `revision_id` and have it written straight to the node below.
  const schema = editSchemas[proposableType(baseFields)];

  // A removal is a revision that changes no field but says the entry should
  // go. It is reviewed like any other, so its reason travels with it rather
  // than being stripped by the edit schema as it was until now.
  const removal = isNewNode ? undefined : removalSchema.safeParse(rawBody).data;

  let dataFields: Record<string, unknown>;
  if (removal) {
    dataFields = { ...removal };
  } else {
    const parsed = schema.safeParse(rawBody);
    if (!parsed.success) {
      throw createError({
        statusCode: 400,
        message: parsed.error.issues[0]?.message || "Invalid request body",
        data: parsed.error.issues,
      });
    }
    dataFields = { ...parsed.data };

    // A person answering the ownership question outranks the scrapers, which
    // cannot see it for a spółka akcyjna and have nothing to read for an
    // institution outside KRS. The marker is what `ingest/company` checks
    // before writing its own guess over this one.
    if (dataFields.isPublic !== undefined) {
      dataFields.isPublicSource = "manual";
    }

    // Categories work the same way, and for the same reason: the pipelines
    // derive a default from the company's KRS entry, but a register code says
    // what a company does rather than what sector it is in - a quarry declares
    // rail freight because it owns a siding - so a reader who can see the
    // difference outranks them. Checked against `undefined` rather than for
    // truthiness: an empty array is a person saying "none of these", and it
    // has to pin the field just as firmly as a non-empty one.
    if (dataFields.categories !== undefined) {
      dataFields.categoriesSource = "manual";
    }

    // A person's parties, on the same terms. `ingest/person` unions what it
    // was handed into what is stored, so without this a removal is undone by
    // the next run - SLD came back onto a published page 59 minutes after a
    // reviewer took it off. `undefined` rather than truthiness again: an empty
    // array is somebody saying "no party", and it has to pin the field as
    // firmly as a list does.
    if (dataFields.parties !== undefined) {
      dataFields.partiesSource = "manual";
    }

    // A company's name, on the same terms, so that `ingest/company` does not
    // put the register's capitals back over it. Only when the proposal changes
    // the name, though: the form always sends one, so stamping every proposal
    // that states it would pin the register's spelling on every page anybody
    // has corrected anything on, and a company renamed in KRS would never be
    // renamed here. A page a person creates is named by them.
    if (
      proposableType(baseFields) === "place" &&
      typeof dataFields.name === "string" &&
      dataFields.name !== baseFields.name
    ) {
      dataFields.nameSource = "manual";
    }
  }

  // User-submitted fields override the base node fields. Sanitized here rather
  // than on the way into the document, because the two guards below compare it
  // against what is stored, and stored data has already been through this.
  const mergedData = sanitizeFirestoreData({
    ...baseFields,
    ...dataFields,
  }) as Record<string, unknown>;

  // Nothing to review. The form arrives prefilled from the entry, so
  // "Zaproponuj" pressed after changing nothing - or after changing something
  // back - files a revision that says exactly what the page already says, and
  // a reviewer only finds that out by opening it.
  //
  // An empty string counts as no value: the form sends every field it shows,
  // so a „Treść” left empty on a page that never had one arrived as
  // `content: ""` and read as a change - and for an admin applying it, wrote an
  // approved revision that changed nothing a reader could see.
  if (
    !isNewNode &&
    sameStoredValue(
      withoutEmptyStrings(mergedData),
      withoutEmptyStrings(sanitizeFirestoreData(baseFields)),
    )
  ) {
    throw createError({
      statusCode: 400,
      message: "Ta propozycja niczego nie zmienia - wpis już to zawiera.",
    });
  }

  // An admin's edit is its own review, which is how `/api/edges/update` already
  // settles a correction to a relation. Filed as a proposal, it only sent them
  // to /admin/rewizje to approve their own words - and a topic, whose page
  // offered no way to edit it at all, got its description corrected in the
  // database by hand instead. So an admin who asks, with `apply`, has the
  // revision written approved and the page rewritten from it in one commit.
  //
  // Asked for rather than read off the claim: every other page that opens the
  // propose dialog tells its reader the change will be reviewed, and it is up
  // to each page to say otherwise. Anybody without the claim who sends the
  // flag gets exactly what they would have got without it - a proposal. Never
  // for a new entry, whose review is its publication, nor for a removal, which
  // takes the page away and is decided in the queue.
  const apply = wantsApply && !removal;
  if (apply && storedSnapshot) {
    // The whole document rather than the layering base above: what a node
    // owns instead of states - its counters, its votes, whether it is live -
    // has to be written back around the revision, see `nodeOwnedFields`.
    const snapshot = storedSnapshot;
    // And only a page that is there, as /api/edges/update insists for a
    // relation. Written approved, an id nothing stores would become a page
    // nobody reviewed, and a removed one would be rewritten under its
    // tombstone.
    if (!snapshot.exists) {
      throw createError({
        statusCode: 404,
        message: `Nie ma wpisu o id: ${nodeRef.id}`,
      });
    }
    const stored = snapshot.data() ?? {};
    if (stored.deleted === true) {
      throw createError({
        statusCode: 409,
        message: "Ten wpis został usunięty i nie da się go już zmienić.",
      });
    }
    const batch = db.batch();
    const { revisionRef } = createRevisionTransaction(
      db,
      batch,
      user,
      nodeRef,
      mergedData,
      // `published` carried, not decided, as in `/api/edges/update`: rewording
      // a live page must not take it off the site, nor rewording a draft
      // publish it.
      { stored, approve: true, published: stored.published === true },
    );
    await batch.commit();

    // The clear every editor write path makes, so that whatever replaces it
    // there replaces it here too. As it stands it removes nothing - unstorage's
    // `clear(base)` only visits mounts below `base`, and the cache is mounted
    // above `nitro:handlers` - so a logged out reader is served the cached
    // answer until it expires. The admin sees the change at once either way:
    // a signed in reader asks with `?latest=true`, which reads through.
    await useStorage("cache").clear("nitro:handlers");

    return {
      id: revisionRef.id,
      node_id: nodeRef.id,
      duplicate: false,
      applied: true,
    };
  }

  // A proposal is addressed by what it proposes, the way the pipeline's are -
  // see `proposeRevisionTransaction`. Nothing on an entry's page showed a
  // contributor the change they had just made, so they made it again, and the
  // queue filled up with copies of one correction. The uid is part of the
  // address because two people proposing the same fix are two proposals, and
  // folding those together would credit one of them to the other.
  const restatementRef = isNewNode
    ? undefined
    : db
        .collection("revisions")
        .doc(proposalId(`${nodeRef.id}_${user.uid}`, mergedData));
  const restated = await restatementRef?.get();

  if (restated?.exists && revisionIsPending(restated.data() ?? {})) {
    // Idempotent rather than an error: what the caller is asking for is on the
    // table already, and handing back its id is what lets the page link them
    // to the proposal they had forgotten making.
    return {
      id: restated.id,
      node_id: nodeRef.id,
      duplicate: true,
      applied: false,
    };
  }

  // Already decided, so that record stays where it is and the restatement gets
  // a document of its own: a rejected proposal sent again unchanged is a
  // second ask, not an edit of the first.
  const revisionRef =
    restatementRef && !restated?.exists
      ? restatementRef
      : db.collection("revisions").doc();

  const revision = {
    node_id: nodeRef.id,
    collection: "nodes",
    data: mergedData,
    update_time: timestamp,
    update_user: user.uid,
    update_automatic: false,
    status: "pending",
  };

  const batch = db.batch();
  batch.set(revisionRef, revision);
  if (isNewNode) {
    // Create the node itself so the proposal gets an id and can be linked to,
    // voted on and edited further. Written without a `revision_id`, so nothing
    // is approved to show, and with `published: false` said out loud: now that
    // the backfill has run, every document carries the field, and a proposal
    // that left it absent would be the only place the old ambiguity survived.
    // `stats` is seeded for the same reason, and it is not cosmetic:
    // /api/search sorts on `stats.nodeGroupSize`, and Firestore's orderBy drops
    // any document that does not carry the field at all. See
    // `withSeededNodeStats`, which is where every other node-creating path gets
    // the same treatment.
    batch.set(
      nodeRef,
      withSeededNodeStats({
        ...(revision.data as Record<string, unknown>),
        published: false,
      }),
    );
  }
  await batch.commit();

  return {
    id: revisionRef.id,
    node_id: nodeRef.id,
    duplicate: false,
    applied: false,
  };
});

/** The kind of node a proposal is for, out of the kinds anyone may propose.
 *
 * Until this was read, every new entry was written as a person whatever the
 * form said - so a proposed company lost its KRS number to `personEditSchema`
 * and turned up in the database as a politician. An unknown or missing type
 * still means a person, which is what the great majority of entries are. That
 * also covers an edit to a stored node of a kind nobody proposes: a region has
 * no form of its own, so its editable fields are a person's.
 */
function proposableType(source: { type?: unknown }): ProposableNodeType {
  const type = source.type;
  return proposableNodeTypes.includes(type as ProposableNodeType)
    ? (type as ProposableNodeType)
    : "person";
}

/** A document's top-level fields without the empty strings, for comparing what
 * a form sent against what is stored: an empty field and an absent one say the
 * same thing to a reader. */
function withoutEmptyStrings(
  data: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== ""),
  );
}
