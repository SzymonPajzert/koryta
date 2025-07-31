<template>
  <v-card>
    List everyone in the KRS x KRS osoba list. For each create google links to open multiple tabs.
    Add a button to rate if this person is of interest and also to dump links relating to them
  </v-card>

  <v-list lines="two" width="100%">
    <template v-for="(person, index) in people" :key="index">
      <v-list-item>
        <!-- Main two-column content -->
        <v-row align="center">
            <!-- Column 1: Product Info & Comment -->
            <v-col cols="12" sm="7" md="8">
                <div class="font-weight-bold">{{ person.name }}</div>
                <div class="text-body-2">{{ index }}</div>
                <!-- Display comment if it exists -->
                <div v-if="person.comment" class="text-caption text-blue-grey-darken-1 mt-2">
                    <v-icon size="x-small" start icon="mdi-comment-quote-outline"></v-icon>
                    <em>{{ person.comment }}</em>
                </div>
            </v-col>

            <!-- Column 2: Price and Stock Status -->
            <v-col cols="12" sm="5" md="4" class="d-flex flex-column align-sm-end">
              <span :class="['stock-status', scoreColor(person)]">
                  {{ person.score ?? 0 }}
              </span>
            </v-col>
        </v-row>

        <!-- Action buttons in the append slot for clean alignment -->
        <template v-slot:append>
            <div class="d-flex flex-sm-column ga-1">
                <v-btn size="small" icon="mdi-arrow-up-bold" variant="text" @click="addValue(person, 1)" title="Add"></v-btn>
                <v-btn size="small" icon="mdi-arrow-down-bold" variant="text" @click="addValue(person, -1)" title="Decrease"></v-btn>
            </div>
            <div class="d-flex flex-sm-column ga-1">
                <v-btn size="small" icon="mdi-magnify" variant="text" @click="openExploration(person)" title="Add/Edit Comment"></v-btn>
                <v-btn size="small" icon="mdi-account-outline" variant="text" @click="toggleEditing(person, 'comment')" title="Edytuj"></v-btn>
            </div>
            <div class="d-flex flex-sm-column ga-1">
                <v-btn size="small" icon="mdi-comment-plus-outline" variant="text" @click="toggleEditing(person, 'comment')" title="Add/Edit Comment"></v-btn>
                <v-btn size="small" icon="mdi-link-variant-plus" variant="text" @click="toggleEditing(person, 'comment')" title="Edytuj"></v-btn>
            </div>
        </template>
    </v-list-item>

    <!-- Expansion area for the editing form -->
    <v-expand-transition>
        <div v-if="editingItemId === person.external_basic.id">
            <div class="edit-area pa-4">
                <!-- Comment Form -->
                <div v-if="editingType === 'comment'">
                    <v-textarea
                        label="Add a comment"
                        v-model="tempLink"
                        rows="2"
                        auto-grow
                        variant="outlined"
                        density="compact"
                        hide-details
                    ></v-textarea>
                </div>
                <!-- Stock Form -->
                <div v-if="editingType === 'stock'">
                      <v-text-field
                        label="Update Stock Quantity"
                        v-model.number="tempPerson"
                        type="number"
                        variant="outlined"
                        density="compact"
                        hide-details
                    ></v-text-field>
                </div>

                <div class="d-flex justify-end mt-3">
                    <v-btn size="small" variant="text" @click="cancelEdit">Anuluj</v-btn>
                    <v-btn size="small" color="primary" flat @click="saveEdit">Dodaj</v-btn>
                </div>
            </div>
        </div>
    </v-expand-transition>

    <v-divider v-if="index < people.length - 1"></v-divider>
    </template>
  </v-list>
</template>

<script setup lang="ts">
import { type PersonRejestr } from '@/composables/model';
import { createEntityStore } from '@/stores/entity';
const usePeopleStore = createEntityStore("external/rejestr-io/person")
const peopleStore = usePeopleStore()
const { entities: people } = storeToRefs(peopleStore)

type EditType = 'comment' | 'stock'
const editingItemId = ref<string | null>(null);
const editingType = ref<EditType | null>(null);

const tempPerson = ref<string>();
const tempLink = ref<string>();

function toggleEditing(person: PersonRejestr, editType: EditType) {
  if (editingItemId.value === person.external_basic.id && editingType.value === editType) {
    cancelEdit();
    return;
  }
  editingItemId.value = person.external_basic.id
  editingType.value = editType
}
function openExploration(person: PersonRejestr) {
  window.open('https://www.google.com/search?q=' + person.name, "_blank");
  window.open('https://rejestr.io/osoby/' + person.external_basic.id, "_blank");
}
function cancelEdit() {
  editingItemId.value = null;
  editingType.value = null;
}
function saveEdit() {}
function scoreColor(person: PersonRejestr) {
  const score = person.score ?? 0
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}
function addValue(person: PersonRejestr, value: number) {
  person.score = (person.score ?? 0) + value
}
</script>

<style scoped>
.stock-status {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 9999px;
    font-size: 0.8rem;
    font-weight: 600;
}
.positive {
    background-color: #dcfce7; /* Green tint */
    color: #166534; /* Dark Green */
}
.neutral {
    background-color: #ffedd5; /* Orange tint */
    color: #9a3412; /* Dark Orange */
}
.negative {
    background-color: #fee2e2; /* Red tint */
    color: #991b1b; /* Dark Red */
}
</style>
