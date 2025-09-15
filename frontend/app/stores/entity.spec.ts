import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createEntityStore } from './entity'

describe('entity store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('creates a store for employed', () => {
    const useEmployedStore = createEntityStore('employed')
    const store = useEmployedStore()
    expect(store.$id).toBe('entity_employed')
  })

  it('creates a store for company', () => {
    const useCompanyStore = createEntityStore('company')
    const store = useCompanyStore()
    expect(store.$id).toBe('entity_company')
  })
})