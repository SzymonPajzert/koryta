import type { Proposal } from "../../../shared/proposals";
import type { Revision } from "../../../shared/model";
import type { MyProposals } from "../../../server/api/revisions/mine.get";
import { daysAgo } from "../clock";

/** A new title proposed for a seeded article, for article-propose.spec.ts.
 *
 * Answered from fixtures rather than filed: the emulator keeps what a spec
 * writes, and a proposal is the newest revision a signed in reader is shown,
 * so a real one would change this article for every later run. The three
 * answers are typed from the endpoints, so a change to what they send breaks
 * this file, not the shot. */

/** „Artykuł placeholder 4”, which no spec writes to. */
export const ARTICLE_URL = "/artykul/artykul-placeholder-4-a4";
export const STORED_TITLE = "Artykuł placeholder 4";

/** As long as a real one: the page has to show the whole of it, and so does
 * the box it is typed into. */
export const PROPOSED_TITLE =
  "Miękkie lądowanie radnych w spółkach komunalnych. Kto dostał posadę po wyborach samorządowych";

export const REVISION_ID = "wizualna-propozycja-artykulu";

/** What `/api/revisions/[id]` answers. The page lays `data` over the article. */
export const proposedRevision: Revision = {
  id: REVISION_ID,
  node_id: "a4",
  collection: "nodes",
  data: {
    name: PROPOSED_TITLE,
    type: "article",
    sourceURL: "http://example4.com",
  },
  status: "pending",
  update_time: daysAgo(0),
  update_user: "test-user",
  update_automatic: false,
};

const row: Proposal = {
  id: REVISION_ID,
  targetId: "a4",
  targetCollection: "nodes",
  targetName: PROPOSED_TITLE,
  targetType: "article",
  targetPath: ARTICLE_URL,
  targetExists: true,
  published: true,
  kind: "edit",
  deleteReason: null,
  changes: [
    { field: "name", label: "nazwa", from: STORED_TITLE, to: PROPOSED_TITLE },
  ],
  changeCount: 1,
  updateTime: daysAgo(0),
  updateUser: "test-user",
  author: null,
  automatic: false,
  status: "pending",
  statusDerived: false,
  rejectReason: null,
  reviewTime: null,
  stale: false,
  subject: {
    id: "a4",
    name: PROPOSED_TITLE,
    type: "article",
    path: ARTICLE_URL,
    published: true,
  },
};

/** What `/api/revisions/mine?nodeId=a4` answers once the proposal is filed. */
export const myProposals: MyProposals = {
  revisions: [row],
  total: 1,
  counts: { pending: 1, approved: 0, superseded: 0, rejected: 0 },
  truncated: false,
};

/** And before it: nothing, so the card is not on the page at all. */
export const noProposals: MyProposals = {
  revisions: [],
  total: 0,
  counts: { pending: 0, approved: 0, superseded: 0, rejected: 0 },
  truncated: false,
};
