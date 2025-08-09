import { ref as dbRef, push } from "firebase/database";
import type {
  Article,
  Company,
  Destination,
  DestinationTypeMap,
  NepoEmployment,
  Todo,
  KRSCompany,
  PersonRejestr,
} from "../../shared/model";
import { Link } from "../../shared/model";

export function useDBUtils() {
  const db = useDatabase();

  function newKey() {
    const newKey = push(dbRef(db, "_temp_keys/employments")).key;
    if (!newKey) {
      throw "Failed to create a key";
    }
    return newKey;
  }

  function recordOf<T>(value: T): Record<string, T> {
    const result: Record<string, T> = {};
    result[newKey()] = value;
    return result;
  }

  function fillBlanks<D extends Destination>(
    value: Partial<DestinationTypeMap[D]>,
    d: D,
  ): Required<DestinationTypeMap[D]>;
  function fillBlanks<D extends Destination>(
    valueUntyped: Partial<DestinationTypeMap[D]>,
    d: D,
  ) {
    if (d == "company") {
      const value = valueUntyped as Partial<Company>;
      const result: Required<DestinationTypeMap["company"]> = {
        name: value.name ?? "",
        krsNumber: value.krsNumber ?? "",
        nipNumber: value.nipNumber ?? "",

        owners: value.owners ?? recordOf(new Link("company", "", "")),
        todos: value.todos ?? recordOf(new Link("todo", "", "")),
        comments: value.comments ?? recordOf({ text: "" }),

        owner: value.owner ?? new Link("company", "", ""),
        manager: value.manager ?? new Link("employed", "", ""),
      };
      return result;
    }

    if (d == "employed") {
      const value = valueUntyped as Partial<NepoEmployment>;
      const result: Required<DestinationTypeMap["employed"]> = {
        name: value.name ?? "",
        parties: value.parties ?? [],

        employments:
          value.employments ??
          recordOf({
            text: "",
            relation: "",
            connection: new Link("company", "", ""),
          }),
        connections:
          value.connections ??
          recordOf({
            text: "",
            relation: "",
            connection: new Link("employed", "", ""),
          }),
        todos: value.todos ?? recordOf(new Link("todo", "", "")),
        comments: value.comments ?? recordOf({ text: "" }),
      };
      return result;
    }

    if (d == "data") {
      const value = valueUntyped as Partial<Article>;
      const result: Required<DestinationTypeMap["data"]> = {
        name: value.name ?? "",
        sourceURL: value.sourceURL ?? "",
        shortName: value.shortName ?? "",
        estimates: value.estimates ?? { mentionedPeople: 0 },
        people: value.people ?? recordOf(new Link("employed", "", "")),
        companies: value.companies ?? recordOf(new Link("company", "", "")),
        date: value.date ?? Date.now(),
        status: value.status ?? {
          tags: [],
          signedUp: {},
          markedDone: {},
          confirmedDone: false,
        },
        todos: value.todos ?? recordOf(new Link("todo", "", "")),
        comments: value.comments ?? recordOf({ text: "" }),
      };
      return result;
    }

    if (d == "todo") {
      const value = valueUntyped as Partial<Todo>;
      const result: Required<DestinationTypeMap["todo"]> = {
        name: value.name ?? "",
        text: value.text ?? "",
        subtasks: value.subtasks ?? recordOf(new Link("todo", "", "")),
      };
      return result;
    }

    if (d == "external/rejestr-io/krs") {
      const value = valueUntyped as Partial<KRSCompany>;
      const result: Required<DestinationTypeMap["external/rejestr-io/krs"]> = {
        name: value.name ?? "",
        connections:
          value.connections ?? recordOf({ state: "aktualne", type: "person" }),
        external_basic: value.external_basic ?? {
          id: "",
          nazwy: { skrocona: "" },
        },
        basic: value.basic ?? { id: "", nazwy: { skrocona: "" } },
      };
      return result;
    }

    if (d == "external/rejestr-io/person") {
      const value = valueUntyped as Partial<PersonRejestr>;
      const result: Required<DestinationTypeMap["external/rejestr-io/person"]> =
        {
          name: value.name ?? "",
          external_basic: value.external_basic ?? {
            id: "",
            state: "aktualne",
            tozsamosc: { data_urodzenia: "" },
          },
          comment: value.comment ?? recordOf(""),
          link: value.link ?? recordOf(""),

          status: value.status ?? "unknown",
          score: value.score ?? 0,
          person: value.person ?? new Link("employed", "", ""),
        };
      return result;
    }

    throw new Error("Unknown destination type");
  }

  function removeBlanks<D extends Destination>(
    obj: DestinationTypeMap[D],
  ): DestinationTypeMap[D] {
    // Create a new object to avoid mutating the original
    const payload: any = {};

    for (const key in obj) {
      // Ensure the key belongs to the object and not its prototype chain
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key as keyof DestinationTypeMap[D]];

        if (value === null) continue;
        if (value === undefined) continue;
        if (value === "") continue;
        if (value instanceof Link) {
          if (value.id === "") continue;
        }
        if (value instanceof Object) {
          const entries = Object.entries(value);
          if (entries.length === 0) continue;
          if (entries.length === 1 && Array.isArray(entries[0])) {
            const [_, v] = entries[0];
            if (v instanceof Link) {
              if (v.id === "") continue;
            }
          }
        }

        if (value !== null && value !== undefined && value !== "") {
          payload[key] = value;
        }
      }
    }

    return payload as DestinationTypeMap[D];
  }

  return { newKey, recordOf, fillBlanks, removeBlanks };
}
