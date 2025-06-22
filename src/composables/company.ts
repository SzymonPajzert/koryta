import { Link } from './entity'

export interface Company {
  name: string
  owner: Link<'company'>
  manager: Link<'employed'>
}
