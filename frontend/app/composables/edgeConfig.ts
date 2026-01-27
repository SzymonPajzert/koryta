import type { NodeType } from "~~/shared/model";

export type NewEdgeButton = {
  edgeType: string;
  direction: "incoming" | "outgoing";
  nodeType: NodeType;
  icon: string;
  text: string;
};

export function useEdgeButtons(nodeName: string): NewEdgeButton[] {
  return [
    {
      edgeType: "mentioned_person",
      direction: "incoming",
      nodeType: "person",
      icon: "mdi-newspaper-plus",
      text: "Dodaj artykuł wspominający " + nodeName,
    },
    {
      edgeType: "employed",
      direction: "outgoing",
      nodeType: "person",
      icon: "mdi-briefcase-plus-outline",
      text: "Dodaj gdzie " + nodeName + " pracuje",
    },
    {
      edgeType: "connection",
      direction: "outgoing",
      nodeType: "person",
      icon: "mdi-account-plus-outline",
      text: "Dodaj osobę, którą " + nodeName + " zna",
    },
    {
      edgeType: "mentioned_company",
      direction: "incoming",
      nodeType: "place",
      icon: "mdi-newspaper-plus",
      text: "Dodaj artykuł wspominający " + nodeName,
    },
    {
      edgeType: "owns",
      direction: "outgoing",
      nodeType: "place",
      icon: "mdi-domain-plus",
      text: "Dodaj firmę córkę",
    },
    {
      edgeType: "owns",
      direction: "incoming",
      nodeType: "place",
      icon: "mdi-domain",
      text: "Dodaj firmę matkę",
    },
    {
      edgeType: "owns_region", // This maps to "owns" but triggers region source picker
      direction: "incoming",
      nodeType: "place",
      icon: "mdi-map-marker-radius-outline",
      text: "Dodaj region zarządzający firmą",
    },
    {
      edgeType: "mentioned_person",
      direction: "outgoing",
      nodeType: "article",
      icon: "mdi-account-plus-outline",
      text: "Wspomniana osoba w artykule",
    },
    {
      edgeType: "mentioned_company",
      direction: "outgoing",
      nodeType: "article",
      icon: "mdi-domain-plus",
      text: "Wspomniane miejsce w artykule",
    },
  ];
}
