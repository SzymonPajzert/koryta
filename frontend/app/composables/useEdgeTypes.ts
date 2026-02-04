import type { NodeType, EdgeType } from "~~/shared/model";

export type edgeTypeExt =
  | "owns_parent"
  | "owns_child"
  | "connection"
  | "employed"
  | "mentioned_person"
  | "mentioned_company"
  | "owns_region";

export type edgeTypeOption = {
  value: edgeTypeExt;
  label: string;
  sourceType: NodeType;
  targetType: NodeType;
  realType: EdgeType;
};

export const edgeTypeOptions: Record<edgeTypeExt, edgeTypeOption> = {
  owns_parent: {
    value: "owns_parent",
    label: "Właściciel",
    sourceType: "place",
    targetType: "place",
    realType: "owns",
  },
  owns_child: {
    value: "owns_child",
    label: "Właściciel",
    sourceType: "place",
    targetType: "place",
    realType: "owns",
  },
  owns_region: {
    value: "owns_region",
    label: "Region właściciel",
    sourceType: "region",
    targetType: "place",
    realType: "owns",
  },
  connection: {
    value: "connection",
    label: "Powiązanie z",
    sourceType: "person",
    targetType: "person",
    realType: "connection",
  },
  mentioned_person: {
    value: "mentioned_person",
    label: "Wspomina osobę",
    sourceType: "article",
    targetType: "person",
    realType: "mentions",
  },
  mentioned_company: {
    value: "mentioned_company",
    label: "Wspomina firmę/urząd",
    sourceType: "article",
    targetType: "place",
    realType: "mentions",
  },
  employed: {
    value: "employed",
    label: "Zatrudniony/a w",
    sourceType: "person",
    targetType: "place",
    realType: "employed",
  },
};
