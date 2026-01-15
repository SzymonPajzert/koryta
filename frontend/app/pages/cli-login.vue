<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getAuth } from "firebase/auth";

const route = useRoute();
const router = useRouter();
const status = ref("Checking authentication...");
const error = ref("");

onMounted(async () => {
  const auth = getAuth();

  // Simple polling or wait for auth ready
  await auth.authStateReady();

  if (!auth.currentUser) {
    status.value = "Not logged in. Redirecting to login...";
    router.push({
      path: "/login",
      query: { redirect: route.fullPath },
    });
    return;
  }

  const callback = route.query.callback as string;
  if (!callback) {
    error.value = "Missing callback URL parameter.";
    status.value = "Error";
    return;
  }

  // Security check: only allow localhost callbacks
  try {
    const url = new URL(callback);
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      error.value = "Callback URL must be localhost for security reasons.";
      status.value = "Security Error";
      return;
    }
  } catch (e: unknown) {
    error.value = "Invalid callback URL.";
    status.value = `Error ${e}`;
    return;
  }

  status.value = "Getting ID token...";
  try {
    const token = await auth.currentUser.getIdToken(true);
    status.value = "Sending token to CLI...";

    const response = await fetch(callback, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });

    if (response.ok) {
      status.value = "Authenticated! You can close this window now.";
    } else {
      error.value = `CLI rejected the token: ${response.statusText}`;
      status.value = "Error";
    }
  } catch (e: unknown) {
    error.value = `Failed: ${(e as Error).message}`;
    status.value = "Error";
  }
});
</script>

<template>
  <div
    class="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4"
  >
    <div
      class="max-w-md w-full bg-white dark:bg-gray-800 shadow-md rounded-lg p-6 text-center"
    >
      <h1 class="text-2xl font-bold mb-4">CLI Authentication</h1>

      <div
        v-if="error"
        class="p-4 mb-4 text-sm text-red-800 rounded-lg bg-red-50 dark:bg-gray-800 dark:text-red-400"
        role="alert"
      >
        {{ error }}
      </div>

      <p class="text-lg">
        {{ status }}
      </p>

      <div v-if="status.includes('Authenticated')" class="mt-6">
        <div class="text-6xl mb-4">✅</div>
        <p class="text-sm text-gray-500">Return to your terminal.</p>
      </div>
    </div>
  </div>
</template>
