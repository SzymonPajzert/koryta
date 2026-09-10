import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { asArray, pageIsPublic } from "~~/shared/model";
import type { Edge, Person } from "~~/shared/model";
import {
  successionCandidatesForPerson,
  type SuccessionCandidacy,
} from "~~/shared/succession";
import { displayRole } from "~~/shared/companyBodies";
// Read the register the way /api/edges/successions already reads it, by
// importing its helpers rather than copying them: the two endpoints answer the
// same question from different ends, and a second copy of the chunked `in`
// query or of `canName` would be a place for the redaction policy to drift.
import {
  canName,
  employmentEdges,
  endpointNodes,
  spellsByCompany,
  SPELLS_PER_COMPANY,
} from "~~/server/api/edges/successions.get";
import type { H3Event } from "h3";

/** Where a candidacy comes from: one seat at one company, and the two spells
 * whose dates put these two people next to each other in it. */
export type SuccessionVia = {
  companyId: string;
  companyName: string;
  /** Through `displayRole`, so a hospital's rada społeczna is not printed as a
   * rada nadzorcza. Never empty: a spell with no role has no candidates. */
  role: string;
  /** The focus person's own spell in that seat, which is what a reader cites. */
  focusEdgeId: string;
  focusStart: string | null;
  focusEnd: string | null;
  /** The candidate's own spell in the same seat. */
  edgeId: string;
  start: string | null;
  end: string | null;
  /** As `SuccessionPair.gapDays`: the successor's start minus the
   * predecessor's end. Negative where the two filings overlap. */
  gapDays: number;
  /** How many people are candidates in this seat, on this side, on this day.
   * More than one means the register recorded a batch and not who replaced
   * whom, and the page has to say so out loud. */
  batchSize: number;
};

/** One person on one side of the focus person, merged over their posts.
 *
 * Merged deliberately: two people can sit next to each other in two companies
 * at once, and that is one human with two reasons rather than two cards with
 * one name - which would also give the chain two nodes for one person. */
export type SuccessionCandidate = {
  personId: string;
  personName: string;
  parties: string[];
  /** Whether this person's page is published. They are named either way here,
   * the page being behind the login gate, so this is what lets it mark a
   * draft rather than pretend the person is live. */
  published: boolean;
  /** Every seat the candidacy rests on, closest filing first. Almost always
   * one. */
  via: SuccessionVia[];
  /** The `gapDays` of `via[0]`, i.e. the closest filing, which is what the
   * column is ordered on. */
  closestGapDays: number;
};

/** One of the focus person's own posts, whether or not anybody matched it. */
export type SuccessionChainPost = {
  companyId: string;
  companyName: string;
  /** Null where the register recorded no role for the spell. Such a post
   * cannot be matched to anybody at all, and saying so is the difference
   * between "we found nobody" and "we could not look". */
  role: string | null;
  edgeId: string;
  start: string | null;
  end: string | null;
  /** People, not links: one person is one name in the column. */
  predecessorCount: number;
  successorCount: number;
};

/** One person as the chain draws them: their posts, and everybody the register
 * allows either side of them.
 *
 * `predecessors` and `successors` are flat and merged across every post on
 * purpose. The two people a reader comes here for are routinely in two
 * different companies - Ryszard Grobelny's predecessor is at Związek Miast
 * Polskich and his successor at Międzynarodowe Targi Poznańskie - so grouping
 * the answer by company would put the two halves of one question on two
 * different screens. The company and the seat travel on the card instead, as
 * provenance. */
export type SuccessionChainStep = {
  personId: string;
  /** Empty where the id names nothing this reader may be told about. The page
   * renders its own "nie znaleźliśmy" rather than being handed a 404: a failed
   * expansion is a card in a chain, not a broken page. */
  personName: string;
  parties: string[];
  published: boolean;
  posts: SuccessionChainPost[];
  predecessors: SuccessionCandidate[];
  successors: SuccessionCandidate[];
  /** Candidates the register supports that this reader is not being shown,
   * because the person has no page they may open. Counted over people, as
   * `CompanySuccessions.hidden` counts over handovers. */
  hidden: number;
};
/** Which side of the focus person a candidate stands on. Used as half of the
 * merge key, so that somebody who is both - left the seat just before this
 * person took it and came back to it just after they left - is two cards
 * rather than one card the reader cannot place. */
type ChainDirection = "predecessor" | "successor";

