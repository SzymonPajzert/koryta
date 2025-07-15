import type EntityPicker from '@/components/forms/EntityPicker.vue';
import NestedConnestionField from '@/components/forms/NestedConnectionField.vue'
import TextableWrap from '@/components/forms/TextableWrap.vue'
import type { Connection, Textable, Destination} from "@/composables/model";
import { Link } from '@/composables/model'

export type Type = 'textField' | 'textarea' | 'nestedConnection' | 'entityPicker'

export interface CompatibleComponent {
  textField: typeof TextableWrap
  textarea: typeof TextableWrap
  nestedConnection: typeof NestedConnestionField
  entityPicker: typeof EntityPicker
}

export interface ComponentModel {
  textField: Textable
  textarea: Textable
  nestedConnection: Connection
  entityPicker: Link<Destination>
}

export function emptyNestedConnection(): ComponentModel['nestedConnection'] {
  return {text: '', relation: ''} as ComponentModel['nestedConnection']
}

export function emptyTextable(): ComponentModel['textField'] & ComponentModel['textarea'] {
  return {text: ''}
}

export function emptyEntityPicker(d: Destination): ComponentModel['entityPicker'] {
  return new Link(d, '', '')
}
