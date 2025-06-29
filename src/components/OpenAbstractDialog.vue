<template>
  <v-list-item :prepend-icon="titleIcon"
    v-if="user"
    :title="buttonText"
    @click="openDialog()"
  ></v-list-item>
  <!-- If user is not logged in, show button to redirect to login -->
  <v-list-item :prepend-icon="titleIcon"
    v-else
    :title="buttonText"
    to="/login"
  ></v-list-item>
</template>

<script lang="ts" setup>
import { useAuthState } from '@/composables/auth';
import { useDialogStore, type DialogType } from '@/stores/dialog'; // Import the new store

const { user } = useAuthState();

const dialogStore = useDialogStore();

type Environment = 'list'

const props = defineProps<{env?: Environment; dialog: DialogType}>()

let titleIcon = ''
let buttonText = ''

switch (props.dialog.entity) {
  case 'employed':
    titleIcon = 'mdi-account-plus-outline'
    buttonText = 'Dodaj osobę'
    break;
  case 'company':
    titleIcon = 'mdi-office-building-outline'
    buttonText = 'Dodaj firmę'
    break;
  case 'data':
    titleIcon = 'mdi-file-document-outline'
    buttonText = 'Dodaj artykuł'
    break;
  case 'suggestion':
    titleIcon = 'mdi-help-circle-outline'
    buttonText = 'Dodaj sugestię'
    break;
}

function openDialog() {
  dialogStore.open({
    name: 'Nowe ' + props.dialog.entity,
    type: props.dialog,
    defaultValue: () => ({name:"Nowe"}),
  });
}
</script>
