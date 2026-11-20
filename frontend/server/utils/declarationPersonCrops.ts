import { createHash } from "node:crypto";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { warsawDate } from "~~/shared/dates";
import { pageIsPublic } from "~~/shared/model";
import {
  candidacyStatuses,
  cropOrder,
  DECLARATION_SEARCH_SINCE,
  localOffices,
  pageOutcomes,
  publicationHoldReasons,
  settledBy,
  type CandidacyStatus,
  type LocalOffice,
  type PageOutcome,
  type PersonDeclarationCrop,
  type PersonDeclarationCrops,
  type PersonDeclarationLink,
  type PersonDeclarationSearch,
  type PersonPublicationState,
  type PublicationHoldReason,
  type SettledBy,
} from "~~/shared/declarations";
import { EXTRACTS, PUBLICATIONS, unitOf } from "./declarations";
import { resolveMergedNode } from "./merge";
import { pagesWithAPublicPost } from "./publicPosts";

const CANDIDACIES = "declarationCandidacies";

/** Links to declarations readers found by hand, one document a page and
 * address (`linkId`): what the crawl should fetch for a draft it has no crop
 * of. Server only, as every declarations collection is. */
export const LINKS = "declarationLinks";

/** Links one reader may give in a Warsaw day: far more than a sitting of
 * research by hand, few enough that one account cannot flood the crawl's
 * list. */
export const LINKS_PER_DAY = 50;

/** The draft a page id leads to, through merges: refused as a 404 for a page
 * that is gone, no person's, or public, which says no more of its
 * declarations than the outcome (`/api/nodes/<id>/declarations`). */
export async function draftPerson(db: Firestore, id: string): Promise<string> {
  const { id: personId, snapshot } = await resolveMergedNode(db, id);
  const person = snapshot?.data();
  if (!person || person.type !== "person" || pageIsPublic(person)) {
    throw createError({ statusCode: 404, message: `No draft ${id}` });
  }
  return personId;
}

/**
 * The crops of one draft's declarations and where its publication stands,
 * for a signed-in reader of the page researching the person by hand: whether
 * a declaration is on its way to publishing the page, what holds it, or what
 * readers read off it. A page with no crop gets the local elections the
 * person won since 2014 instead, each with what the crawler found when it
 * looked for its declaration, which is where to look for it by hand.
 *
 * Every crop filed for the page (`personIds`), a crop the cutter failed on
 * included - its declaration is linked all the same - but none an admin took
 * back. The pictures stay apart (`/api/declarations/<id>/images`): the page
 * asks for those it shows.
 */
export async function personDeclarationCrops(
  db: Firestore,
  personId: string,
  /** Who asks: their own links are marked so. */
  uid: string,
): Promise<PersonDeclarationCrops> {
  const [snapshot, record] = await Promise.all([
    db
      .collection(EXTRACTS)
      .where("personIds", "array-contains", personId)
      .get(),
    db.collection(PUBLICATIONS).doc(personId).get(),
  ]);
  const crops = snapshot.docs
    .filter((doc) => doc.get("status") !== "withdrawn")
    .map((doc) => cropOf(doc.id, doc.data(), personId))
    .sort((a, b) => cropOrder(a) - cropOrder(b) || b.answers - a.answers);
  const [publication, searches, links] = await Promise.all([
    publicationOf(db, personId, record.data()),
    crops.length > 0 ? [] : searchesOf(db, personId),
    crops.length > 0 ? [] : linksOf(db, personId, uid),
  ]);
  return { publication, crops, searches, links };
}

/** One document a page and address: the same link given twice, by anybody,
 * is one link. */
export function linkId(personId: string, url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return `${personId}_${hash}`;
}

