import type { Proposal } from "../../../shared/proposals";
import type { RevisionQueue } from "../../../server/api/revisions/queue.get";
import type { PendingEdgeRevision } from "../../../server/api/revisions/pendingEdges.get";
import type { RevisedNode } from "../../../app/components/revision/NodeRow.vue";
import { daysAgo } from "../clock";

/** What /admin/rewizje's three lists are drawn from, for its visual test.
 *
 * The seed cannot fill them. Its revisions predate the `update_automatic`
 * flag, so the review queue, which reads only flagged ones, is empty; it has
 * no pending edge change at all; and the entry list is whatever the other
 * specs in this run happen to have edited by then - propose-confirmation.spec
 * files a revision of its own. The three answers here are typed from the
 * endpoints, so a change to what they send breaks this file, not the shot.
 *
 * One of each kind of row the queue draws - an edit, a new entry, a removal,
 * and an edit made stale by a later change - and a pipeline edge change of
 * each common type. The people and places are made up. */

const proposal = (fields: Partial<Proposal> & Pick<Proposal, "id">) =>
  ({
    targetId: "wizos1",
    targetCollection: "nodes",
    targetName: "Barbara Przykładowa",
    targetType: "person",
    targetPath: "/osoba/barbara-przykladowa-wizos1",
    targetExists: true,
    published: true,
    kind: "edit",
    deleteReason: null,
    changes: [],
    changeCount: 0,
    updateTime: daysAgo(0),
    updateUser: "wizautor1",
    author: { displayName: "Ewa Sprawdzająca", email: null, photoURL: null },
    automatic: false,
    status: "pending",
    statusDerived: false,
    rejectReason: null,
    reviewTime: null,
    reviewUser: null,
    stale: false,
    ...fields,
  }) satisfies Proposal;

export const queueProposals: Proposal[] = [
  proposal({
    id: "wizrew1",
    changes: [
      {
        field: "content",
        label: "opis",
        from: "Radna powiatu przykładowskiego.",
        to: "Radna powiatu przykładowskiego, od 2025 w radzie nadzorczej Wodociągów Przykładowo.",
      },
      { field: "parties", label: "partie", from: null, to: "PSL" },
    ],
    changeCount: 2,
  }),
  proposal({
    id: "wizrew2",
    kind: "create",
    targetId: "wizmi1",
    targetName: "Wodociągi Przykładowo sp. z o.o.",
    targetType: "place",
    targetPath: "/instytucja/wodociagi-przykladowo-wizmi1",
    published: false,
    changes: [
      {
        field: "name",
        label: "nazwa",
        from: null,
        to: "Wodociągi Przykładowo sp. z o.o.",
      },
      { field: "krsNumber", label: "KRS", from: null, to: "0000123456" },
    ],
    changeCount: 2,
    updateTime: daysAgo(1),
    updateUser: "wizautor2",
    author: { displayName: "Marek Zgłaszający", email: null, photoURL: null },
  }),
  proposal({
    id: "wizrew3",
    kind: "removal",
    targetId: "wizart1",
    targetName: "Rada nadzorcza wodociągów po nowemu",
    targetType: "article",
    targetPath: "/artykul/rada-nadzorcza-wodociagow-po-nowemu-wizart1",
    deleteReason: "Artykuł opisuje inną osobę o tym samym nazwisku.",
    updateTime: daysAgo(3),
  }),
  proposal({
    id: "wizrew4",
    targetId: "wizos2",
    targetName: "Tomasz Kandydujący",
    targetPath: "/osoba/tomasz-kandydujacy-wizos2",
    changes: [
      {
        field: "name",
        label: "nazwa",
        from: "Tomasz Kandydujacy",
        to: "Tomasz Kandydujący",
      },
    ],
    changeCount: 1,
    updateTime: daysAgo(6),
    updateUser: "wizautor3",
    author: { displayName: "Anna Redaktorka", email: null, photoURL: null },
    stale: true,
  }),
];

/** The queue as it opens: pending, human, and - as in production - only the
 * proposals filed since the flag started being written. */
export const revisionQueue: RevisionQueue = {
  revisions: queueProposals,
  total: queueProposals.length,
  truncated: false,
  pinned: null,
  flagOnly: true,
};

export const pendingEdgeRevisions: PendingEdgeRevision[] = [
  {
    id: "wizedgerev1",
    edgeId: "wizedge1",
    edgeType: "election",
    updateTime: daysAgo(2),
    updateUser: "wizpipeline",
    automatic: true,
    published: false,
    source: { id: "wizos2", name: "Tomasz Kandydujący", type: "person" },
    target: {
      id: "wizrada1",
      name: "Rada Miejska w Przykładowie",
      type: "place",
    },
    changes: [
      { field: "committee", from: null, to: "KWW Wspólne Przykładowo" },
    ],
  },
  {
    id: "wizedgerev2",
    edgeId: "wizedge2",
    edgeType: "employed",
    updateTime: daysAgo(4),
    updateUser: "wizpipeline",
    automatic: true,
    published: true,
    source: { id: "wizos1", name: "Barbara Przykładowa", type: "person" },
    target: {
      id: "wizmi1",
      name: "Wodociągi Przykładowo sp. z o.o.",
      type: "place",
    },
    changes: [
      {
        field: "role",
        from: "członkini rady nadzorczej",
        to: "przewodnicząca rady nadzorczej",
      },
      { field: "start_date", from: null, to: "2025-03-01" },
    ],
  },
];

/** An entry's `revisions` summary: how many, the newest, and whether any of
 * them still waits for a decision. */
const history = (total: number, days: number, hasUnapproved: boolean) => ({
  total,
  latest_time: daysAgo(days),
  has_unapproved: hasUnapproved,
});

export const revisedNodes: RevisedNode[] = [
  {
    id: "wizos1",
    name: "Barbara Przykładowa",
    type: "person",
    visibility: true,
    revisions: history(4, 0, true),
  },
  {
    id: "wizmi1",
    name: "Wodociągi Przykładowo sp. z o.o.",
    type: "place",
    visibility: false,
    revisions: history(1, 1, true),
  },
  {
    id: "wizart1",
    name: "Rada nadzorcza wodociągów po nowemu",
    type: "article",
    visibility: true,
    revisions: history(2, 3, true),
  },
  {
    id: "wizos2",
    name: "Tomasz Kandydujący",
    type: "person",
    visibility: true,
    revisions: history(3, 6, false),
  },
  {
    id: "wizos3",
    name: "Anna Przykładowa",
    type: "person",
    visibility: true,
    revisions: history(1, 40, false),
  },
];
