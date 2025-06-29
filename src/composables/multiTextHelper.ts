import type { VTextarea, VTextField } from "vuetify/components"
import NestedConnestionField from '@/components/forms/NestedConnectionField.vue'
import { type Connection, type Textable} from "@/composables/model";

export type Type = 'textField' | 'textarea' | 'nestedConnection'

export interface CompatibleComponent {
  textField: VTextField
  textarea: VTextarea
  nestedConnection: typeof NestedConnestionField
}

export interface ComponentModel {
  textField: Textable
  textarea: Textable
  nestedConnection: Connection
}

export function emptyNestedConnection(): ComponentModel['nestedConnection'] {
  return {text: '', relation: ''} as ComponentModel['nestedConnection']
}

export function emptyTextable(): ComponentModel['textField'] & ComponentModel['textarea'] {
  return {text: ''}
}
