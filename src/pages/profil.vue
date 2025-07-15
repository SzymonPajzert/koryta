<template>
  {{ user?.displayName }} to Ty {{ user?.email }} to Twój email
</template>

<script lang="ts" setup>
import { useAuthState } from "@/composables/auth";
const { user } = useAuthState();
</script>
