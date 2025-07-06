<template>
  <template v-if="isAdmin">
    <v-card>
      <v-card-title>Dodaj backlinki</v-card-title>
      <v-card-body>
      </v-card-body>
      <v-card-actions>
        <v-spacer></v-spacer>
      </v-card-actions>
    </v-card>
  </template>
</template>

<script lang="ts" setup>
import { useAuthState } from '@/composables/auth'
const {isAdmin} = useAuthState()
</script>
