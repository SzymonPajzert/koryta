<template>
  <div class="d-inline-block ml-2 align-top">
    <v-btn
      variant="tonal"
      color="primary"
      prepend-icon="mdi-newspaper-plus"
      @click="expanded = !expanded"
    >
      Dodaj artykuł
    </v-btn>
    <v-expand-transition>
      <v-card v-if="expanded" class="mt-2 pa-3" width="300" border flat>
        <v-text-field
          v-model="url"
          label="URL Artykułu"
          :loading="loading"
          :disabled="loading"
          hide-details
          density="compact"
          class="mb-2"
          placeholder="https://..."
        />
        <v-btn
          size="small"
          block
          color="success"
          :loading="loading"
          @click="handleAdd"
          :disabled="!url"
        >
          Dodaj
        </v-btn>
      </v-card>
    </v-expand-transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { getFunctions, httpsCallable, connectFunctionsEmulator, httpsCallableFromURL } from "firebase/functions";
import { useFirebaseApp } from "vuefire";
import { useAuthState } from "~/composables/auth";

const props = defineProps<{
  nodeId: string;
}>();

const expanded = ref(false);
const url = ref("");
const loading = ref(false);
const { idToken } = useAuthState();

const handleAdd = async () => {
  if (!idToken.value) {
    console.warn("No idToken found");
    alert("Musisz być zalogowany");
    return;
  }


  loading.value = true;
  try {

    // 1. Fetch Title
    const config = useRuntimeConfig();
    const app = useFirebaseApp();
    const functions = getFunctions(app, "europe-west1");
    
    if (config.public.isLocal) {
       // Ensure this specific instance talks to emulator
       // Note: connectFunctionsEmulator can be called multiple times safely? 
       // Ideally we check if already connected but there's no public API for that.
       // However, catching error "already connected" is common pattern.
       try {
         connectFunctionsEmulator(functions, "127.0.0.1", 5001);
       } catch (e) {
         // ignore already connected
       }
    }

    const getPageTitle = httpsCallable<{ url: string }, { title: string }>(
      functions,
      "getPageTitle"
    );
    const titleRes = await getPageTitle({ url: url.value });
    const title = titleRes.data.title || "Nowy Artykuł";

    const authHeaders = {
      Authorization: `Bearer ${idToken.value}`,
    };

    // 2. Create Article Node
    const { id: articleId } = await $fetch<{ id: string }>("/api/nodes/create", {
      method: "POST",
      body: {
        type: "article",
        name: title,
        sourceURL: url.value,
        content: "",
      },
      headers: authHeaders,
    });

    // 3. Create Edge Revision (Mentions)
    // Edge: Article (Source) -> Person/Place (Target)
    // Type: mentions
    await $fetch("/api/revisions/create", {
      method: "POST",
      body: {
        collection: "edges",
        source: articleId,
        target: props.nodeId,
        type: "mentions",
        name: "", 
        // No explicit name needed? Or title?
      },
      headers: authHeaders,
    });

    alert("Dodano propozycję artykułu!");
    expanded.value = false;
    url.value = "";
  } catch (e: any) {
    console.error(e);
    alert("Błąd: " + (e.message || "Wystąpił błąd"));
  } finally {
    loading.value = false;
  }
};
</script>
