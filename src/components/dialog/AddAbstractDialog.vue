<template>
    <v-dialog
    v-model="dialog"
    :max-width="props.maxWidth ?? 600"
  >
    <v-card
      :prepend-icon="props.titleIcon"
      :title="props.title"
    >
      <v-card-text>
        <slot>
          this is misconfigured
        </slot>
      </v-card-text>

      <v-divider></v-divider>

      <v-card-actions>
        <v-spacer></v-spacer>

        <v-btn
          text="Zamknij"
          variant="plain"
          @click="dialog = false"
        ></v-btn>

        <v-btn
          color="primary"
          text="Dodaj"
          variant="tonal"
          @click="saveSuggestion()"
        ></v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

    <v-snackbar
      v-model="showConfirmationSnackbar"
      :timeout="3000"
      color="success"
      location="top end"
    >
      Sugestia została pomyślnie dodana!
      <template v-slot:actions>
        <v-btn
          variant="text"
          @click="showConfirmationSnackbar = false"
        >
          Zamknij
        </v-btn>
      </template>
    </v-snackbar>
</template>

<script lang="ts" setup>
  import { useAuthState } from '@/composables/auth'
  import { shallowRef, ref as vueRef } from 'vue'
  import { ref as dbRef, push, set, type ThenableReference } from 'firebase/database';
  import { db } from '@/firebase'

  const { user, isAdmin } = useAuthState();
  const props = defineProps<{
    buttonText: string;
    title: string;
    titleIcon: string;
    maxWidth?: number;
    suggestionPath: string;
    adminSuggestionPath?: string;
    suggestionType: string;
    initialFormData: () => any;
    editKey?: string;
    toOutput: (formData: any) => Record<string, any> | Record<string, any>[];
  }>();
  const formData = defineModel<any>();
  formData.value = props.initialFormData();

  const dialog = shallowRef(false);
  const showConfirmationSnackbar = vueRef(false);

  const saveSuggestion = async () => {
    if (!user.value?.uid) {
      console.error("User not authenticated or UID not available.");
      // Można tu dodać powiadomienie dla użytkownika
      return;
    }

    let submitPath = dbRef(db, props.suggestionPath)
    if (props.adminSuggestionPath && isAdmin.value) {
      // Only admins can actually edit
      submitPath = dbRef(db, props.adminSuggestionPath + (props.editKey ? "/" + props.editKey : ""))
    }

    let operation = push;
    if (props.editKey && isAdmin.value) {
      operation = (parent, value) => {
        set(parent, value);
        return {key: props.editKey, ref: parent} as ThenableReference
      }
    }

    // we need to keep await here, since it's sometimes async
    // TODO test this
    const outputSingleton = await props.toOutput(formData.value)
    let output: Record<string, any>[]
    if (!Array.isArray(outputSingleton)) output = [outputSingleton]
    else output = outputSingleton

    output.forEach(item => {
      const keyRef = operation(submitPath, {
        ...item,
        date: Date.now(),
        user: user.value?.uid,
      }).key;
      push(dbRef(db, `user/${user.value?.uid}/suggestions/${props.suggestionType}`), keyRef)
    })

    dialog.value = false;
    // Reset form data
    formData.value = props.initialFormData();
    // Show confirmation snackbar
    showConfirmationSnackbar.value = true;
  };
</script>
