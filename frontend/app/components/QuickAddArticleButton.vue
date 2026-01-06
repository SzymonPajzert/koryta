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
import { useAuthState } from "~/composables/auth";
import { getPageTitle } from "~/composables/useFunctions";

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
    const title = await getPageTitle(url.value) || "Nowy Artykuł";
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