/** The links readers gave for the page, the oldest first. */
async function linksOf(
  db: Firestore,
  personId: string,
  uid: string,
): Promise<PersonDeclarationLink[]> {
  const snapshot = await db
    .collection(LINKS)
    .where("personId", "==", personId)
    .get();
  return snapshot.docs
    .map((doc) => ({
      url: String(doc.get("url") ?? ""),
      at: isoOf(doc.get("createdAt")),
      mine: doc.get("uid") === uid,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** A stored instant as ISO: a Firestore Timestamp, or nothing. */
function isoOf(value: unknown): string {
  return value && typeof (value as { toDate?: unknown }).toDate === "function"
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : "";
}

/**
 * Stores a link to the page's declaration a reader found by hand, for the
 * crawl to fetch (`status` "new" until it has). A link the page has already
 * is left as it was, whoever gave it. Past `LINKS_PER_DAY` of this reader's
 * links in the Warsaw day, refused with a 429.
 */
export async function addDeclarationLink(
  db: Firestore,
  args: { personId: string; url: string; uid: string; now?: Date },
): Promise<"added" | "known"> {
  const now = args.now ?? new Date();
  const day = warsawDate(now);
  const ref = db.collection(LINKS).doc(linkId(args.personId, args.url));
  const today = await db
    .collection(LINKS)
    .where("uid", "==", args.uid)
    .where("day", "==", day)
    .count()
    .get();
  if (today.data().count >= LINKS_PER_DAY) {
    throw createError({
      statusCode: 429,
      message: "Na dziś przyjęliśmy już tyle Twoich linków, ile możemy.",
    });
  }
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return "known";
    tx.create(ref, {
      personId: args.personId,
      url: args.url,
      host: new URL(args.url).host,
      uid: args.uid,
      day,
      status: "new",
      createdAt: Timestamp.fromDate(now),
    });
    return "added";
  });
}

function cropOf(
  id: string,
  data: DocumentData,
  personId: string,
): PersonDeclarationCrop {
  const size = data.imageSize as PersonDeclarationCrop["imageSize"] | undefined;
  const outcome = (data.pageOutcomes as Record<string, unknown> | undefined)?.[
    personId
  ];
  const agreed = data.agreed?.value;
  return {
    id,
    status: data.status,
    failure: typeof data.failure === "string" ? data.failure : null,
    ...unitOf(data),
    documentUrl: String(data.url ?? ""),
    answers: Number(data.answerCount ?? 0),
    agreed: typeof agreed === "string" ? agreed : null,
    agreedBy: (settledBy as readonly unknown[]).includes(data.agreed?.by)
      ? (data.agreed.by as SettledBy)
      : null,
    outcome: (pageOutcomes as readonly unknown[]).includes(outcome)
      ? (outcome as PageOutcome)
      : null,
    imageSize: size?.date ? { date: size.date, name: size.name ?? null } : null,
  };
}

/** The page's record, while it says something of a draft: waiting in the
 * queue, taken up, held or declined. A record of a publication that went
 * through, or of a page public when its date matched, says nothing of a
 * page that is a draft now. */
async function publicationOf(
  db: Firestore,
  personId: string,
  data: DocumentData | undefined,
): Promise<PersonPublicationState | null> {
  if (!data) return null;
  const status =
    data.status === "held" && data.declinedAt ? "declined" : data.status;
  if (
    status !== "queued" &&
    status !== "publishing" &&
    status !== "held" &&
    status !== "declined"
  ) {
    return null;
  }
  const reason = (publicationHoldReasons as readonly unknown[]).includes(
    data.reason,
  )
    ? (data.reason as PublicationHoldReason)
    : null;
  const paidPost =
    status === "held"
      ? (await pagesWithAPublicPost(db, [personId])).has(personId)
      : false;
  return { status, reason, paidPost };
}

const isLocalOffice = (value: unknown): value is LocalOffice =>
  (localOffices as readonly unknown[]).includes(value);

/**
 * The local elections the person won since 2014, newest first: each
 * candidacy the crawler looked for (`declarationCandidacies`, the won ones
 * of the terms it searches), and each win on the page it never looked for.
 *
 * The two meet by year, office and place: the crawler files a candidacy
 * under its gmina's six digits, the page under the powiat (`teryt` and four
 * digits) or, for a sejmik, the województwo (two), which the gmina's digits
 * start with. A win the crawler never looked for is named after that region,
 * as the page's history names it.
 */
async function searchesOf(
  db: Firestore,
  personId: string,
): Promise<PersonDeclarationSearch[]> {
  const [candidacies, elections] = await Promise.all([
    db
      .collection(CANDIDACIES)
      .where("personIds", "array-contains", personId)
      .get(),
    db
      .collection("edges")
      .where("source", "==", personId)
      .where("type", "==", "election")
      .get(),
  ]);

  const searched: { search: PersonDeclarationSearch; teryt: string }[] =
    candidacies.docs.flatMap((doc) => {
      const data = doc.data();
      const year = Number(data.year);
      if (!isLocalOffice(data.office) || !(year >= DECLARATION_SEARCH_SINCE)) {
        return [];
      }
      const bipUrls = Array.isArray(data.bipUrls) ? data.bipUrls : [];
      return [
        {
          search: {
            year,
            office: data.office,
            unit: String(data.unitName ?? `TERYT ${data.teryt ?? ""}`),
            status: (candidacyStatuses as readonly unknown[]).includes(
              data.status,
            )
              ? (data.status as CandidacyStatus)
              : null,
            reason: typeof data.reason === "string" ? data.reason : null,
            files: Number(data.files ?? 0),
            bipUrl: typeof bipUrls[0] === "string" ? bipUrls[0] : null,
          },
          teryt: String(data.teryt ?? ""),
        },
      ];
    });

  const wins = elections.docs
    .map((doc) => doc.data())
    .filter(
      (edge) =>
        edge.elected === true &&
        edge.deleted !== true &&
        isLocalOffice(edge.position) &&
        Number(String(edge.start_date ?? "").slice(0, 4)) >=
          DECLARATION_SEARCH_SINCE,
    )
    .map((edge) => ({
      year: Number(String(edge.start_date).slice(0, 4)),
      office: edge.position as LocalOffice,
      region: String(edge.target ?? ""),
    }))
    .filter(
      (win) =>
        !searched.some(
          ({ search, teryt }) =>
            search.year === win.year &&
            search.office === win.office &&
            teryt.startsWith(win.region.replace(/^teryt/, "")),
        ),
    );

  const regions = await regionNames(
    db,
    wins.map((win) => win.region),
  );
  const unsearched: PersonDeclarationSearch[] = wins.map((win) => ({
    year: win.year,
    office: win.office,
    unit: regions.get(win.region) ?? win.region,
    status: null,
    reason: null,
    files: 0,
    bipUrl: null,
  }));

  const seen = new Set<string>();
  return [...searched.map(({ search }) => search), ...unsearched]
    .filter((search) => {
      // Two by-elections of one term, or a win the page lists twice.
      const key = `${search.year}|${search.office}|${search.unit}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.year - a.year);
}

/** The names of the regions the page's candidacies are filed under. */
async function regionNames(
  db: Firestore,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => id))];
  if (unique.length === 0) return new Map();
  const snapshots = await db.getAll(
    ...unique.map((id) => db.collection("nodes").doc(id)),
    { fieldMask: ["name"] },
  );
  return new Map(
    snapshots
      .filter((snapshot) => typeof snapshot.get("name") === "string")
      .map((snapshot) => [snapshot.id, String(snapshot.get("name"))]),
  );
}
