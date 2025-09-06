import type EntityPicker from "@/components/forms/EntityPicker.vue";
import type NestedConnestionField from "@/components/forms/NestedConnectionField.vue";
import type TextableWrap from "@/components/forms/TextableWrap.vue";
import type { Connection, Textable, Destination } from "~~/shared/model";
import { Link } from "~~/shared/model";

export type Type =
  | "textField"
  | "textarea"
  | "nestedCompanyConnection"
  | "nestedEmployedConnection"
  | "entityPicker";

export interface CompatibleComponent {
  textField: typeof TextableWrap;
  textarea: typeof TextableWrap;
  nestedEmployedConnection: typeof NestedConnestionField;
  nestedCompanyConnection: typeof NestedConnestionField;
  entityPicker: typeof EntityPicker;
}

export interface ComponentModel {
  textField: Textable;
  textarea: Textable;
  nestedEmployedConnection: Connection<"employed">;
  nestedCompanyConnection: Connection<"company">;
  entityPicker: Link<Destination>;
}

export function emptyNestedEmployedConnection(): ComponentModel["nestedEmployedConnection"] {
  return {
    text: "",
    relation: "",
  } as ComponentModel["nestedEmployedConnection"];
}

export function emptyNestedCompanyConnection(): ComponentModel["nestedCompanyConnection"] {
  return {
    text: "",
    relation: "",
  } as ComponentModel["nestedCompanyConnection"];
}

export function emptyTextable(): ComponentModel["textField"] &
  ComponentModel["textarea"] {
  return { text: "" };
}

export function emptyEntityPicker(
  d: Destination,
): ComponentModel["entityPicker"] {
  return new Link(d, "", "");
}
