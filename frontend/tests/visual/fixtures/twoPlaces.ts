import type { GraphLayout } from "../../../shared/graph/util";
import type { Node, NodeStats } from "../../../shared/graph/model";
import { NODE_COLORS } from "../../../shared/graph/nodes";
import type { NodeRelation } from "../../../server/api/edges/byNode.get";

/** A person whose candidacies stand in two places in one election, for the
 * captures of what warns about it: the publish dialog's block and the
 * „dwa miejsca” chip on the person's own page (shared/twoPlaces.ts).
 *
 * Shaped like Jacek Wojciech Kowalski's page on 2026-10-14, whose publication
 * put a namesake's run live: a council career in powiat gnieźnieński, and one
 * 2002 run in powiat kozienicki that is somebody else's. The name is made up;
 * the places are real, because the rule reads their TERYT codes off the
 * region ids. Neither the seed nor any other capture has a candidacy, which
 * is why nothing in the suite drew either warning until these did. */

export const CLASH_PERSON = "visdwamiejsca";
const NAME = "Tomasz Przykładowy";

const run = (
  id: string,
  teryt: string,
  place: string,
  year: string,
): NodeRelation => ({
  id,
  type: "election",
  name: "kandydatura",
  direction: "outgoing",
  otherId: `teryt${teryt}`,
  otherName: place,
  otherPublished: true,
  published: false,
  startDate: `${year}-01-01`,
  position: "Samorząd",
  revisionToApprove: null,
  hasPendingRevision: false,
  publishable: true,
});

/** /api/edges/byNode for the draft page, in the order the endpoint sorts it:
 * by the far end, then newest first. */
export const twoPlacesRelations: NodeRelation[] = [
  run("visrungniezno2010", "3003", "Powiat gnieźnieński", "2010"),
  run("visrungniezno2006", "3003", "Powiat gnieźnieński", "2006"),
  run("visrungniezno2002", "3003", "Powiat gnieźnieński", "2002"),
  run("visrunkozienice2002", "1407", "Powiat kozienicki", "2002"),
  {
    id: "visseat",
    type: "employed",
    name: "Rada Nadzorcza",
    direction: "outgoing",
    otherId: "visszpital",
    otherName: "Szpital Przykładowy sp. z o.o.",
    otherPublished: true,
    published: false,
    startDate: "2024-10-31",
    position: null,
    revisionToApprove: null,
    hasPendingRevision: false,
    publishable: true,
  },
];

/** /api/revisions/byNode for the same page: one approved version, so the
 * dialog has nothing to say about which one goes live and the shot is about
 * the relations alone. */
export const twoPlacesRevisions = {
  revisions: [
    {
      id: "visdwamiejscarev",
      node_id: CLASH_PERSON,
      collection: "nodes",
      status: "approved",
      update_time: "2026-08-30T09:00:00.000Z",
      update_automatic: true,
      update_user: "pipeline",
      data: { name: NAME, type: "person" },
    },
  ],
  approvedRevisionId: "visdwamiejscarev",
  published: false,
  exists: true,
};

const stats: NodeStats = { people: 1 };

function region(id: string, name: string): Node & { stats: NodeStats } {
  return {
    id,
    name,
    entityType: "region",
    type: "document",
    color: NODE_COLORS.region,
    visibility: true,
    stats,
  };
}

/** /api/graph/local/[id] for a published person page wearing the same
 * career, after publication: the 2002 run in powiat gnieźnieński is live and
 * the one in powiat kozienicki is still a draft - the row whose own
 * „Opublikuj” would complete the clash. Dated the way the live API dates a
 * candidacy (`edgeFromDB`): the election day, as both start and end. */
export function twoPlacesGraph(subjectId: string): GraphLayout {
  const candidacy = (
    id: string,
    target: string,
    day: string,
    visibility: boolean,
  ) => ({
    id,
    source: subjectId,
    target,
    type: "election" as const,
    name: "kandydatura",
    position: "Samorząd" as const,
    start_date: day,
    end_date: day,
    visibility,
  });

  return {
    nodes: {
      [subjectId]: {
        id: subjectId,
        name: NAME,
        entityType: "person",
        type: "circle",
        color: NODE_COLORS.person,
        visibility: true,
        stats,
      },
      teryt3003: region("teryt3003", "Powiat gnieźnieński"),
      teryt1407: region("teryt1407", "Powiat kozienicki"),
    },
    edges: [
      candidacy("visrungniezno2006", "teryt3003", "2006-11-12", true),
      candidacy("visrungniezno2002", "teryt3003", "2002-10-27", true),
      candidacy("visrunkozienice2002", "teryt1407", "2002-10-27", false),
    ],
    nodeGroups: [],
  };
}
