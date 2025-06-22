import { type Linkable } from './entity'

export interface Company {
  name: string
  owner: Linkable<'company'>
  manager: Linkable<'employed'>
}
