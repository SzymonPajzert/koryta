import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { pageIsPublic } from "~~/shared/model";
import type { Company, Edge, Person } from "~~/shared/model";
import {
  sameDayPeers,
  successionsAtCompany,
  type SuccessionSpell,
} from "~~/shared/succession";
import { displayRole } from "~~/shared/companyBodies";
import type { H3Event } from "h3";

/** One end of a handover, named. */
export type SuccessionSide = {
  /** The edge the spell came from, which is what a reader would cite. */
  edgeId: string;
  personId: string;
  personName: string;
  parties: string[];
  start: string | null;
  end: string | null;
  /** Whether the relation itself has been published. A handover is derived
   * from the register either way (see the module note below), so this is what
   * lets an editor tell which half of it is still a draft. */
  published: boolean;
};

/** One seat changing hands. */
export type Succession = {
  companyId: string;
  companyName: string;
  /** As the register names it - "Zarząd", "Rada Nadzorcza" - except that a
   * supervisory seat is renamed to whatever this institution's organ is
   * actually called. See `displayRole`. */
  role: string;
  /** The day the arriving spell began - what the change is filed under. */
  date: string | null;
  /** Days between the two filings. Negative where they overlap. */
  gapDays: number;
  /** How many seats of this role changed hands at this company on this day.
   *
   * One means the register names a successor. More than one means it does not:
   * a whole board went and a whole board arrived, and the pairing picked one
   * assignment out of the several the dates allow. Anything that puts a single
   * name in front of a reader has to say which of the two it is doing. */
  batchSize: number;
  left: SuccessionSide;
  joined: SuccessionSide;
};

/** A post still held, for "Obecny skład". */
export type CurrentPost = {
  edgeId: string;
  personId: string;
  personName: string;
  parties: string[];
  role: string | null;
  start: string | null;
};

export type CompanySuccessions = {
  successions: Succession[];
  current: CurrentPost[];
  /** Handovers found in the register that this reader is not being shown,
   * because one of the two people has no page they may open. Reported as a
   * number so the section can say why it is short rather than looking broken;
   * see `canName`. */
  hidden: number;
};

/** One of a person's own posts, with whoever sat in it either side of them. */
export type PersonSuccession = {
  companyId: string;
  companyName: string;
  role: string;
  start: string | null;
  end: string | null;
  /** Who held the seat before this person, where the register supports it. */
  predecessor: (SuccessionSide & { gapDays: number }) | null;
  /** Who took it over from them. */
  successor: (SuccessionSide & { gapDays: number }) | null;
  /** As on `Succession`: how many seats changed hands here that day, and so
   * whether naming one predecessor asserts more than the register does. */
  batchSize: number;
};

export type PersonSuccessions = {
  posts: PersonSuccession[];
  /** Posts whose neighbour exists but has no page this reader may open. */
  hidden: number;
};

/** How many companies one `in` filter may name. Firestore's limit is 30, and
 * the query is a disjunction of equalities behind the scenes - each one served
 * by the `(target, type)` composite index that already exists. */
const COMPANY_CHUNK = 30;

/** The most employment edges one company query will read. A backstop rather
 * than a budget: the largest board in the register holds 42 spells, so this is
 * five times the worst case, and it is here so that a mis-typed id cannot walk
 * the collection. */
const SPELLS_PER_COMPANY = 200;

/** Every employment edge at these companies, in one round trip per 30 of them.
 *
 * Unpublished edges are read too. Whether a *relation* has been published is a
 * decision about the site's own editorial queue, and gating on it would leave
 * the section empty on almost every company - 154 of 2,348 handovers in the
 * register have both halves published. Whether a *person* has a page is a
 * different question, and that one is still answered the way the rest of the
 * site answers it: see `canName`.
 */
async function employmentEdges(
  db: FirebaseFirestore.Firestore,
  companyIds: string[],
): Promise<(Edge & { id: string })[]> {
  const edges: (Edge & { id: string })[] = [];
  for (let i = 0; i < companyIds.length; i += COMPANY_CHUNK) {
    const chunk = companyIds.slice(i, i + COMPANY_CHUNK);
    const snap = await db
      .collection("edges")
      .where("target", "in", chunk)
      .where("type", "==", "employed")
      .limit(SPELLS_PER_COMPANY * chunk.length)
      .get();
    for (const doc of snap.docs) {
      const edge = { id: doc.id, ...(doc.data() as Edge) };
      if (edge.deleted === true || !edge.source || !edge.target) continue;
      edges.push(edge);
    }
  }
  return edges;
}