/** Everybody the register allows either side of one person, drawn as the chain
 * page draws them: two flat columns and the person's own posts.
 *
 * Deliberately not `/api/edges/successions?personId=`. That route answers with
 * `PersonSuccession.predecessor`, one name or none, because a page that prints
 * "wcześniej na tym stanowisku: X" must not assert more than the register
 * supports. This one asserts nothing at all - it hands over every spell whose
 * dates permit a handover and lets the reader see that six of them are equally
 * possible - and the two shapes cannot be served from one payload without
 * shipping two answers to one question. See the note at the head of
 * `shared/succession.ts` for why the greedy rule was left alone rather than
 * relaxed.
 *
 * Read cost, measured on the 2026-09-09 mirror: one query for the person's own
 * edges, one `in` query per `COMPANY_CHUNK` companies, one `getAll` per 100
 * nodes. Ryszard Grobelny is 2 queries and 124 documents; the register-wide
 * mean is 58 documents per person and the worst case 454, at 17 companies. A
 * chain of N people costs N of these, one per distinct person, and the client
 * is expected never to ask for the same person twice - which is why this
 * answers about exactly one person and never walks the graph itself.
 */
async function successionChain(event: H3Event): Promise<SuccessionChainStep> {
  const query = getQuery(event);
  const personId = typeof query.personId === "string" ? query.personId : "";
  if (!personId) {
    throw createError({ statusCode: 400, message: "Podaj personId" });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const showUnapproved = wantsLatest(event);

  const ownSnap = await db
    .collection("edges")
    .where("source", "==", personId)
    .where("type", "==", "employed")
    .limit(SPELLS_PER_COMPANY)
    .get();
  const own = ownSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Edge) }))
    .filter((edge) => edge.deleted !== true && edge.target);

  // Every company this person served at, then every spell at those companies:
  // the pairing has to see the colleagues to know who stood either side, and a
  // person's own edges never mention them.
  const companyIds = Array.from(new Set(own.map((edge) => edge.target)));
  const edges = await employmentEdges(db, companyIds);
  // Read even when the person turned out to have no posts at all. The chain
  // draws a card for everybody it has expanded, and a card with no name on it
  // looks like the request failed rather than like a dead end.
  const nodes = await endpointNodes(db, [
    personId,
    ...companyIds,
    ...edges.map((edge) => edge.source),
  ]);

  const self = nodes.get(personId);
  if (!canName(self, showUnapproved) || self.type !== "person") {
    // The same refusal the company section makes: a draft page is a page the
    // site has not stood behind, and this would otherwise be the one surface
    // that prints an unapproved person's whole career to a logged out reader.
    // The empty name is what the page renders its own "nie znaleźliśmy" from.
    return {
      personId,
      personName: "",
      parties: [],
      published: false,
      posts: [],
      predecessors: [],
      successors: [],
      hidden: 0,
    };
  }

  const { byCompany } = spellsByCompany(edges);
  const posts: SuccessionChainPost[] = [];
  // Keyed by direction as well as by person for the reason `ChainDirection`
  // gives; `hiddenPeople` is keyed the same way so that somebody withheld on
  // both sides is counted as the two facts it is.
  const merged = new Map<string, SuccessionCandidate>();
  const hiddenPeople = new Set<string>();

  for (const companyId of companyIds) {
    const company = nodes.get(companyId);
    if (!canName(company, showUnapproved)) continue;
    // Narrowed rather than skipped, exactly as `personSuccessions` does: an
    // `employed` edge pointing at anything but a place is malformed, and this
    // person's post at it is still a post. All that is lost is the organ's
    // real name, which such a node has not got anyway.
    const place = company.type === "place" ? company : undefined;

    const found = successionCandidatesForPerson(
      byCompany.get(companyId) ?? [],
      personId,
    );

    /** The person behind a candidacy, if this reader may be told who they
     * are. Everything downstream of the redaction asks this once. */
    const other = (candidacy: SuccessionCandidacy): Person | undefined => {
      const node = nodes.get(candidacy.other.personId);
      if (!canName(node, showUnapproved) || node.type !== "person") return;
      return node;
    };

    // People rather than links: one person is one name in the column, so a
    // colleague who stood next to this post twice counts once. Counted after
    // the redaction, so that the number under a post and the cards next to it
    // are the same number - `hidden` is where the difference is reported.
    const countPeople = (
      candidacies: SuccessionCandidacy[],
      post: (typeof found.posts)[number],
    ) =>
      new Set(
        candidacies
          .filter((candidacy) => candidacy.own === post && other(candidacy))
          .map((candidacy) => candidacy.other.personId),
      ).size;

    for (const post of found.posts) {
      posts.push({
        companyId,
        companyName: company.name,
        // Null, not "": the page says something different about a post the
        // register gave no role to, because such a post cannot be matched to
        // anybody at all and "we found nobody" would be a lie about it.
        role: displayRole(post.role, place) ?? null,
        edgeId: post.id,
        start: post.start,
        end: post.end,
        predecessorCount: countPeople(found.predecessors, post),
        successorCount: countPeople(found.successors, post),
      });
    }

    const sides: [ChainDirection, SuccessionCandidacy[]][] = [
      ["predecessor", found.predecessors],
      ["successor", found.successors],
    ];
    for (const [direction, candidacies] of sides) {
      for (const candidacy of candidacies) {
        const person = other(candidacy);
        if (!person) {
          // Keyed by the person alone, unlike `merged` below, which is keyed
          // by side as well. `hidden` is rendered as a count of humans („nie
          // pokazujemy N osób”), and the register does put one person on both
          // sides of another - they left the seat just before this person took
          // it and came back to it just after. Keying this set by direction
          // too counted such a person twice and told the reader about one more
          // withheld human than exists.
          hiddenPeople.add(candidacy.other.personId);
          continue;
        }
        const key = `${direction}:${candidacy.other.personId}`;
        let candidate = merged.get(key);
        if (!candidate) {
          candidate = {
            personId: candidacy.other.personId,
            personName: person.name,
            // `asArray`, not `?? []`: a document written before 2026-07-28
            // stores an array as an object with numbered keys, and handing
            // that to the client typed as a string array puts `{"0": "PiS"}`
            // through a `v-chip` loop that renders nothing.
            parties: asArray(person.parties),
            published: pageIsPublic(person),
            via: [],
            closestGapDays: 0,
          };
          merged.set(key, candidate);
        }
        candidate.via.push({
          companyId,
          companyName: company.name,
          // A candidacy only ever hangs off a post the register gave a role
          // to, so the fallback cannot fire; it is here because `displayRole`
          // is typed as though it could.
          role: displayRole(candidacy.own.role, place) ?? "",
          focusEdgeId: candidacy.own.id,
          focusStart: candidacy.own.start,
          focusEnd: candidacy.own.end,
          edgeId: candidacy.other.id,
          start: candidacy.other.start,
          end: candidacy.other.end,
          gapDays: candidacy.gapDays,
          batchSize: candidacy.batchSize,
        });
      }
    }
  }

  for (const candidate of merged.values()) {
    // Closest filing first, then on the company's name in Polish - never on
    // the ids, which move whenever the ingest rewrites the collection.
    candidate.via.sort(
      (a, b) =>
        Math.abs(a.gapDays) - Math.abs(b.gapDays) ||
        a.companyName.localeCompare(b.companyName, "pl"),
    );
    candidate.closestGapDays = candidate.via[0]!.gapDays;
  }

  const column = (direction: ChainDirection) =>
    Array.from(merged.entries())
      .filter(([key]) => key.startsWith(`${direction}:`))
      .map(([, candidate]) => candidate)
      .sort(
        (a, b) =>
          Math.abs(a.closestGapDays) - Math.abs(b.closestGapDays) ||
          a.personName.localeCompare(b.personName, "pl"),
      );

  // Newest first, which is the order a person's own history is printed in
  // everywhere else on the site.
  posts.sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));

  return {
    personId,
    personName: self.name,
    parties: asArray(self.parties),
    published: pageIsPublic(self),
    posts,
    predecessors: column("predecessor"),
    successors: column("successor"),
    hidden: hiddenPeople.size,
  };
}

/** Six hours for logged out traffic, and nothing at all for a signed in
 * reader.
 *
 * `latest` is what every request from the chain page carries, and
 * `editorFreshCachedEventHandler` reads it as "this is an editor" and goes
 * straight to Firestore. Worth saying plainly, because the page above this is
 * behind `middleware: "auth"` and that is not what makes the answer private:
 * `wantsLatest` reads a query parameter, so anybody may curl this route with
 * `?latest=true` and be told the names of people whose pages are still drafts.
 * That is the same deal every editor-facing route on this site offers and it
 * is deliberate here; a route that needed real authorisation would have to
 * carry a bearer token, which a GET through `authFetch` does not.
 */
export default editorFreshCachedEventHandler(successionChain, {
  name: "succession-chain",
});
