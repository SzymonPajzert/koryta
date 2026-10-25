import type { Proposal } from "../../../shared/proposals";
import type {
  NodeRelationHistory,
  RelationHistory,
} from "../../../server/api/revisions/relations.get";
import { daysAgo } from "../clock";

/** An entry's relations on /admin/rewizje/[id], each with its own revisions,
 * for the captures of the „Powiązania” section and the signal above it.
 *
 * Shaped like Hubert Papaj's page on 2026-10-17, which the section was built
 * for: a live candidacy with two proposals from two nights that disagree, a
 * council seat still a draft, and the rest settled. It is answered for the
 * seed's Krzysztof Wójcik (node 5), whose own history the page reads from the
 * seed and who has no relations there. The companies are made up; the places
 * are real. */

export const ENTRY_ID = "5";
const NAME = "Krzysztof Wójcik";
const SUBJECT = {
  id: ENTRY_ID,
  name: NAME,
  type: "person" as const,
  path: "/osoba/krzysztof-wojcik-5",
  published: true,
};
const LODZ = {
  id: "teryt1061",
  name: "Łódź",
  type: "region" as const,
  path: "/region/lodz-teryt1061",
  published: true,
};

const revision = (
  targetId: string,
  what: string,
  over: Partial<Proposal>,
): Proposal => ({
  id: `${targetId}-rev`,
  targetId,
  targetCollection: "edges",
  targetName: `${NAME} → ${what}`,
  targetType: null,
  targetPath: SUBJECT.path,
  targetExists: true,
  published: true,
  kind: "edit",
  deleteReason: null,
  changes: [],
  changeCount: 0,
  updateTime: daysAgo(30),
  updateUser: "pipeline-people-import",
  author: null,
  automatic: true,
  status: "approved",
  statusDerived: false,
  rejectReason: null,
  reviewTime: null,
  reviewUser: null,
  stale: false,
  subject: SUBJECT,
  ...over,
});

const relation = (
  over: Partial<RelationHistory> & Pick<RelationHistory, "id" | "state">,
): RelationHistory => ({
  type: "election",
  name: "kandydatura",
  direction: "outgoing",
  other: LODZ,
  startDate: null,
  endDate: null,
  position: null,
  committee: null,
  elected: false,
  published: true,
  deleted: false,
  publishable: true,
  approvedRevisionId: null,
  waiting: 0,
  revisions: [],
  ...over,
});

/** The live 2018 candidacy, bare since a March upload, and the two nights
 * that tried to name it: the older one would mark the lost mayoral race as
 * won, which is why both wait side by side. */
const bareRun = relation({
  id: "visrel-2018",
  state: "proposals",
  startDate: "2018-01-01",
  approvedRevisionId: "visrel-2018-created",
  waiting: 2,
  revisions: [
    revision("visrel-2018", "Łódź (kandydatura)", {
      id: "visrel-2018-mayor",
      status: "pending",
      updateTime: daysAgo(2, 14),
      changes: [
        {
          field: "committee",
          label: "komitet",
          from: null,
          to: "KWW Łódź Przyszłości",
        },
        {
          field: "position",
          label: "typ wyborów",
          from: null,
          to: "Prezydent",
        },
      ],
      changeCount: 2,
    }),
    revision("visrel-2018", "Łódź (kandydatura)", {
      id: "visrel-2018-council",
      status: "pending",
      updateTime: daysAgo(8, 12),
      changes: [
        {
          field: "committee",
          label: "komitet",
          from: null,
          to: "KWW Łódź Przyszłości",
        },
        { field: "position", label: "typ wyborów", from: null, to: "Samorząd" },
        { field: "elected", label: "wybrany", from: null, to: "tak" },
      ],
      changeCount: 3,
    }),
    revision("visrel-2018", "Łódź (kandydatura)", {
      id: "visrel-2018-created",
      statusDerived: true,
      updateTime: daysAgo(160, 1),
    }),
  ],
});

const relations: RelationHistory[] = [
  bareRun,
  relation({
    id: "visrel-2024",
    state: "draft",
    startDate: "2024-01-01",
    position: "Rada miasta",
    committee: "KWW Łódź Przyszłości",
    elected: true,
    published: false,
    approvedRevisionId: "visrel-2024-rev",
    revisions: [
      revision("visrel-2024", "Łódź (kandydatura)", {
        published: false,
        updateTime: daysAgo(8, 12),
      }),
    ],
  }),
  relation({
    id: "visrel-mpwik",
    state: "draft",
    type: "employed",
    name: "Członek rady nadzorczej",
    other: {
      id: "vismpwik",
      name: "Miejskie Przedsiębiorstwo Wodociągów i Kanalizacji Sp. z o.o.",
      type: "place",
      path: "/instytucja/miejskie-przedsiebiorstwo-wodociagow-vismpwik",
      published: true,
    },
    startDate: "2021-06-14",
    published: false,
    approvedRevisionId: "visrel-mpwik-rev",
    revisions: [
      revision("visrel-mpwik", "MPWiK (członek rady nadzorczej)", {
        published: false,
        updateTime: daysAgo(20, 3),
      }),
    ],
  }),
  relation({
    id: "visrel-lsi",
    state: "settled",
    type: "employed",
    name: "Prezes zarządu",
    other: {
      id: "vislsi",
      name: "Łódzka Spółka Infrastrukturalna Sp. z o.o.",
      type: "place",
      path: "/instytucja/lodzka-spolka-infrastrukturalna-vislsi",
      published: true,
    },
    startDate: "2015-03-01",
    endDate: "2019-12-31",
    approvedRevisionId: "visrel-lsi-rev",
    revisions: [
      revision("visrel-lsi", "ŁSI (prezes zarządu)", {
        updateTime: daysAgo(210, 9),
      }),
    ],
  }),
  relation({
    id: "visrel-removed",
    state: "removed",
    type: "employed",
    name: "Członek zarządu",
    other: {
      id: "vislsi",
      name: "Łódzka Spółka Infrastrukturalna Sp. z o.o.",
      type: "place",
      path: "/instytucja/lodzka-spolka-infrastrukturalna-vislsi",
      published: true,
    },
    startDate: "2012-01-01",
    published: false,
    deleted: true,
    publishable: false,
    approvedRevisionId: "visrel-removed-rev",
    revisions: [
      revision("visrel-removed", "ŁSI (członek zarządu)", {
        kind: "removal",
        deleteReason: "duplikat",
        updateTime: daysAgo(40, 9),
      }),
    ],
  }),
];

/** What /api/revisions/relations answers for the page above: two changes
 * waiting on one live relation, and two relations not on the site. */
export const entryRelations: NodeRelationHistory = {
  relations,
  total: relations.length,
  drafts: 2,
  withProposals: 1,
  proposals: 2,
  nodePublished: true,
};

/** The same page with nothing waiting: every relation live, or removed. */
export const settledRelations: NodeRelationHistory = {
  relations: [
    {
      ...bareRun,
      state: "settled",
      waiting: 0,
      revisions: [bareRun.revisions[2]!],
    },
    ...relations.filter((r) => r.state === "settled" || r.state === "removed"),
  ],
  total: 3,
  drafts: 0,
  withProposals: 0,
  proposals: 0,
  nodePublished: true,
};
