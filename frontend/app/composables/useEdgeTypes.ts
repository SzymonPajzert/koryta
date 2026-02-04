import type { NodeType, EdgeType } from "~~/shared/model";

export type edgeTypeOption = {
  value: string;
  label: string;
  sourceType: NodeType;
  targetType: NodeType;
  realType: EdgeType;
};

export const edgeTypeOptions: edgeTypeOption[] = [
  {
    value: "owns",
    label: "Właściciel",
    sourceType: "place",
    targetType: "place",
    realType: "owns",
  },
  {
    value: "owns_region",
    label: "Region właściciel",
    sourceType: "region",
    targetType: "place",
    realType: "owns",
  },
  {
    value: "connection",
    label: "Powiązanie z",
    sourceType: "person",
    targetType: "person",
    realType: "connection",
  },
  {
    value: "mentioned_person",
    label: "Wspomina osobę",
    sourceType: "article",
    targetType: "person",
    realType: "mentions",
  },
  {
    value: "mentioned_company",
    label: "Wspomina firmę/urząd",
    sourceType: "article",
    targetType: "place",
    realType: "mentions",
  },
  {
    value: "employed",
    label: "Zatrudniony/a w",
    sourceType: "person",
    targetType: "place",
    realType: "employed",
  },
];

export function useEdgeTypes() {
  const getRealType = (t: string | undefined): EdgeType => {
    if (!t) return "connection";
    const option = edgeTypeOptions.find((o) => o.value === t);
    return option?.realType || (t as EdgeType);
  };

  const getEdgeOption = (t: string | undefined) => {
    return edgeTypeOptions.find((o) => o.value === t);
  };

  return {
    edgeTypeOptions,
    getRealType,
    getEdgeOption,
  };
}
