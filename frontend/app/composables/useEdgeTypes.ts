import {
  mdiAccountPlus,
  mdiAccountPlusOutline,
  mdiAccountStarOutline,
  mdiBriefcasePlusOutline,
  mdiDomain,
  mdiDomainPlus,
  mdiMapMarkerRadiusOutline,
  mdiNewspaperPlus,
  mdiOfficeBuildingOutline,
  mdiTagPlusOutline,
  mdiVoteOutline,
} from "@mdi/js";
import type { NodeType, EdgeType } from "~~/shared/model";

export type edgeTypeExt =
  | "owns_parent"
  | "owns_child"
  | "connection"
  | "employed"
  | "mentioned_person"
  | "mentioned_company"
  | "owns_region"
  | "seat_region"
  | "election"
  | "tagged";

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
  /** How the relation reads from the page it is being added on, per direction:
   * "outgoing" is the sentence with this page as the subject. The composer
   * shows these as its choices, so they have to be verbs rather than the
   * "Dodaj …" imperatives the old button list used. */
  verbs?: Partial<Record<"outgoing" | "incoming", string>>;
  allowedDirections?: ("outgoing" | "incoming")[];
  buttons?: Partial<Record<"outgoing" | "incoming", ButtonConfig>>;
};

export const edgeTypeOptions: Record<edgeTypeExt, edgeTypeOption> = {
  owns_parent: {
    value: "owns_parent",
    verbs: { incoming: "należy do", outgoing: "jest właścicielem" },
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
        icon: mdiDomain,
      },
    },
  },
  owns_child: {
    value: "owns_child",
    verbs: { outgoing: "jest właścicielem", incoming: "należy do" },
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
        icon: mdiDomainPlus,
      },
    },
  },
  // Where a company is registered. This used to write `owns`, because the seat
  // and ownership were one type; it now writes `seat`, so correcting a
  // company's town cannot be mistaken for a claim about who holds its shares.
  seat_region: {
    value: "seat_region",
    verbs: { outgoing: "jest siedzibą dla", incoming: "ma siedzibę w" },
    label: "Siedziba",
    sourceType: "region",
    targetType: "place",
    sourceLabel: "Region",
    targetLabel: "Spółka",
    realType: "seat",
    buttons: {
      incoming: {
        label: (_name) => "Popraw siedzibę firmy",
        icon: mdiMapMarkerRadiusOutline,
      },
    },
  },
  // A gmina, powiat or województwo that holds shares. The register names one
  // for 1,675 companies, and for 252 of them it is not the local government
  // where the company sits - which is the whole reason the seat moved out of
  // `owns`.
  owns_region: {
    value: "owns_region",
    verbs: { outgoing: "jest właścicielem", incoming: "należy do" },
    label: "Właściciel publiczny",
    sourceType: "region",
    targetType: "place",
    sourceLabel: "Gmina, powiat lub województwo",
    targetLabel: "Spółka",
    realType: "owns",
    buttons: {
      incoming: {
        label: (_name) => "Dodaj samorząd jako właściciela",
        icon: mdiMapMarkerRadiusOutline,
      },
    },
  },
  connection: {
    value: "connection",
    verbs: { outgoing: "jest powiązany/a z", incoming: "jest powiązany/a z" },
    label: "Powiązanie z",
    sourceType: "person",
    targetType: "person",
    sourceLabel: "Osoba 1",
    targetLabel: "Osoba 2",
    realType: "connection",
    buttons: {
      outgoing: {
        label: (name) => "Dodaj osobę, którą " + name + " zna",
        icon: mdiAccountPlusOutline,
      },
    },
  },
  mentioned_person: {
    value: "mentioned_person",
    verbs: { outgoing: "wspomina", incoming: "jest wspomniany/a w" },
    label: "Wspomina osobę",
    sourceType: "article",
    targetType: "person",
    sourceLabel: "Artykuł",
    targetLabel: "Wspomniana osoba",
    realType: "mentions",
    buttons: {
      incoming: {
        label: (name) => "Dodaj artykuł wspominający " + name,
        icon: mdiNewspaperPlus,
      },
      outgoing: {
        label: (_name) => "Wspomniana osoba w artykule",
        icon: mdiAccountPlusOutline,
      },
    },
  },
  mentioned_company: {
    value: "mentioned_company",
    verbs: { outgoing: "wspomina", incoming: "jest wspomniany/a w" },
    label: "Wspomina firmę/urząd",
    sourceType: "article",
    targetType: "place",
    sourceLabel: "Artykuł",
    targetLabel: "Wspomniana firma",
    realType: "mentions",
    buttons: {
      incoming: {
        label: (name) => "Dodaj artykuł wspominający " + name,
        icon: mdiNewspaperPlus,
      },
      outgoing: {
        label: (_name) => "Wspomniane miejsce w artykule",
        icon: mdiDomainPlus,
      },
    },
  },
  employed: {
    value: "employed",
    verbs: { outgoing: "pracował/a w", incoming: "zatrudniał/a" },
    label: "Zatrudniony/a w",
    sourceType: "person",
    targetType: "place",
    sourceLabel: "Pracownik",
    targetLabel: "Pracodawca",
    realType: "employed",
    buttons: {
      outgoing: {
        label: (name) => "Dodaj gdzie " + name + " pracuje",
        icon: mdiBriefcasePlusOutline,
      },
      incoming: {
        label: (_name) => "Dodaj osobę, która pracuje w tej firmie", // New button
        icon: mdiAccountPlus,
      },
    },
  },
  tagged: {
    value: "tagged",
    verbs: { outgoing: "dotyczy tematu", incoming: "obejmuje artykuł" },
    label: "Temat",
    sourceType: "article",
    targetType: "topic",
    sourceLabel: "Artykuł",
    targetLabel: "Temat",
    realType: "tagged",
    buttons: {
      outgoing: {
        label: (_name) => "Przypisz do tematu",
        icon: mdiTagPlusOutline,
      },
      incoming: {
        label: (_name) => "Dodaj artykuł do tematu",
        icon: mdiNewspaperPlus,
      },
    },
  },
  election: {
    value: "election",
    verbs: { outgoing: "kandydował/a w", incoming: "miał kandydata" },
    label: "Kandydował/a w",
    sourceType: "person",
    targetType: "region",
    sourceLabel: "Kandydat",
    targetLabel: "Region",
    realType: "election",
    buttons: {
      outgoing: {
        label: (name) => "Dodaj wybory, w których brał udział " + name,
        icon: mdiVoteOutline,
      },
      incoming: {
        label: (_name) => "Dodaj kandydata w tym regionie",
        icon: mdiAccountStarOutline,
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

/** One way the page being viewed can be joined to another entity. */
export type RelationChoice = {
  edgeTypeExt: edgeTypeExt;
  direction: "outgoing" | "incoming";
  /** How it reads with this page as the subject. */
  verb: string;
  icon?: string;
  /** Recorded against the institution the picked region's urząd is, rather
   * than against the region - see `officeChoice`. */
  viaOffice?: boolean;
};

/** Every relation that makes sense between the page you are on and the entity
 * you just picked.
 *
 * The composer asks "who" before "how" on purpose, and this is what makes that
 * order work: once both kinds are known most pairs leave one or two verbs, so
 * the question is a couple of chips rather than the list of every relation the
 * schema has. Direction never reaches the reader - it is folded into the verb,
 * which is why the same edge type can appear once for each way round.
 *
 * @param allowed narrows to the relations a particular section offers.
 */
export function relationChoices(
  nodeType: NodeType,
  otherType: NodeType,
  allowed?: edgeTypeExt[],
): RelationChoice[] {
  const choices: RelationChoice[] = [];

  for (const option of Object.values(edgeTypeOptions)) {
    if (allowed && !allowed.includes(option.value)) continue;
    const directions = option.allowedDirections ?? ["outgoing", "incoming"];

    for (const direction of directions) {
      const subject =
        direction === "outgoing" ? option.sourceType : option.targetType;
      const object =
        direction === "outgoing" ? option.targetType : option.sourceType;
      if (subject !== nodeType || object !== otherType) continue;

      const verb = option.verbs?.[direction];
      if (!verb) continue;
      choices.push({
        edgeTypeExt: option.value,
        direction,
        verb,
        icon: option.buttons?.[direction]?.icon,
      });
    }
  }

  // `owns` is stored once but offered as owns_parent and owns_child, which for
  // a place-to-place pair describe the same two sentences twice over. Keep the
  // first of each reading.
  const seen = new Set<string>();
  return choices.filter((choice) => {
    const key = `${edgeTypeOptions[choice.edgeTypeExt].realType}:${choice.verb}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A post in the urząd that runs a region, or in a unit under it.
 *
 * Offered beside the candidacy when a person is joined to a region, because
 * "zastępca prezydenta Wejherowa" is a job in Wejherowo that the site had no
 * way to record: the region was only ever something to stand for election in,
 * and the urząd is in no register the pipelines read, so there was no company
 * to pick either.
 *
 * Not an entry of `edgeTypeOptions`, which is what `relationChoices` reads for
 * every pair - the article dialog among its callers. The edge this stores is an
 * `employed` one to a place, and the region only says which place; anywhere
 * that took the choice at face value would store the gmina as the employer.
 *
 * @param allowed narrows as it does for `relationChoices`: a section that is
 * not about employment does not offer it.
 */
export function officeChoice(
  nodeType: NodeType,
  otherType: NodeType,
  allowed?: edgeTypeExt[],
): RelationChoice | undefined {
  if (nodeType !== "person" || otherType !== "region") return undefined;
  if (allowed && !allowed.includes("employed")) return undefined;
  return {
    edgeTypeExt: "employed",
    direction: "outgoing",
    verb: "pracował/a w urzędzie lub jednostce podległej",
    icon: mdiOfficeBuildingOutline,
    viaOffice: true,
  };
}
