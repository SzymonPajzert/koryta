<template>
  <v-list-item
    :prepend-icon="destinationIcon[props.dialog]"
    v-if="user"
    :title="destinationAddText[props.dialog]"
    @click="openDialog()"
  ></v-list-item>
  <!-- If user is not logged in, show button to redirect to login -->
  <v-list-item
    :prepend-icon="destinationIcon[props.dialog]"
    v-else
    :title="destinationAddText[props.dialog]"
    to="/login"
  ></v-list-item>
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
