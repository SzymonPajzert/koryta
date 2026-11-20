import type { Proposal } from "../../../shared/proposals";
import type {
  Interaction,
  MyInteractions,
} from "../../../server/api/interactions/mine.get";
import { daysAgo } from "../clock";

/** What `/api/interactions/mine` answers for ../profile-interactions.spec.ts:
 * a contributor who votes in the queue more often than they propose changes,
 * which is most of them. One proposal in each state a reader can be in, among
 * votes up and down the scale. */

const vote = (
  nodeId: string,
  name: string,
  value: number,
  days: number,
  hour = 9,
): Interaction => {
  const at = daysAgo(days, hour);
  return {
    kind: "vote",
    at,
    vote: {
      nodeId,
      name,
      path: `/osoba/${nodeId}`,
      value,
      updatedAt: at,
    },
  };
};

const proposal = (
  id: string,
  name: string,
  days: number,
  over: Partial<Proposal>,
): Interaction => {
  const at = daysAgo(days, 8);
  return {
    kind: "proposal",
    at,
    proposal: {
      id,
      targetId: `${id}-osoba`,
      targetCollection: "nodes",
      targetName: name,
      targetType: "person",
      targetPath: `/osoba/${id}-osoba`,
      targetExists: true,
      published: false,
      kind: "edit",
      deleteReason: null,
      changes: [],
      changeCount: 0,
      updateTime: at,
      updateUser: "test-user",
      author: null,
      automatic: false,
      status: "pending",
      statusDerived: false,
      rejectReason: null,
      reviewTime: null,
      stale: false,
      subject: {
        id: `${id}-osoba`,
        name,
        type: "person",
        path: `/osoba/${id}-osoba`,
        published: false,
      },
      ...over,
    },
  };
};

const VOTES = [
  vote("franciszek-nastepny", "Franciszek Następny", 4, 0),
  vote("piotr-wisniewski", "Piotr Wiśniewski", 3, 0, 8),
  vote("barbara-ustepujaca", "Barbara Ustępująca", -1, 1),
  vote("andrzej-grzyb", "Andrzej Grzyb", 5, 2),
  vote("anna-nowak", "Anna Nowak", -2, 4),
  vote("cezary-obejmujacy", "Cezary Obejmujący", 2, 6),
  vote("osoba-testowa", "Osoba Testowa", -3, 9),
  vote("danuta-obejmujaca", "Danuta Obejmująca", 1, 12),
  vote("edward-poprzedni", "Edward Poprzedni", 3, 20),
  vote("hanna-prokurent", "Hanna Prokurent", -1, 31),
];

const PROPOSALS = [
  proposal("oczekuje", "Krzysztof Wójcik", 0, {
    changes: [
      {
        field: "content",
        label: "opis",
        from: "Radny powiatu.",
        to: "Radny powiatu, wcześniej w zarządzie spółki komunalnej.",
      },
    ],
    changeCount: 1,
  }),
  proposal("odrzucona", "Hanna Prokurent", 1, {
    status: "rejected",
    rejectReason: "Brak źródła. Dodaj link do artykułu albo dokumentu.",
    changes: [
      { field: "content", label: "opis", from: null, to: "Kuzyn burmistrza." },
    ],
    changeCount: 1,
  }),
  proposal("zatwierdzona", "Danuta Obejmująca", 6, {
    status: "approved",
    published: true,
    changes: [
      {
        field: "content",
        label: "opis",
        from: null,
        to: "Członkini rady nadzorczej od 2024.",
      },
    ],
    changeCount: 1,
  }),
];

const counts = {
  pending: 1,
  approved: 1,
  superseded: 0,
  rejected: 1,
  votes: 14,
};

const truncated = { proposals: false, votes: false };

/** The card as it opens: both kinds, newest first, a page of ten. */
export const INTERACTIONS: MyInteractions = {
  items: [...PROPOSALS, ...VOTES]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10),
  total: 17,
  counts,
  truncated,
};

/** With the „Głosy” chip on. */
export const VOTES_ONLY: MyInteractions = {
  items: VOTES,
  total: 14,
  counts,
  truncated,
};
