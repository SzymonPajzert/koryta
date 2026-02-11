import type { NodeType, EdgeType } from "~~/shared/model";

export type edgeTypeExt =
  | "owns_parent"
  | "owns_child"
  | "connection"
  | "employed"
  | "mentioned_person"
  | "mentioned_company"
  | "owns_region";

export type ButtonConfig = {
  label: (name: string) => string;
  icon: string;
};

export type edgeTypeOption = {
  value: edgeTypeExt;
  label: string;
  sourceType: NodeType;
  targetType: NodeType;
  sourceLabel?: string;
  targetLabel?: string;
  realType: EdgeType;
  allowedDirections?: ("outgoing" | "incoming")[];
  buttons?: Partial<Record<"outgoing" | "incoming", ButtonConfig>>;
};

export const edgeTypeOptions: Record<edgeTypeExt, edgeTypeOption> = {
  owns_parent: {
    value: "owns_parent",
    label: "Właściciel",
    sourceType: "place",
    targetType: "place",
    sourceLabel: "Właściciel",
    targetLabel: "Podmiot zależny",
    realType: "owns",
    allowedDirections: ["incoming"],
    buttons: {
      incoming: {
        label: (_name) => "Dodaj firmę matkę",
        icon: "mdi-domain",
      },
    },
  },
  owns_child: {
    value: "owns_child",
    label: "Właściciel",
    sourceType: "place",
    targetType: "place",
    sourceLabel: "Właściciel",
    targetLabel: "Podmiot zależny",
    realType: "owns",
    allowedDirections: ["outgoing"],
    buttons: {
      outgoing: {
        label: (_name) => "Dodaj firmę córkę",
        icon: "mdi-domain-plus",
      },
    },
  },
  owns_region: {
    value: "owns_region",
    label: "Region właściciel",
    sourceType: "region",
    targetType: "place",
    sourceLabel: "Region",
    targetLabel: "Jednostka podległa",
    realType: "owns",
    buttons: {
      incoming: {
        label: (_name) => "Dodaj region zarządzający firmą",
        icon: "mdi-map-marker-radius-outline",
      },
    },
  },
  connection: {
    value: "connection",
    label: "Powiązanie z",
    sourceType: "person",
    targetType: "person",
    sourceLabel: "Osoba 1",
    targetLabel: "Osoba 2",
    realType: "connection",
    buttons: {
      outgoing: {
        label: (name) => "Dodaj osobę, którą " + name + " zna",
        icon: "mdi-account-plus-outline",
      },
    },
  },
  mentioned_person: {
    value: "mentioned_person",
    label: "Wspomina osobę",
    sourceType: "article",
    targetType: "person",
    sourceLabel: "Artykuł",
    targetLabel: "Wspomniana osoba",
    realType: "mentions",
    buttons: {
      incoming: {
        label: (name) => "Dodaj artykuł wspominający " + name,
        icon: "mdi-newspaper-plus",
      },
      outgoing: {
        label: (_name) => "Wspomniana osoba w artykule",
        icon: "mdi-account-plus-outline",
      },
    },
  },
  mentioned_company: {
    value: "mentioned_company",
    label: "Wspomina firmę/urząd",
    sourceType: "article",
    targetType: "place",
    sourceLabel: "Artykuł",
    targetLabel: "Wspomniana firma",
    realType: "mentions",
    buttons: {
      incoming: {
        label: (name) => "Dodaj artykuł wspominający " + name,
        icon: "mdi-newspaper-plus",
      },
      outgoing: {
        label: (_name) => "Wspomniane miejsce w artykule",
        icon: "mdi-domain-plus",
      },
    },
  },
  employed: {
    value: "employed",
    label: "Zatrudniony/a w",
    sourceType: "person",
    targetType: "place",
    sourceLabel: "Pracownik",
    targetLabel: "Pracodawca",
    realType: "employed",
    buttons: {
      outgoing: {
        label: (name) => "Dodaj gdzie " + name + " pracuje",
        icon: "mdi-briefcase-plus-outline",
      },
      incoming: {
        label: (_name) => "Dodaj osobę, która pracuje w tej firmie", // New button
        icon: "mdi-account-plus",
      },
    },
  },
};

export type NewEdgeButton = {
  edgeType: string;
  edgeTypeExt: edgeTypeExt;
  direction: "incoming" | "outgoing";
  nodeType: NodeType;
  icon: string;
  text: string;
};

export function useEdgeButtons(nodeName: string): NewEdgeButton[] {
  const result: NewEdgeButton[] = [];

  for (const key in edgeTypeOptions) {
    const option = edgeTypeOptions[key as edgeTypeExt];
    if (option.buttons) {
      if (option.buttons.outgoing) {
        result.push({
          edgeType: key,
          edgeTypeExt: option.value,
          direction: "outgoing",
          nodeType: option.sourceType, // We are source, we add target
          icon: option.buttons.outgoing.icon,
          text: option.buttons.outgoing.label(nodeName),
        });
      }
      if (option.buttons.incoming) {
        result.push({
          edgeType: key,
          edgeTypeExt: option.value,
          direction: "incoming",
          nodeType: option.targetType, // We are target, we add source
          icon: option.buttons.incoming.icon,
          text: option.buttons.incoming.label(nodeName),
        });
      }
    }
  }

  return result;
}