/** Every node an edge touches, in one round trip per 100 ids.
 *
 * `recentEmployments.get.ts` needs the same thing and says so at greater
 * length: the endpoints have to be read to name them, and a card that only
 * held ids would cost a request per row.
 */
async function endpointNodes(
  db: FirebaseFirestore.Firestore,
  ids: Iterable<string>,
): Promise<Map<string, Person | Company>> {
  const list = Array.from(new Set(ids));
  const nodes = new Map<string, Person | Company>();
  for (let i = 0; i < list.length; i += 100) {
    const refs = list
      .slice(i, i + 100)
      .map((id) => db.collection("nodes").doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      nodes.set(snap.id, { id: snap.id, ...snap.data() } as Person | Company);
    }
  }
  return nodes;
}

/** Whether this reader may be told who somebody is.
 *
 * A draft page is a page the site has not stood behind yet, and every other
 * public surface - the table, the graph, the recent-employments feed - refuses
 * to name the person behind one. A handover would otherwise be the one place
 * on the site where a name nobody approved is printed next to an allegation
 * about how they got their job, which is the last place to make an exception.
 *
 * The consequence is worth stating plainly rather than hiding: 896 of 6,592
 * people in the register have a page, so a logged out reader sees a small
 * fraction of the handovers and an editor sees all of them. That is what
 * `hidden` counts.
 */
function canName(
  node: Person | Company | undefined,
  showUnapproved: boolean,
): node is Person | Company {
  if (!node?.name) return false;
  return showUnapproved || pageIsPublic(node);
}

function side(
  spell: SuccessionSpell,
  edge: Edge & { id: string },
  person: Person,
): SuccessionSide {
  return {
    edgeId: spell.id,
    personId: spell.personId,
    personName: person.name,
    parties: person.parties ?? [],
    start: spell.start,
    end: spell.end,
    published: edge.published === true,
  };
}

/** The spells at each company, keyed by company id, plus the lookup a caller
 * needs to turn a matched spell back into the edge and person behind it. */
function spellsByCompany(edges: (Edge & { id: string })[]) {
  const byCompany = new Map<string, SuccessionSpell[]>();
  const edgeById = new Map<string, Edge & { id: string }>();
  for (const edge of edges) {
    edgeById.set(edge.id, edge);
    const spell: SuccessionSpell = {
      id: edge.id,
      personId: edge.source,
      role: typeof edge.name === "string" ? edge.name : null,
      start: edge.start_date ?? null,
      end: edge.end_date ?? null,
    };
    const group = byCompany.get(edge.target);
    if (group) group.push(spell);
    else byCompany.set(edge.target, [spell]);
  }
  return { byCompany, edgeById };
}

async function companySuccessions(
  db: FirebaseFirestore.Firestore,
  companyId: string,
  showUnapproved: boolean,
): Promise<CompanySuccessions> {
  const edges = await employmentEdges(db, [companyId]);
  const nodes = await endpointNodes(db, [
    companyId,
    ...edges.map((edge) => edge.source),
  ]);

  const company = nodes.get(companyId);
  // A company page nobody may open has no sections to fill. The page itself
  // reports that; this only refuses to be the way around it.
  if (!canName(company, showUnapproved) || company.type !== "place") {
    return { successions: [], current: [], hidden: 0 };
  }

  const { byCompany, edgeById } = spellsByCompany(edges);
  const pairs = successionsAtCompany(byCompany.get(companyId) ?? []);
  const successions: Succession[] = [];
  let hidden = 0;
  for (const pair of pairs) {
    const leftPerson = nodes.get(pair.left.personId);
    const joinedPerson = nodes.get(pair.joined.personId);
    if (
      !canName(leftPerson, showUnapproved) ||
      leftPerson.type !== "person" ||
      !canName(joinedPerson, showUnapproved) ||
      joinedPerson.type !== "person"
    ) {
      hidden += 1;
      continue;
    }
    successions.push({
      companyId,
      companyName: company.name,
      role: displayRole(pair.joined.role, company) ?? "",
      date: pair.joined.start,
      gapDays: pair.gapDays,
      batchSize: sameDayPeers(pairs, pair),
      left: side(pair.left, edgeById.get(pair.left.id)!, leftPerson),
      joined: side(pair.joined, edgeById.get(pair.joined.id)!, joinedPerson),
    });
  }

  const current: CurrentPost[] = [];
  for (const spell of byCompany.get(companyId) ?? []) {
    // An absent end date is what "still in post" looks like; `create.post.ts`
    // writes null and the edge editor writes "", so neither may be trusted to
    // be the other.
    if (spell.end) continue;
    const person = nodes.get(spell.personId);
    if (!canName(person, showUnapproved) || person.type !== "person") continue;
    current.push({
      edgeId: spell.id,
      personId: spell.personId,
      personName: person.name,
      parties: person.parties ?? [],
      role: displayRole(spell.role, company) ?? null,
      start: spell.start,
    });
  }
  current.sort(
    (a, b) =>
      (a.role ?? "").localeCompare(b.role ?? "") ||
      (b.start ?? "").localeCompare(a.start ?? ""),
  );

  return { successions, current, hidden };
}

