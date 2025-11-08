<template>
  <v-row>
    <v-col cols="12" md="6">
      <iframe
        src="https://discord.com/widget?id=1338546021319315468&theme=dark"
        width="400"
        height="300"
        allowtransparency="true"
        frameborder="0"
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
      />
    </v-col>
    <v-col cols="12" md="6">
      <iframe
        src="https://widgets.sociablekit.com/facebook-group-posts/iframe/25619702"
        frameborder="0"
        width="400px"
        height="300px"
      />
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "Działaj z nami",
  isHelp: true,
  middleware: "auth",
});
</script>
