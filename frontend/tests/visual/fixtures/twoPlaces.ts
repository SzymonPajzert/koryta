import type { GraphLayout } from "../../../shared/graph/util";
import type { Node, NodeStats } from "../../../shared/graph/model";
import type { ElectionPosition } from "../../../shared/model";
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
 * is why nothing in the suite drew either warning until these did.
 *
 * Since the warning reads the election rather than the office (2026-10-30),
 * the page also has one of each pair the office key let through, each after a
 * real page: a Senat run beside a namesake's Sejm run in another województwo
 * (Łukasz Mikołajczyk, 2015), a sejmik run beside a city council run in
 * powiat kutnowski (Anna Majchrzak, 2024), a city council run beside a Warsaw
 * district's (Kamil Klimek, 2024), and a run with no office, which in 2010 can
 * only be a local one, beside a „Samorząd” run (Tomasz Wiśniewski, 2010). */

export const CLASH_PERSON = "visdwamiejsca";
const NAME = "Tomasz Przykładowy";

const run = (
  id: string,
  teryt: string,
  place: string,
  year: string,
  position: string | null = "Samorząd",
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
  position,
  revisionToApprove: null,
  hasPendingRevision: false,
  publishable: true,
});

/** /api/edges/byNode for the draft page, in the order the endpoint sorts it:
 * by the far end, then newest first. */
export const twoPlacesRelations: NodeRelation[] = [
  run(
    "visrunwarszawa2018",
    "1465",
    "Miasto Warszawa",
    "2018",
    "Rada dzielnicy",
  ),
  run(
    "visrungniezno2018",
    "3003",
    "Powiat gnieźnieński",
    "2018",
    "Rada miasta",
  ),
  run("visrungniezno2010", "3003", "Powiat gnieźnieński", "2010"),
  run("visrungniezno2006", "3003", "Powiat gnieźnieński", "2006"),
  run("visrungniezno2002", "3003", "Powiat gnieźnieński", "2002"),
  run("visrunkozienice2002", "1407", "Powiat kozienicki", "2002"),
  run("visrunkutno2024", "1002", "Powiat kutnowski", "2024", "Rada miasta"),
  run("visrunsokolka2010", "2011", "Powiat sokólski", "2010", null),
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
  run("visrunsejm2023", "02", "Województwo dolnośląskie", "2023", "Sejm"),
  run("visrunsejmik2024", "30", "Województwo wielkopolskie", "2024", "Sejmik"),
  run("visrunsenat2023", "30", "Województwo wielkopolskie", "2023", "Senat"),
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
 * „Opublikuj” would complete the clash. And the same of 2023, which the office
 * key did not see: the Senat run in wielkopolskie live, the namesake's Sejm
 * run in dolnośląskie a draft, as on Jerzy Andrzej Michalak's page on
 * 2026-10-29. Dated the way the live API dates a candidacy (`edgeFromDB`):
 * the election day, as both start and end. */
export function twoPlacesGraph(subjectId: string): GraphLayout {
  const candidacy = (
    id: string,
    target: string,
    day: string,
    visibility: boolean,
    position: ElectionPosition = "Samorząd",
  ) => ({
    id,
    source: subjectId,
    target,
    type: "election" as const,
    name: "kandydatura",
    position,
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
      teryt30: region("teryt30", "Województwo wielkopolskie"),
      teryt02: region("teryt02", "Województwo dolnośląskie"),
    },
    edges: [
      candidacy("visrunsenat2023", "teryt30", "2023-10-15", true, "Senat"),
      candidacy("visrunsejm2023", "teryt02", "2023-10-15", false, "Sejm"),
      candidacy("visrungniezno2006", "teryt3003", "2006-11-12", true),
      candidacy("visrungniezno2002", "teryt3003", "2002-10-27", true),
      candidacy("visrunkozienice2002", "teryt1407", "2002-10-27", false),
    ],
    nodeGroups: [],
  };
}
