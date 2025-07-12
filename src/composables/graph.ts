import { usePartyStatistics } from "@/composables/party";
import { useListEntity } from "@/composables/entity";
import { useArticles, getHostname } from "@/composables/entities/articles";
import { type Ref } from "vue";

export interface Node {
  name: string
  type: "circle" | "rect" | "document";
  color: string;
  sizeMult?: number
}

const { entities: people } = useListEntity("employed");
const { entities: companies } = useListEntity("company");
const { articles } = useArticles();

const { partyColors } = usePartyStatistics();


export function useGraph(showActiveArticles: Ref<boolean>, showInactiveArticles: Ref<boolean>) {
  const showArticles = showActiveArticles.value || showInactiveArticles.value

  const nodes = computed(() => {
    const result: Record<string, Node> = {};
    Object.entries(people.value).forEach(([key, person]) => {
      result[key] = {
        ...person,
        type: "circle",
        color:
          person.parties && person.parties.length > 0
            ? partyColors.value[person.parties[0]]
            : "#4466cc",
      };
    });
    if (companies.value) {
      Object.entries(companies.value).forEach(([key, company]) => {
        result[key] = {
          ...company,
          type: "rect",
          color: "gray",
        };
      });
    }
    if (showArticles && articles.value) {
      Object.entries(articles.value).forEach(([articleID, article]) => {
        const shouldShow = article.enrichedStatus.hideArticle ? showInactiveArticles.value : showActiveArticles.value;
        if (shouldShow) {
          const mentionedPeople = article.estimates?.mentionedPeople ?? 1
          const linkedPeople = article.people ? Object.keys(article.people).length : 0
          const peopleLeft = Math.max(1, mentionedPeople - linkedPeople)
          result[articleID] = {
            name: article.shortName || getHostname(article),
            sizeMult: Math.pow(peopleLeft, 0.3),
            type: "document",
            color: "pink", // TODO the color should be based if the article is active or not
          };
        }
      });
    }
    return result;
  });

  const edges = computed(() => {
    const result: { source: string; target: string; label: string }[] = [];

    Object.entries(people.value).forEach(([key, person]) => {
      Object.values(person.employments ?? {}).forEach((connection) => {
        if (connection?.connection?.id) {
          result.push({
            source: key,
            target: connection.connection.id,
            label: connection.relation,
          });
        }
      });
      Object.values(person.connections ?? {}).forEach((connection) => {
        if (connection?.connection?.id) {
          result.push({
            source: key,
            target: connection.connection.id,
            label: connection.relation,
          });
        }
      });
    });

    Object.entries(companies.value ?? {}).forEach(([key, company]) => {
      if (company.manager)
        result.push({
          source: key,
          target: company.manager.id,
          label: "zarządzający",
        });
      if (company.owner)
        result.push({
          source: key,
          target: company.owner.id,
          label: "właściciel",
        });
      Object.values(company.owners ?? {}).forEach((owner) => {
        result.push({
          source: key,
          target: owner.id,
          label: "właściciel",
        });
      });
    });

    if (showArticles) {
      Object.entries(articles.value ?? {}).forEach(([articleID, article]) => {
        Object.values(article.people || {}).forEach((person) => {
          result.push({
            source: articleID,
            target: person.id,
            label: "wspomina",
          });
        });
        Object.values(article.companies || {}).forEach((company) => {
          result.push({
            source: articleID,
            target: company.id,
            label: "wspomina",
          });
        });
      });
    }

    return result;
  });

  return {nodes, edges}
}