async function personSuccessions(
  db: FirebaseFirestore.Firestore,
  personId: string,
  showUnapproved: boolean,
): Promise<PersonSuccessions> {
  const ownSnap = await db
    .collection("edges")
    .where("source", "==", personId)
    .where("type", "==", "employed")
    .limit(SPELLS_PER_COMPANY)
    .get();
  const own = ownSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Edge) }))
    .filter((edge) => edge.deleted !== true && edge.target);
  if (!own.length) return { posts: [], hidden: 0 };

  const companyIds = Array.from(new Set(own.map((edge) => edge.target)));
  const edges = await employmentEdges(db, companyIds);
  const nodes = await endpointNodes(db, [
    personId,
    ...companyIds,
    ...edges.map((edge) => edge.source),
  ]);

  const { byCompany, edgeById } = spellsByCompany(edges);
  const posts: PersonSuccession[] = [];
  let hidden = 0;

  for (const companyId of companyIds) {
    const company = nodes.get(companyId);
    if (!canName(company, showUnapproved)) continue;
    // Narrowed rather than skipped: an `employed` edge pointing at anything
    // but a place is malformed, and this person's post at it is still a post.
    // All that is lost is the organ's real name, which such a node has not
    // got anyway.
    const place = company.type === "place" ? company : undefined;

    // Matched over the whole company, then read from this person's side. The
    // pairing has to see every spell at the company to be one-to-one; keeping
    // only this person's spells first would let two of their colleagues be
    // matched to the same predecessor.
    const pairs = successionsAtCompany(byCompany.get(companyId) ?? []);
    for (const pair of pairs) {
      const mine =
        pair.joined.personId === personId
          ? "joined"
          : pair.left.personId === personId
            ? "left"
            : null;
      if (!mine) continue;

      const other = mine === "joined" ? pair.left : pair.joined;
      const otherPerson = nodes.get(other.personId);
      const theirs = mine === "joined" ? pair.joined : pair.left;
      if (
        !canName(otherPerson, showUnapproved) ||
        otherPerson.type !== "person"
      ) {
        hidden += 1;
        continue;
      }
      const neighbour = {
        ...side(other, edgeById.get(other.id)!, otherPerson),
        gapDays: pair.gapDays,
      };
      posts.push({
        companyId,
        companyName: company.name,
        role: displayRole(theirs.role, place) ?? "",
        start: theirs.start,
        end: theirs.end,
        predecessor: mine === "joined" ? neighbour : null,
        successor: mine === "left" ? neighbour : null,
        batchSize: sameDayPeers(pairs, pair),
      });
    }
  }

  // Newest first, which is the order the person's own history is already in.
  posts.sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
  return { posts, hidden };
}

/** Who took over from whom, for one company or for one person.
 *
 * Two shapes behind one route because they are one question asked from either
 * end, and both need the same thing to answer it: every employment spell at
 * every company involved. A company page could almost derive this from the
 * local graph it already fetches - a person's page cannot, because the graph
 * gives them their employers but not the other people at those employers.
 */
async function successions(event: H3Event) {
  const query = getQuery(event);
  const companyId = typeof query.companyId === "string" ? query.companyId : "";
  const personId = typeof query.personId === "string" ? query.personId : "";

  // One end or the other, never both: the two answer the same question from
  // opposite sides and a request naming both has not decided what it wants.
  if ((companyId && personId) || (!companyId && !personId)) {
    throw createError({
      statusCode: 400,
      message: "Podaj dokładnie jedno z: companyId, personId",
    });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const showUnapproved = wantsLatest(event);

  return companyId
    ? await companySuccessions(db, companyId, showUnapproved)
    : await personSuccessions(db, personId, showUnapproved);
}

/** Six hours, the site default. Unlike the recent-employments feed this does
 * not claim to be current - a handover from 2016 is as interesting as one from
 * last week - and an editor who has just added the missing half of a pair
 * reads through the cache anyway, which is what `editorFresh` is for. */
export default editorFreshCachedEventHandler(successions, {
  name: "successions",
});
