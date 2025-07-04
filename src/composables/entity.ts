import { useRTDB } from '@vueuse/firebase/useRTDB'
import { db } from '@/firebase'
import { ref as dbRef, push, set, type ThenableReference } from 'firebase/database'
import type { NepoEmployment, DestinationTypeMap, Nameable } from './model'
import { useAuthState } from './auth'
import {type Destination} from './model'

const { user, isAdmin } = useAuthState()

export function useListEntity<D extends Destination>(entity: D) {
  type T = DestinationTypeMap[D]

  // TODO you can migrate here to list suggestions from the user
  const entities = useRTDB<Record<string, T>>(dbRef(db, entity))
  const suggestions = useRTDB<Record<string, T>>(dbRef(db, `suggestions/${entity}`))

  function submitPath(editKey: string | undefined): string {
    let result = `suggestions/${entity}`  // Everything else goes to suggestion
    if (isAdmin.value) result = entity    // Only admins can actually edit
    if (editKey) result = `${result}/${editKey}`
    return result
  }

  function operation(editKey: string | undefined) {
    let operation = push;
    if (editKey && isAdmin.value) {
      operation = (parent, value) => {
        set(parent, value);
        return {key: editKey, ref: parent} as ThenableReference
      }
    }
    return operation
  }

  function submit(value: T, editKey: string | undefined) {
    if (!user.value?.uid) {
      return { error: "User not authenticated or UID not available." }
    }

    const path = dbRef(db, submitPath(editKey))
    const op = operation(editKey)
    console.debug("trying to write: ", value)

    const keyRef = op(path, {
      ...value,
      date: Date.now(),
      user: user.value?.uid,
    }).key;
    push(dbRef(db, `user/${user.value?.uid}/suggestions/${entity}`), keyRef)
    return { key: keyRef }
  }

  return { entities, suggestions, submit }
}
