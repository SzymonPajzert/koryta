import type { PersonSuccession } from "~~/server/api/edges/successions.get";
import type { EdgeNode } from "~/composables/edges";
import { generateEntityUrl } from "~/composables/slugs";
import { shortDate } from "~~/shared/dates";

/** Whoever held a seat before the spell an edge records, carrying how many
 * seats changed hands alongside it - which is what says whether naming this
 * one person asserts more than the register does. */
export type Predecessor = NonNullable<PersonSuccession["predecessor"]> & {
  batchSize: number;
};

/** The role two spells have to share to be the same seat, normalised the way
 * `shared/succession.ts` normalises it: case and surrounding space only. */
function seatRole(role: string | null | undefined): string {
  return role?.trim().toLowerCase() ?? "";
}

/** A spell's identity as far as the register is concerned: the company, the
 * seat, and the day it began. */
function seatKey(
  companyId: string,
  role: string | null | undefined,
  start: string | null | undefined,
): string {
  return `${companyId}|${seatRole(role)}|${start ?? ""}`;
}

/** Which of a person's relations was taken over from somebody, keyed by edge
 * id, for `card/EmploymentHistory.vue`'s per-row hint.
 *
 * The join has to be made here rather than read off the response, because
 * `/api/edges/successions?personId=` answers per *post* and never carries the
 * edge id of this person's own spell - only of the other side's. So a post is
 * matched back to the row it belongs to on what both hold: the company, the
 * role and the start date. That triple is what `shared/succession.ts` treats as
 * one seat, and a person holding the same seat twice from the same day would be
 * one spell filed twice, which the pairing already drops as a duplicate.
 *
 * A post whose row is not in `edges` is skipped rather than guessed at: the
 * card is handed whatever the local graph returned, and that is not always
 * every relation the endpoint saw.
 */
export function predecessorsByEdge(
  posts: PersonSuccession[],
  edges: EdgeNode[],
): Record<string, Predecessor> {
  const rows = new Map<string, string>();
  for (const edge of edges) {
    if (!edge.id || edge.type !== "employed") continue;
    const key = seatKey(edge.target, edge.label, edge.start_date);
    // First one wins, so two indistinguishable rows do not both claim the
    // handover and leave which of them shows it up to Firestore's ordering.
    if (!rows.has(key)) rows.set(key, edge.id);
  }

  const byEdge: Record<string, Predecessor> = {};
  for (const post of posts) {
    if (!post.predecessor) continue;
    const edgeId = rows.get(seatKey(post.companyId, post.role, post.start));
    if (edgeId) {
      byEdge[edgeId] = { ...post.predecessor, batchSize: post.batchSize };
    }
  }
  return byEdge;
}

/* ---------- the view-model behind a handover card ---------- */

/** One side of a handover, as the card prints it.
 *
 * `label` names the position in the handover and never what the person did, so
 * that no sentence here has to know anybody's gender. `when` is prose rather
 * than dates because a caller may have reason not to say: the "Kiedy?" daily
 * shows a real handover and asks the player for its date, so it passes the
 * same card a term it has deliberately blanked. */
export type SuccessionSideView = {
  label: string;
  name: string;
  parties: string[];
  /** Where this person's page is. Absent both for the person whose page the
   * card is already on, and for a game that does not want the answer one click
   * away; the card renders plain text either way. */
  url?: string;
  self: boolean;
  when: string;
};

/** One seat changing hands, as the card prints it. */
export type SuccessionChangeView = {
  key: string;
  testid: string;
  companyName: string;
  /** Absent where the card must not link out - see `SuccessionSideView.url`. */
  companyUrl?: string;
  role: string;
  gapDays: number;
  from: SuccessionSideView;
  to: SuccessionSideView;
  /** Set where a whole board changed on this day, so which of the departing
   * members this person actually followed is not something the register says.
   * The card names one of them and admits as much. */
  batchNote: string | null;
};

/** What a role nobody recorded is called. The pairing drops spells with no
 * role, so this should never be reached - it is here so that a hand-made edge
 * cannot print an empty gap where the seat should be. */
export const NO_ROLE = "funkcja niepodana w rejestrze";

export function successionBatchNote(batchSize: number): string | null {
  if (batchSize <= 1) return null;
  return (
    `Tego dnia zmieniło się ${batchSize} stanowisk tej samej funkcji - ` +
    "rejestr nie wskazuje, kto zajął czyje miejsce."
  );
}

/** This person's own spell, as the side of a handover they are on. */
function selfTerm(post: PersonSuccession): string {
  if (post.start && post.end) {
    return `kadencja ${shortDate(post.start)} – ${shortDate(post.end)}`;
  }
  if (post.start) return `kadencja od ${shortDate(post.start)} · nadal trwa`;
  if (post.end) return `kadencja do ${shortDate(post.end)}`;
  return "brak dat kadencji";
}

/** A person's posts as handover cards, read from their own side.
 *
 * `from` is whoever left the seat and `to` whoever took it, whichever of the
 * two this person is - so the arrow between them always points the way the
 * seat moved, and the labels never have to be conditional in the template.
 *
 * Extracted from `succession/PersonChanges.vue` when the card became something
 * a game renders too. The section still owns the fetch and the coverage line;
 * what moved here is only the mapping, which is the half that had to be shared.
 */
export function personSuccessionChanges(
  posts: PersonSuccession[],
  self: { name: string; parties?: string[] },
): SuccessionChangeView[] {
  return posts.flatMap((post, index) => {
    const neighbour = post.predecessor ?? post.successor;
    if (!neighbour) return [];

    const other: SuccessionSideView = {
      label: post.predecessor
        ? "Wcześniej na tym stanowisku"
        : "Następnie na tym stanowisku",
      name: neighbour.personName,
      parties: neighbour.parties,
      url: generateEntityUrl(
        "person",
        neighbour.personId,
        neighbour.personName,
      ),
      self: false,
      when: post.predecessor
        ? neighbour.end
          ? `kadencja do ${shortDate(neighbour.end)}`
          : "koniec kadencji nieznany"
        : neighbour.start
          ? `kadencja od ${shortDate(neighbour.start)}`
          : "początek kadencji nieznany",
    };
    const mine: SuccessionSideView = {
      label: "Ta osoba",
      name: self.name,
      parties: self.parties ?? [],
      self: true,
      when: selfTerm(post),
    };

    return [
      {
        batchNote: successionBatchNote(post.batchSize),
        // The edge on the other side is what makes a card unique: this person
        // can hold two spells of one seat, and the index alone would reorder
        // the cards under a refetch.
        key: `${neighbour.edgeId}-${index}`,
        testid: post.predecessor
          ? "succession-predecessor"
          : "succession-successor",
        companyName: post.companyName,
        companyUrl: generateEntityUrl(
          "place",
          post.companyId,
          post.companyName,
        ),
        role: post.role.trim() || NO_ROLE,
        gapDays: neighbour.gapDays,
        from: post.predecessor ? other : mine,
        to: post.predecessor ? mine : other,
      },
    ];
  });
}
