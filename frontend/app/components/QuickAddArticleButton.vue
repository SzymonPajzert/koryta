<template>
  <div class="d-inline-block ml-2 align-top">
    <v-btn
      variant="tonal"
      color="primary"
      prepend-icon="mdi-newspaper-plus"
      @click="
        expanded = !expanded;
        checkLogin();
      "
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
          :disabled="!url"
          @click="handleAdd"
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
const router = useRouter();
const route = useRoute();
const { idToken } = useAuthState();

function checkLogin() {
  if (!idToken.value) {
    router.push({
      path: "/login",
      query: {
        redirect: route.fullPath,
      },
    });
  }
}

const handleAdd = async () => {
  loading.value = true;
  try {
    let title = undefined;
    try {
      title = await getPageTitle(url.value);
    } catch (e) {
      console.log("Failed to fetch", e);
    }
    const authHeaders = {
      Authorization: `Bearer ${idToken.value}`,
    };
    // 2. Create Article Node
    const { id: articleId } = await $fetch<{ id: string }>(
      "/api/nodes/create",
      {
        method: "POST",
        body: {
          type: "article",
          name: title || "Nowy Artykuł",
          sourceURL: url.value,
          content: "",
        },
        headers: authHeaders,
      },
    );

    // 3. Create Edge Revision (Mentions)
    // Edge: Article (Source) -> Person/Place (Target)
    // Type: mentions
    await $fetch("/api/edges/create", {
      method: "POST",
      body: {
        source: articleId,
        target: props.nodeId,
        type: "mentions",
        name: "",
      },
      headers: authHeaders,
    });

    alert("Dodano propozycję artykułu!");
    expanded.value = false;
    url.value = "";
  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Wystąpił błąd";
    alert("Błąd: " + msg);
  } finally {
    loading.value = false;
  }
};
</script>
