import type { Person, Company, Article, Region, Topic } from "~~/shared/model";
import { asArray } from "~~/shared/model";
import { OTHER_PARTY } from "~~/shared/misc";
import { relationsPlural } from "~/composables/edges";

export type EntityNode = Person | Company | Article | Region | Topic;

/** Where a link preview and a search result both stop reading. Going over does
 * not break anything, it just gets cut - and cut by them lands mid-word. */
const DESCRIPTION_LIMIT = 160;

/** The card a social platform draws is the only thing most people ever see of a
 * page. Without an image it renders as a bare link, so every entity page points
 * at the site card rather than at nothing. */
export const SOCIAL_CARD = "/social-card.png";

export function truncateDescription(
  text: string,
  limit: number = DESCRIPTION_LIMIT,
): string {
  if (text.length <= limit) return text;
  // Cut on a word boundary, unless the first word is already longer than the
  // budget - an article headline can be one unbroken url.
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[\s,.:;-]+$/, "")}…`;
}

/** What the link preview says under the title.
 *
 * `relationCount` is what the page itself is showing, so the description
 * promises what the visitor will actually find. A node with nothing attached to
 * it yet says so by omission rather than advertising "0 powiązań".
 */
export function entityDescription(
  entity: EntityNode,
  relationCount = 0,
): string {
  const relations =
    relationCount > 0
      ? `${relationCount} ${relationsPlural(relationCount)}`
      : undefined;

  switch (entity.type) {
    case "person": {
      // „Inne” is left out: it says there is a tie and not whose, and
      // „Jan Kowalski (Inne)” in a search result reads as a typo rather
      // than as that.
      const named = asArray(entity.parties).filter(
        (party) => party !== OTHER_PARTY,
      );
      const parties = named.length ? ` (${named.join(", ")})` : "";
      const lead = `${entity.name}${parties} w bazie koryciarstwa`;
      return truncateDescription(
        relations
          ? `${lead}: ${relations}, historia zatrudnienia w spółkach publicznych i starty w wyborach.`
          : `${lead}. Sprawdź historię zatrudnienia w spółkach publicznych i starty w wyborach.`,
      );
    }
    case "place":
      return truncateDescription(
        relations
          ? `Kto pracuje i pracował w ${entity.name}? ${relations} z osobami publicznymi, zebrane ze źródeł jawnych.`
          : `Kto pracuje i pracował w ${entity.name}? Powiązania z osobami publicznymi, zebrane ze źródeł jawnych.`,
      );
    case "region":
      return truncateDescription(
        `Koryciarstwo w regionie ${entity.name}: kto z lokalnej władzy zasiada w spółkach publicznych i instytucjach.`,
      );
    case "article":
      return truncateDescription(
        relations
          ? `Osoby i instytucje wymienione w tym artykule - ${relations} w bazie Koryta.pl.`
          : `Artykuł w bazie Koryta.pl. Sprawdź, kogo wymienia i jak te osoby łączą się ze spółkami publicznymi.`,
      );
    case "topic":
      // The topic's own words when it has any: a story is the one kind of page
      // here whose description is written rather than derived.
      return truncateDescription(
        entity.description ||
          `${entity.name} - kto jest w tej sprawie i jak te osoby są ze sobą powiązane, na podstawie artykułów w bazie Koryta.pl.`,
      );
  }
}

/** og:type, which is what decides whether a platform files the link as a story
 * or as a profile. */
export function entityOgType(
  entity: EntityNode,
): "article" | "profile" | "website" {
  switch (entity.type) {
    case "article":
      return "article";
    case "person":
      return "profile";
    default:
      return "website";
  }
}
