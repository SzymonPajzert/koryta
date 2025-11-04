<template>
  <iframe
    src="https://discord.com/widget?id=1338546021319315468&theme=dark"
    width="400"
    height="200"
    allowtransparency="true"
    frameborder="0"
    sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
  />
</template>

<script lang="ts" setup>
definePageMeta({
  title: "Działaj z nami",
  isHelp: true,
  middleware: "auth",
});

const { allowedIssues } = defineProps<{ allowedIssues: string[] }>();
</script>
