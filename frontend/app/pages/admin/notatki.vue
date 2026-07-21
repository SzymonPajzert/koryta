<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">Wszystkie Notatki</h1>
      </v-col>
    </v-row>

    <v-card v-for="entry in flatNotes" :key="entry.key" class="mb-4">
      <v-row no-gutters>
        <!-- Node Name Column -->
        <v-col cols="12" md="3" class="pa-4 border-e">
          <div class="text-subtitle-1 font-weight-bold">
            <template v-if="entry.node">
              <NuxtLink :to="generateEntityUrl(entry.node.type, entry.nodeId, entry.node.name)">
                {{ entry.node.name }}
              </NuxtLink>
            </template>
            <template v-else>
              {{ entry.nodeId }}
              <v-progress-circular v-if="loadingNodes[entry.nodeId]" indeterminate size="20" class="ml-2" />
            </template>
          </div>
          <div class="text-caption mt-1">Autor: {{ entry.userUid }}</div>
        </v-col>

        <!-- Note Content Column -->
        <v-col cols="12" md="5" class="pa-4 border-e">
          <NoteSourceCard :model-value="entry.source" :is-editing="false" />
        </v-col>

        <!-- Admin Column -->
        <v-col cols="12" md="4" class="pa-4">
          <div class="text-subtitle-2 mb-2">Administracja</div>
          <v-select
            :model-value="entry.source.adminStatus ?? null"
            :items="statusOptions"
            label="Status"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            class="mb-2"
            :loading="saving[entry.key]"
            @update:model-value="(val) => updateSourceAdmin(entry, { adminStatus: val ?? null })"
          />
          <v-select
            :model-value="entry.source.adminType ?? ''"
            :items="typeOptions"
            label="Typ zgłoszenia"
            density="compact"
            variant="outlined"
            hide-details
            :loading="saving[entry.key]"
            @update:model-value="(val) => updateSourceAdmin(entry, { adminType: val ?? '' })"
          />
        </v-col>
      </v-row>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCollection, useFirebaseApp } from 'vuefire'
import { getFirestore, collection } from 'firebase/firestore'
import { generateEntityUrl } from '~/composables/slugs'
import { authRequest } from '~/composables/auth'
import type { Note, NoteSource, Node, NoteAdminStatus } from '~~/shared/model'
import { NoteSourceCard } from '#components'

definePageMeta({
  middleware: "admin",
});

const firebaseApp = useFirebaseApp()
const db = getFirestore(firebaseApp, "koryta-pl")
const notesRef = collection(db, 'notes')
// useCollection adds 'id' to elements, so we can cast it
const notes = useCollection<Note & { id: string }>(notesRef)

type FlatNote = {
  key: string
  noteId: string
  nodeId: string
  userUid: string
  source: NoteSource
  sourceIndex: number
  node?: Node
}

const nodesData = ref<Record<string, Node>>({})

// Each source is reviewed independently, so flatten every note's sources into
// its own row rather than joining them under a single card.
const flatNotes = computed<FlatNote[]>(() => {
  return notes.value.flatMap((note) =>
    (note.sources || []).map((source, sourceIndex) => ({
      key: `${note.id}-${sourceIndex}`,
      noteId: note.id,
      nodeId: note.nodeId,
      userUid: note.userUid,
      source,
      sourceIndex,
      node: nodesData.value[note.nodeId],
    }))
  )
})
const loadingNodes = ref<Record<string, boolean>>({})
const saving = ref<Record<string, boolean>>({})

const statusOptions = [
  { title: 'Nierozwiązane', value: 'unresolved' },
  { title: 'Rozwiązane', value: 'resolved' },
]

const typeOptions = [
  { title: 'Brak', value: '' },
  { title: 'Brakujące dane / Błąd', value: 'missing_data' },
  { title: 'Nowe powiązanie', value: 'new_connection' },
  { title: 'Ciekawostka / Kontekst', value: 'context' },
  { title: 'Inne', value: 'other' }
]

const updateSourceAdmin = async (
  entry: FlatNote,
  patch: { adminStatus?: NoteAdminStatus | null; adminType?: string | null }
) => {
  saving.value[entry.key] = true
  try {
    await authRequest('/api/notes/admin', {
      method: 'POST',
      body: {
        noteId: entry.noteId,
        sourceIndex: entry.sourceIndex,
        ...patch,
      },
    })
  } catch (error) {
    console.error('Failed to update note admin data', error)
  } finally {
    saving.value[entry.key] = false
  }
}

const fetchNodeData = async (nodeId: string) => {
  if (nodesData.value[nodeId] || loadingNodes.value[nodeId]) return
  loadingNodes.value[nodeId] = true

  try {
    // Use latest=true so non-approved nodes (common for note targets) still
    // resolve a name instead of 404ing.
    const data = await $fetch<{ node: Node }>(`/api/nodes/${nodeId}`, {
      query: { latest: 'true' },
    })
    nodesData.value[nodeId] = data.node
  } catch (error) {
    console.error(`Failed to fetch node ${nodeId}`, error)
  } finally {
    loadingNodes.value[nodeId] = false
  }
}

watch(() => notes.value, (newNotes) => {
  newNotes.forEach((note) => {
    if (note.nodeId && !nodesData.value[note.nodeId]) {
      fetchNodeData(note.nodeId)
    }
  })
}, { immediate: true })
</script>
