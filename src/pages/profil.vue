<template>{{ user?.displayName }} to Ty</template>

<script lang="ts" setup>
import { useAuthState } from "@/composables/auth";
const { user } = useAuthState();
</script>
