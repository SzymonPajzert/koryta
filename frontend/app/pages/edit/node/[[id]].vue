<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <div class="d-flex align-center mb-4">
          <v-btn icon="mdi-arrow-left" variant="text" to="/edit" class="mr-2" />
          <h1 class="text-h4">{{ isNew ? "Nowa encja" : "Edycja encji" }}</h1>
        </div>
      </v-col>
    </v-row>

    <v-form @submit.prevent="save">
      <v-row>
        <v-col cols="12" md="6">
          <v-select
            v-if="isNew"
            v-model="type"
            :items="types"
            label="Typ"
            item-title="title"
            item-value="value"
            required
          />
          <v-text-field
            v-else
            :model-value="typeLabel"
            label="Typ"
            readonly
            disabled
          />
        </v-col>
        
        <v-col cols="12" md="6">
          <v-text-field
            v-model="form.name"
            label="Nazwa"
            required
          />
        </v-col>

        <!-- Person specific fields -->
        <v-col cols="12" v-if="type === 'person'">
          <v-select
            v-model="form.parties"
            :items="partiesDefault"
            label="Partia"
            multiple
            chips
            deletable-chips
          />
        </v-col>

        <!-- Company specific fields -->
        <template v-if="type === 'place'">
          <v-col cols="12" md="6">
            <v-text-field
              v-model="form.krsNumber"
              label="Numer KRS"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="form.nipNumber"
              label="NIP"
            />
          </v-col>
        </template>

        <!-- Article specific fields -->
        <template v-if="type === 'article'">
          <v-col cols="12">
            <v-text-field
              v-model="form.sourceURL"
              label="URL źródłowy"
              type="url"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="form.shortName"
              label="Krótka nazwa"
            />
          </v-col>
        </template>

        <v-col cols="12">
          <v-btn
            color="primary"
            type="submit"
            :loading="saving"
            block
          >
            Zapisz
          </v-btn>
        </v-col>
      </v-row>
    </v-form>
    
    <v-snackbar v-model="snackbar" :color="snackbarColor">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { getFirestore, doc, setDoc, getDoc, collection } from "firebase/firestore";
import type { NodeType, Person, Company, Article } from "~~/shared/model";
import { parties } from "~~/shared/misc";

definePageMeta({
  middleware: "auth",
});

const route = useRoute();
const router = useRouter();
const db = getFirestore(useFirebaseApp(), "koryta-pl");

const nodeId = route.params.id as string | undefined;
const isNew = !nodeId;

const type = ref<NodeType>("person");
const saving = ref(false);
const snackbar = ref(false);
const snackbarText = ref("");
const snackbarColor = ref("success");

// Unified form state
const form = ref<any>({
  name: "",
  parties: [],
  krsNumber: "",
  nipNumber: "",
  sourceURL: "",
  shortName: "",
});

const types = [
  { title: "Osoba", value: "person" },
  { title: "Firma", value: "place" },
  { title: "Artykuł", value: "article" },
];

const typeLabel = computed(() => types.find(t => t.value === type.value)?.title ?? type.value);
const partiesDefault = computed<string[]>(() => [...parties, "inne"]);

// Load existing data
if (!isNew && nodeId) {
  const docRef = doc(db, "nodes", nodeId);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    const data = snap.data() as any;
    type.value = data.type;
    form.value = { ...form.value, ...data };
  }
}

async function save() {
  saving.value = true;
  try {
    const id = nodeId || doc(collection(db, "nodes")).id;
    const docRef = doc(db, "nodes", id);
    
    const data: any = {
      name: form.value.name,
      type: type.value,
    };

    if (type.value === 'person') {
      data.parties = form.value.parties;
    } else if (type.value === 'place') {
      data.krsNumber = form.value.krsNumber;
      data.nipNumber = form.value.nipNumber;
    } else if (type.value === 'article') {
      data.sourceURL = form.value.sourceURL;
      data.shortName = form.value.shortName;
      // Initialize estimates if new
      if (isNew) {
        data.estimates = { mentionedPeople: 0 };
      }
    }

    await setDoc(docRef, data, { merge: true });
    
    snackbarText.value = "Zapisano pomyślnie";
    snackbarColor.value = "success";
    snackbar.value = true;
    
    if (isNew) {
      router.push(`/edit/node/${id}`);
    }
  } catch (e) {
    console.error(e);
    snackbarText.value = "Błąd zapisu";
    snackbarColor.value = "error";
    snackbar.value = true;
  } finally {
    saving.value = false;
  }
}
</script>
