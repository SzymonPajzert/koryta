import { useRTDB } from '@vueuse/firebase/useRTDB'
import { db } from '@/firebase'
import { ref as dbRef, push, set, type ThenableReference } from 'firebase/database'
import type { NepoEmployment, DestinationTypeMap } from './model'
import { useAuthState } from './auth'
import {type Destination} from './model'

function operation(editKey?: string) {
  let operation = push;
  if (editKey && isAdmin.value) {
    operation = (parent, value) => {
      set(parent, value);
      return {key: editKey, ref: parent} as ThenableReference
    }
  }
  return operation
}

const { user, isAdmin } = useAuthState()

export function useListEntity<D extends Destination>(entity: D) {

  type T = DestinationTypeMap[D]

  const entities = useRTDB<Record<string, T>>(dbRef(db, entity))
  const suggestions = useRTDB<Record<string, T>>(dbRef(db, `suggestions/${entity}`))

  function submitPath(): string {
    if (isAdmin.value) return entity // Only admins can actually edit
    return `suggestions/${entity}` // Everything else goes to suggestion
  }

  function submit(value: T, editKey?: string) {
    if (!user.value?.uid) {
      return "User not authenticated or UID not available."
    }

    const path = dbRef(db, submitPath())
    const op = operation()
    console.log("trying to write: ", value)

    const keyRef = op(path, {
      ...value,
      date: Date.now(),
      user: user.value?.uid,
    }).key;
    push(dbRef(db, `user/${user.value?.uid}/suggestions/${entity}`), keyRef)
  }

  return { entities, suggestions, submit }
}
