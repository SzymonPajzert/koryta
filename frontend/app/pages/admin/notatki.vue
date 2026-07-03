<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">Wszystkie Notatki</h1>
      </v-col>
    </v-row>

    <v-card v-for="note in notes" :key="note.id" class="mb-4">
      <v-row no-gutters>
        <!-- Node Name Column -->
        <v-col cols="12" md="3" class="pa-4 border-e">
          <div class="text-subtitle-1 font-weight-bold">
            <template v-if="nodesData[note.nodeId]">
              <NuxtLink :to="generateEntityUrl(nodesData[note.nodeId].type, note.nodeId, nodesData[note.nodeId].name)">
                {{ nodesData[note.nodeId].name }}
              </NuxtLink>
            </template>
            <template v-else>
              {{ note.nodeId }}
              <v-progress-circular v-if="loadingNodes[note.nodeId]" indeterminate size="20" class="ml-2" />
            </template>
          </div>
          <div class="text-caption mt-1">Autor: {{ note.userUid }}</div>
        </v-col>

        <!-- Note Content Column -->
        <v-col cols="12" md="5" class="pa-4 border-e">
          <div v-if="!note.sources || note.sources.length === 0" class="text-medium-emphasis">
            Brak źródeł
          </div>
          <div v-else>
            <NoteSourceCard
              v-for="(source, i) in note.sources"
              :key="i"
              :model-value="source"
              :is-editing="false"
            />
          </div>
        </v-col>

        <!-- Admin Column -->
        <v-col cols="12" md="4" class="pa-4">
          <div class="text-subtitle-2 mb-2">Administracja</div>
          <v-select
            v-model="note.adminStatus"
            :items="statusOptions"
            label="Status"
            density="compact"
            variant="outlined"
            hide-details
            class="mb-2"
            @update:model-value="updateNoteAdminData(note)"
          />
          <v-select
            v-model="note.adminType"
            :items="typeOptions"
            label="Typ zgłoszenia"
            density="compact"
            variant="outlined"
            hide-details
            @update:model-value="updateNoteAdminData(note)"
          />
        </v-col>
      </v-row>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useCollection, useFirebaseApp } from 'vuefire'
import { getFirestore, collection, doc, updateDoc } from 'firebase/firestore'
import { generateEntityUrl } from '~/composables/slugs'
import type { Note, Node } from '~~/shared/model'
import { NoteSourceCard } from '#components'

definePageMeta({
  middleware: "auth",
});

const firebaseApp = useFirebaseApp()
const db = getFirestore(firebaseApp, "koryta-pl")
const notesRef = collection(db, 'notes')
// useCollection adds 'id' to elements, so we can cast it
const notes = useCollection<Note & { id: string }>(notesRef)

const nodesData = ref<Record<string, Node>>({})
const loadingNodes = ref<Record<string, boolean>>({})

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

const updateNoteAdminData = async (note: Note & { id: string }) => {
  const noteDoc = doc(db, 'notes', note.id)
  await updateDoc(noteDoc, {
    adminStatus: note.adminStatus || null,
    adminType: note.adminType || null
  })
}

const fetchNodeData = async (nodeId: string) => {
  if (nodesData.value[nodeId] || loadingNodes.value[nodeId]) return
  loadingNodes.value[nodeId] = true
  
  try {
    const data = await $fetch<{ node: Node }>(`/api/nodes/${nodeId}`)
    if (data?.node) {
      nodesData.value[nodeId] = data.node
    }
  } catch (error) {
    console.error(`Failed to fetch node ${nodeId}`, error)
  } finally {
    loadingNodes.value[nodeId] = false
  }
}

watch(() => notes.value, (newNotes) => {
  if (!newNotes) return
  newNotes.forEach((note) => {
    if (note.nodeId && !nodesData.value[note.nodeId]) {
      fetchNodeData(note.nodeId)
    }
  })
}, { immediate: true })
</script>
