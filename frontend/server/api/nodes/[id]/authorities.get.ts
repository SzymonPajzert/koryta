import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getQuery, getRouterParam, type H3Event } from "h3";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { importedOrReviewed } from "~~/server/utils/provenance";
import { fetchNodesByIds } from "~~/server/utils/fetch";
import { asArray, pageIsPublic } from "~~/shared/model";
import type {
  GovernmentHead,
  GovernmentPerson,
  RegionGovernment,
} from "~~/shared/model";
import type {
  GovernmentPersonView,
  GovernmentView,
} from "~~/shared/regionAuthorities";

/** A node as `fetchNodesByIds` hands it over, before anything has said what
 * it is: a `personId` on the record is anybody's to point at anything. */
type LinkedNode = {
  id: string;
  type?: string;
  name?: string;
  parties?: string[];
  published?: unknown;
  deleted?: unknown;
  revision_id?: unknown;
};

/** The page a person on the record links to, as this reader may follow it:
 * every page for a signed in reader, with its parties; for anybody else a
 * published page, or an unpublished one an import wrote or a reviewer passed
 * (`importedOrReviewed`), which opens as its teaser and keeps its party back -
 * as a company's board and the election lists name a draft. A page a person
 * made by hand and nobody has checked is not linked at all: the name stands as
 * PKW gives it, and nothing says there is a page. */
type Linker = (person: GovernmentPerson) => GovernmentPersonView["page"];

async function linker(
  db: FirebaseFirestore.Firestore,
  record: RegionGovernment,
  showUnapproved: boolean,
): Promise<Linker> {
  const people = [
    ...(record.head ? [record.head] : []),
    ...asArray(record.councils).flatMap((council) => asArray(council.members)),
  ];
  const ids = people.flatMap((person) =>
    person.personId ? [person.personId] : [],
  );
  const nodes = new Map<string, LinkedNode>();
  for (const node of (await fetchNodesByIds(ids)) as LinkedNode[]) {
    if (node.type === "person" && node.deleted !== true && node.name) {
      nodes.set(node.id, node);
    }
  }
  const drafts = showUnapproved
    ? []
    : [...nodes.values()].filter((node) => !pageIsPublic(node));
  const passed = drafts.length
    ? await importedOrReviewed(db, drafts)
    : new Set<string>();

  return (person) => {
    const node = person.personId ? nodes.get(person.personId) : undefined;
    if (!node) return undefined;
    const parties = asArray(node.parties);
    if (showUnapproved) {
      return { id: node.id, published: pageIsPublic(node), parties };
    }
    if (pageIsPublic(node)) return { id: node.id, published: true, parties };
    if (!passed.has(node.id)) return undefined;
    return {
      id: node.id,
      published: false,
      parties: [],
      ...(parties.length > 0 ? { partyHidden: true } : {}),
    };
  };
}

/** The record as served: no `personId` (the page link carries it where this
 * reader may follow it) and nothing the record does not say. */
function personView(
  person: GovernmentPerson,
  link: Linker,
): GovernmentPersonView {
  const page = link(person);
  return {
    name: person.name,
    ...(person.committee ? { committee: person.committee } : {}),
    ...(person.committeeParties?.length
      ? { committeeParties: asArray(person.committeeParties) }
      : {}),
    ...(page ? { page } : {}),
  };
}

/** Which record this reader is shown. A signed in reader sees the region as
 * `/api/nodes/[id]` serves it to them - its newest revision, or the one a
 * `?revisionId=` link previews - so a proposed change reads on the page the
 * way a proposed name does. Anybody else sees the stored record. */
async function recordFor(
  event: H3Event,
  db: FirebaseFirestore.Firestore,
  id: string,
  stored: RegionGovernment | undefined,
  showUnapproved: boolean,
): Promise<RegionGovernment | undefined> {
  if (!showUnapproved) return stored;
  const revisionId = getQuery(event).revisionId;
  if (typeof revisionId === "string" && revisionId) {
    const revision = (
      await db.collection("revisions").doc(revisionId).get()
    ).data();
    if (revision?.node_id === id) {
      return (
        (revision.data?.authorities as RegionGovernment | undefined) ?? stored
      );
    }
  }
  const newest = await db
    .collection("revisions")
    .where("node_id", "==", id)
    .orderBy("update_time", "desc")
    .limit(1)
    .get();
  const data = newest.docs[0]?.data().data as
    { authorities?: RegionGovernment } | undefined;
  return data ? data.authorities : stored;
}

/** A region's „Władze” (`Region.authorities`), as this reader may see it:
 * every name the record holds, each person's page linked where this reader
 * may open it. Null for a node that is no region, a region nobody may open,
 * and a region with no record. */
async function authorities(event: H3Event): Promise<GovernmentView | null> {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Missing id" });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const showUnapproved = await wantsLatest(event);

  const region = (await db.collection("nodes").doc(id).get()).data() as
    | {
        type?: string;
        published?: unknown;
        deleted?: unknown;
        authorities?: RegionGovernment;
      }
    | undefined;
  if (
    !region ||
    region.type !== "region" ||
    (!showUnapproved && !pageIsPublic(region))
  ) {
    return null;
  }

  const record = await recordFor(
    event,
    db,
    id,
    region.authorities,
    showUnapproved,
  );
  if (!record) return null;

  const link = await linker(db, record, showUnapproved);
  const head: GovernmentHead | undefined = record.head;
  return {
    ...(record.election ? { election: record.election } : {}),
    ...(head
      ? {
          head: {
            ...personView(head, link),
            office: head.office,
            ...(head.member ? { member: head.member } : {}),
            ...(head.since ? { since: head.since } : {}),
          },
        }
      : {}),
    councils: asArray(record.councils).map((council) => ({
      office: council.office,
      ...(typeof council.seats === "number" ? { seats: council.seats } : {}),
      members: asArray(council.members).map((member) =>
        personView(member, link),
      ),
    })),
  };
}

/** Six hours, the site default: a council changes once in five years, and a
 * signed in reader - who may have just proposed a change - reads through the
 * cache anyway. */
export default editorFreshCachedEventHandler(authorities, {
  name: "region-authorities",
});
