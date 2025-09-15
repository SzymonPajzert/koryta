<template>
  <v-list-item
    v-if="user"
    :prepend-icon="destinationIcon[props.dialog]"
    :title="destinationAddText[props.dialog]"
    @click="openDialog()"
  />
  <!-- If user is not logged in, show button to redirect to login -->
  <v-list-item
    v-else
    :prepend-icon="destinationIcon[props.dialog]"
    :title="destinationAddText[props.dialog]"
    to="/login"
  />
</template>

<script lang="ts" setup>
import { useAuthState } from "@/composables/auth";
import { useDialogStore } from "@/stores/dialog"; // Import the new store
import {
  type Destination,
  destinationIcon,
  destinationAddText,
} from "~~/shared/model";

const { user } = useAuthState();

const dialogStore = useDialogStore();

type Environment = "list";

const props = defineProps<{ env?: Environment; dialog: Destination }>();

function openDialog() {
  dialogStore.open({
    type: props.dialog,
  });
}
</script>
